package expo.modules.freedomforeground

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Restarts the DNS tunnel whenever it is meant to be up and is not: after an app
 * update, and after the user switches it off. Android's always-on VPN would
 * cover this, but setting it needs a system API a normal app cannot call.
 *
 * Hosted in the foreground service, like BankingAppGuard, so it survives the VPN
 * service dying and the app process being swiped away.
 */
class VpnWatchdog(private val context: Context) {

    private val handler = Handler(Looper.getMainLooper())
    private var running = false
    private var blockedWarned = false

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
        if (!isVpnWanted(context)) {
            blockedWarned = false
            return
        }

        // Non-null means another VPN holds the slot, or consent is gone.
        if (VpnService.prepare(context) != null) {
            if (!blockedWarned) {
                blockedWarned = true
                Log.w(TAG, "VPN wanted but not prepared; another VPN may hold the slot")
            }
            return
        }
        blockedWarned = false

        // onStartCommand returns early when the tunnel is already up. No liveness
        // flag: a hard kill leaves one stale exactly when the restart is needed.
        context.startForegroundService(
            Intent().setComponent(ComponentName(context.packageName, VPN_SERVICE))
        )
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
    }
}
