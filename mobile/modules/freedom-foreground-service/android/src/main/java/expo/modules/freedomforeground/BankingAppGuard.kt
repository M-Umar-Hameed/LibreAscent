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
        val until = context
            .getSharedPreferences(BANKING_PREFS, Context.MODE_PRIVATE)
            .getLong(KEY_BANKING_UNTIL, 0L)
        if (!isBankingActive(until, System.currentTimeMillis())) return false

        if (!hasUsageStatsPermission(context)) {
            // Nothing this guard can do; surfaced to the user by the settings
            // screen before banking can be started.
            return true
        }

        val blocked = blockedPackages(context)
        if (blocked.isEmpty()) return true

        val foreground = foregroundPackage() ?: return true
        if (foreground == context.packageName) return true
        if (foreground !in blocked) return true

        Log.w(TAG, "Banking window: $foreground is blocked, sending home")
        sendHome()
        return true
    }

    private fun foregroundPackage(): String? {
        val usage = context.getSystemService(Context.USAGE_STATS_SERVICE)
            as? UsageStatsManager ?: return null
        val end = System.currentTimeMillis()
        val events = usage.queryEvents(end - EVENT_LOOKBACK_MS, end)
        val event = UsageEvents.Event()
        var last: String? = null
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
                last = event.packageName
            }
        }
        return last
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

        // Written by ContentMatcher.persistApps, so the list outlives the
        // accessibility service that normally owns it.
        private const val MATCHER_PREFS = "freedom_matcher_data"
        private const val KEY_PACKAGES = "blocked_packages"

        private const val IDLE_POLL_MS = 5_000L
        private const val ACTIVE_POLL_MS = 1_000L
        private const val EVENT_LOOKBACK_MS = 10_000L

        fun isBankingActive(until: Long, now: Long): Boolean = until > now

        fun nextDelayMs(bankingActive: Boolean): Long =
            if (bankingActive) ACTIVE_POLL_MS else IDLE_POLL_MS

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
