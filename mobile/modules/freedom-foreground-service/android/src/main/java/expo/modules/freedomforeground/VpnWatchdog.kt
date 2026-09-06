package expo.modules.freedomforeground

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Restarts the DNS tunnel whenever it is meant to be up and is not.
 *
 * Every blocked domain becomes reachable the moment the VPN stops, and stopping
 * it takes one tap in quick settings. It is also down after every app update,
 * and LaunchRecoveryService only starts it on a fresh process, so relaunching
 * an already-running app does not bring it back.
 *
 * Android's own always-on VPN would cover this, but setting it needs a system
 * API (setAlwaysOnVpnPackageForUser) that a normal app cannot call — writing
 * Settings.Secure.always_on_vpn_app directly was tried on device and did not
 * start the tunnel. So the app watches for itself.
 *
 * It lives in the foreground service, like BankingAppGuard, so it survives the
 * VPN service dying and the app process being swiped away. It talks to the VPN
 * module through plain SharedPreferences and an explicit component name, so
 * there is no cross-module code dependency.
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

        // Null means consent is granted and no other VPN holds the slot. When
        // another VPN app is active this is non-null, and starting ours would
        // be a fight we cannot win silently — leave it alone.
        if (VpnService.prepare(context) != null) {
            if (!blockedWarned) {
                blockedWarned = true
                Log.w(TAG, "VPN wanted but not prepared; another VPN may hold the slot")
            }
            return
        }
        blockedWarned = false

        // onStartCommand returns early when the tunnel is already up, so this
        // is a no-op in the common case and needs no liveness check of its own.
        // A liveness flag would be worse: a hard kill leaves it stale at
        // "running", which is exactly when the restart is needed.
        context.startForegroundService(
            Intent().setComponent(ComponentName(context.packageName, VPN_SERVICE))
        )
    }

    companion object {
        private const val TAG = "VpnWatchdog"

        // Written by FreedomVpnService once the tunnel is up, and cleared by
        // FreedomVpnModule.stopVpn, which is the one deliberate off switch.
        private const val VPN_PREFS = "freedom_vpn_state"
        private const val KEY_WANTED = "vpn_wanted"

        private const val VPN_SERVICE = "expo.modules.freedomvpn.FreedomVpnService"

        /**
         * Long enough that the restart costs nothing on an idle device, short
         * enough that switching the VPN off buys well under a minute.
         */
        private const val POLL_MS = 30_000L

        fun isVpnWanted(context: Context): Boolean = context
            .getSharedPreferences(VPN_PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_WANTED, false)
    }
}
