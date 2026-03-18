package expo.modules.freedomforeground

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Boot receiver — starts the foreground service when the device boots.
 *
 * For this to work, the user must have enabled "auto-start" in the app settings.
 * The auto-start preference is stored in SharedPreferences.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "FreedomBoot"
        const val PREFS_NAME = "freedom_prefs"
        const val KEY_AUTO_START = "auto_start_enabled"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val autoStartEnabled = prefs.getBoolean(KEY_AUTO_START, true) // Default: on

        if (!autoStartEnabled) {
            Log.i(TAG, "Auto-start disabled, skipping foreground service start")
            return
        }

        Log.i(TAG, "Boot completed — starting Freedom foreground service")

        try {
            val serviceIntent = Intent(context, FreedomForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start service on boot", e)
        }
    }
}
