package expo.modules.freedomforeground

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.util.Log
import org.json.JSONArray

/**
 * Keeps blocked apps blocked while banking mode has the accessibility service
 * switched off.
 *
 * Banking mode strips LibreAscent out of ENABLED_ACCESSIBILITY_SERVICES, because
 * banking apps refuse to run alongside a non-whitelisted accessibility service.
 * Android then destroys FreedomAccessibilityService, and app blocking goes with
 * it: enforceForegroundIfBlocked lives inside that service and uses
 * performGlobalAction, an accessibility-only API. For the whole window every
 * blocked app opens freely.
 *
 * Device Owner package suspension covers this, but only on provisioned devices,
 * and provisioning needs a factory reset. This is the fallback for everyone
 * else: UsageStatsManager reports the foreground app without accessibility, and
 * banking apps do not inspect the usage-stats grant.
 *
 * It lives in the foreground service rather than the accessibility module so it
 * survives both the accessibility service being destroyed and the app process
 * being swiped away, which is otherwise a clean bypass. Both stores it reads are
 * plain SharedPreferences, so there is no cross-module code dependency.
 */
class BankingAppGuard(private val context: Context) {

    private val handler = Handler(Looper.getMainLooper())
    private var running = false
    private var restoreRequested = false
    private var grantWarned = false
    private var bankSeenAt = 0L
    private var lastForeground: Pair<String, String?>? = null

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            val active = try {
                pollOnce()
            } catch (e: Exception) {
                // Never let a poll failure kill the loop; the window is short and
                // the next tick may succeed.
                Log.w(TAG, "Banking guard poll failed: ${e.message}")
                false
            }
            handler.postDelayed(this, nextDelayMs(active))
        }
    }

    fun start() {
        if (running) return
        running = true
        handler.post(tick)
    }

    fun stop() {
        running = false
        handler.removeCallbacks(tick)
    }

    /** Returns true when the banking window is open, so the caller can poll faster. */
    private fun pollOnce(): Boolean {
        val prefs = context.getSharedPreferences(BANKING_PREFS, Context.MODE_PRIVATE)
        val until = prefs.getLong(KEY_BANKING_UNTIL, 0L)
        if (!isWindowPending(until)) {
            restoreRequested = false
            bankSeenAt = 0L
            lastForeground = null
            grantWarned = false
            return false
        }

        // The restore alarm is inexact and fired 90 seconds late on device,
        // three times out of three. Keyword and URL blocking have no fallback
        // during that gap, since they need the accessibility service back. This
        // loop already ticks every second inside the window, so ask for the
        // restore ourselves the moment the deadline passes; the alarm stays as
        // a backstop. Same-package broadcast reaches the non-exported receiver.
        // This needs no permission, so it runs before the usage-stats check.
        if (shouldRequestRestore(until, System.currentTimeMillis(), restoreRequested)) {
            Log.i(TAG, "Banking deadline passed, requesting restore now")
            requestRestore()
        }

        if (!hasUsageStatsPermission(context)) {
            // Blocked apps are unguarded for this window. A reinstall resets
            // the grant, so this is reachable even after it was once given.
            if (!grantWarned) {
                grantWarned = true
                Log.w(TAG, "Usage access not granted; blocked apps are unguarded during banking")
            }
            return true
        }

        // The lookback only sees recent switches; staying in one app keeps it.
        val (foreground, activity) = (foregroundActivity() ?: lastForeground)
            ?.also { lastForeground = it } ?: return true
        if (foreground == context.packageName) return true

        // The pause outlives a short trip to fetch an OTP, since a bank still
        // running notices the service coming back. Any other app ends it at
        // once: the pause turns every content check off, and hopping between a
        // bank and a browser would otherwise keep it off for good. A window
        // left by an older build carries no bank and ends at once.
        val bank = prefs.getString(KEY_BANKING_AUTO_PACKAGE, null) ?: ""
        val now = android.os.SystemClock.elapsedRealtime()
        val stop = pauseStop(foreground, activity, bank, tripTargets())
        if (stop == PauseStop.NONE || bankSeenAt == 0L) bankSeenAt = now
        val ends = bank.isEmpty() || stop == PauseStop.NOW ||
            (stop == PauseStop.AFTER_GRACE && now - bankSeenAt >= AWAY_GRACE_MS)
        if (!restoreRequested && ends) {
            Log.i(TAG, "Banking pause for $bank over at $foreground, requesting restore")
            requestRestore()
            // Settings stays unguarded until the service reconnects.
            if (isTamperSurface(foreground)) sendHome()
            return true
        }

        val blocked = blockedPackages(context)
        if (foreground !in blocked) return true

        Log.w(TAG, "Banking window: $foreground is blocked, sending home")
        sendHome()
        return true
    }

    private fun requestRestore() {
        restoreRequested = true
        context.sendBroadcast(Intent(ACTION_BANKING_RESTORE).setPackage(context.packageName))
    }

    /** Package and activity class of the last resumed activity. */
    private fun foregroundActivity(): Pair<String, String?>? {
        val usage = context.getSystemService(Context.USAGE_STATS_SERVICE)
            as? UsageStatsManager ?: return null
        val end = System.currentTimeMillis()
        val events = usage.queryEvents(end - EVENT_LOOKBACK_MS, end)
        val event = UsageEvents.Event()
        var last: Pair<String, String?>? = null
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
                last = event.packageName to event.className
            }
        }
        return last
    }

    /** Apps a sign-in sends the user to and back from: launcher, SMS, authenticators. */
    private fun tripTargets(): Set<String> {
        val home = try {
            context.packageManager.resolveActivity(
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0
            )?.activityInfo?.packageName
        } catch (_: Exception) {
            null
        }
        val sms = try {
            android.provider.Telephony.Sms.getDefaultSmsPackage(context)
        } catch (_: Exception) {
            null
        }
        return AUTHENTICATORS + listOfNotNull(home, sms)
    }

    private fun sendHome() {
        // Mirrors the accessibility path's GLOBAL_ACTION_HOME. Starting an
        // activity from a service is permitted here because the app holds
        // SYSTEM_ALERT_WINDOW, which exempts it from background-start limits.
        val home = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        try {
            context.startActivity(home)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to send home: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "BankingGuard"

        // Written by BankingModeManager in the accessibility module.
        private const val BANKING_PREFS = "freedom_settings"
        private const val KEY_BANKING_UNTIL = "banking_until"
        private const val KEY_BANKING_AUTO_PACKAGE = "banking_auto_package"

        // Screens a bank's sign-in can open without leaving the bank app.
        private val SIGN_IN_HELPERS = setOf(
            "com.google.android.gms",
            "com.google.android.permissioncontroller",
            "com.android.permissioncontroller",
        )

        private val AUTHENTICATORS = setOf(
            "com.google.android.apps.authenticator2",
            "com.azure.authenticator",
            "com.authy.authy",
        )

        const val AWAY_GRACE_MS = 2 * 60_000L

        enum class PauseStop { NONE, AFTER_GRACE, NOW }

        /**
         * How the banking pause reacts to [foreground]: the bank, its sign-in
         * screens and the device-credential prompt (served from Settings) keep
         * it; [tripTargets] end it only after AWAY_GRACE_MS; anything else ends
         * it now.
         */
        fun pauseStop(foreground: String, activity: String?, bank: String, tripTargets: Set<String>): PauseStop =
            when {
                foreground == bank || foreground in SIGN_IN_HELPERS -> PauseStop.NONE
                activity?.contains("ConfirmDeviceCredential") == true ||
                    activity?.contains("ConfirmLock") == true -> PauseStop.NONE
                foreground in tripTargets -> PauseStop.AFTER_GRACE
                else -> PauseStop.NOW
            }

        // Written by ContentMatcher.persistApps, so the list outlives the
        // accessibility service that normally owns it.
        private const val MATCHER_PREFS = "freedom_matcher_data"
        private const val KEY_PACKAGES = "blocked_packages"

        // Handled by BankingRestoreReceiver in the accessibility module, which
        // is what the restore alarm targets too.
        private const val ACTION_BANKING_RESTORE =
            "expo.modules.freedomaccessibility.BANKING_RESTORE"

        private const val IDLE_POLL_MS = 5_000L
        private const val ACTIVE_POLL_MS = 1_000L
        private const val EVENT_LOOKBACK_MS = 10_000L

        /**
         * The window is open until BankingModeManager.restore() runs, which is
         * when it removes the key. The deadline itself is not the signal: the
         * restore alarm is inexact (setAndAllowWhileIdle), and on device it
         * fired 90 seconds late, leaving the accessibility service dead well
         * past the deadline. Keying on the clock would drop the guard during
         * exactly that gap.
         */
        fun isWindowPending(until: Long): Boolean = until != 0L

        /** Once per window: the deadline has passed and restore has not yet cleared the key. */
        fun shouldRequestRestore(until: Long, now: Long, alreadyRequested: Boolean): Boolean =
            until != 0L && now >= until && !alreadyRequested

        fun nextDelayMs(bankingActive: Boolean): Long =
            if (bankingActive) ACTIVE_POLL_MS else IDLE_POLL_MS

        /**
         * Screens that lead to deactivating device admin or uninstalling.
         * Matched as substrings because the OEM package names vary (Samsung
         * ships com.samsung.android.packageinstaller, Settings intelligence
         * shows up as com.google.android.settings.intelligence).
         *
         * ponytail: whole-package granularity, because UsageStatsManager only
         * reports the foreground package, not the screen inside it, so any of
         * them ends the banking pause and hands Settings back to the
         * accessibility service's own protection.
         */
        private val TAMPER_SURFACES = listOf(
            "com.android.settings",
            "com.google.android.settings",
            "packageinstaller",
        )

        fun isTamperSurface(pkg: String): Boolean {
            val lower = pkg.lowercase()
            return TAMPER_SURFACES.any { lower.contains(it) }
        }

        /**
         * Packages that must be pushed off screen. Mirrors
         * enforceForegroundIfBlocked: only a "none" surveillance type is an
         * outright block; the timed and prompted types are handled by the
         * accessibility service and are out of scope for the banking window.
         */
        fun parseBlockedPackages(json: String?): Set<String> {
            if (json.isNullOrBlank()) return emptySet()
            return try {
                val array = JSONArray(json)
                val out = mutableSetOf<String>()
                for (i in 0 until array.length()) {
                    val obj = array.optJSONObject(i) ?: continue
                    val pkg = obj.optString("packageName")
                    if (pkg.isNullOrBlank()) continue
                    if (obj.optString("surveillanceType") == "none") out.add(pkg)
                }
                out
            } catch (e: Exception) {
                Log.w(TAG, "Failed to parse blocked packages: ${e.message}")
                emptySet()
            }
        }

        fun blockedPackages(context: Context): Set<String> = parseBlockedPackages(
            context.getSharedPreferences(MATCHER_PREFS, Context.MODE_PRIVATE)
                .getString(KEY_PACKAGES, null)
        )

        fun hasUsageStatsPermission(context: Context): Boolean {
            val ops = context.getSystemService(Context.APP_OPS_SERVICE)
                as? AppOpsManager ?: return false
            val mode = ops.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
            return mode == AppOpsManager.MODE_ALLOWED
        }
    }
}
