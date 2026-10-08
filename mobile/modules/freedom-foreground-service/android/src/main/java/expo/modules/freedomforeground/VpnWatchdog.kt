package expo.modules.freedomforeground

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log

/**
 * Restarts the DNS tunnel whenever it is meant to be up and is not: after an app
 * update, and after the user switches it off. Android's always-on VPN would
 * cover this, but setting it needs a system API a normal app cannot call.
 *
 * Hosted in the foreground service, like BankingAppGuard, so it survives the VPN
 * service dying and the app process being swiped away.
 */
class VpnWatchdog(
    private val context: Context,
    private val onProblems: (List<String>) -> Unit
) {

    private val handler = Handler(Looper.getMainLooper())
    private var running = false
    private var blockedWarned = false
    private var a11yRepairLogged = false

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            try {
                pollOnce()
            } catch (e: Exception) {
                Log.w(TAG, "VPN watchdog poll failed: ${e.message}")
            }
            handler.postDelayed(this, POLL_MS)
        }
    }

    fun start() {
        if (running) return
        running = true
        handler.postDelayed(tick, POLL_MS)
    }

    fun stop() {
        running = false
        handler.removeCallbacks(tick)
    }

    private fun pollOnce() {
        repairAccessibility()
        onProblems(ProtectionCheck.evaluate(context))
        if (!isVpnWanted(context)) {
            blockedWarned = false
            return
        }
        // Banking mode pauses the tunnel briefly; FreedomVpnService.resume ends it.
        if (System.currentTimeMillis() < pausedUntil(context)) return

        // Non-null means another VPN holds the slot, or consent is gone.
        if (VpnService.prepare(context) != null) {
            if (!blockedWarned) {
                blockedWarned = true
                Log.w(TAG, "VPN wanted but not prepared; another VPN may hold the slot")
            }
            return
        }
        blockedWarned = false

        // Asked of the system, not a flag: a hard kill leaves a flag stale exactly
        // when the restart is needed.
        if (ProtectionCheck.isTunnelUp(context)) return
        context.startForegroundService(
            Intent().setComponent(ComponentName(context.packageName, VPN_SERVICE))
        )
    }

    private fun repairAccessibility() {
        val bankingUntil = context.getSharedPreferences("freedom_settings", Context.MODE_PRIVATE)
            .getLong("banking_until", 0L)
        if (System.currentTimeMillis() < bankingUntil || ProtectionCheck.isAccessibilityEnabled(context)) {
            a11yRepairLogged = false
            return
        }
        if (context.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) !=
            PackageManager.PERMISSION_GRANTED
        ) return
        val resolver = context.contentResolver
        val current = Settings.Secure.getString(resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
        Settings.Secure.putString(
            resolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            ProtectionCheck.listWith(current, ProtectionCheck.accessibilityComponent(context))
        )
        Settings.Secure.putInt(resolver, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
        if (!a11yRepairLogged) {
            a11yRepairLogged = true
            Log.w(TAG, "Accessibility service was off; re-enabled it")
        }
    }

    companion object {
        private const val TAG = "VpnWatchdog"

        // Written by FreedomVpnService, cleared by FreedomVpnModule.stopVpn.
        private const val VPN_PREFS = "freedom_vpn_state"
        private const val KEY_WANTED = "vpn_wanted"

        private const val VPN_SERVICE = "expo.modules.freedomvpn.FreedomVpnService"

        private const val POLL_MS = 30_000L

        fun isVpnWanted(context: Context): Boolean = context
            .getSharedPreferences(VPN_PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_WANTED, false)

        // Written by FreedomVpnService.pause.
        internal fun pausedUntil(context: Context): Long = context
            .getSharedPreferences(VPN_PREFS, Context.MODE_PRIVATE)
            .getLong("vpn_paused_until", 0L)
    }
}
