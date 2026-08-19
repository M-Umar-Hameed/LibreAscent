package expo.modules.freedomaccessibility

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Invalidates the cached installed-app list when a package is added or removed
 * so the next getInstalledApps() re-query reflects it. Never modifies the
 * blocklist: new installs appear in the app list but are not auto-blocked.
 */
class PackageAddedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_PACKAGE_ADDED ||
            intent.action == Intent.ACTION_PACKAGE_REMOVED
        ) {
            InstalledAppsCache.invalidate()
            Log.i("PackageAddedReceiver", "Package list changed, installed-app cache invalidated")
        }
    }
}
