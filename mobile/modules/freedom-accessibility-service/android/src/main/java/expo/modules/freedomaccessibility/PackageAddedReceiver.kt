package expo.modules.freedomaccessibility

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Invalidates the cached installed-app list when a package is added so the next
 * getInstalledApps() re-query surfaces it. Never modifies the blocklist:
 * new installs appear in the app list but are not auto-blocked.
 */
class PackageAddedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_PACKAGE_ADDED) {
            FreedomAccessibilityModule.cachedInstalledApps = null
            Log.i("PackageAddedReceiver", "Package added, installed-app cache invalidated")
        }
    }
}
