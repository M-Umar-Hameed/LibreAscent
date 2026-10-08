package expo.modules.freedomforeground

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Process
import android.provider.Settings

/** What the user's protection layers are doing right now, as stable problem codes. */
object ProtectionCheck {

    const val VPN_DOWN = "vpn_down"
    const val VPN_TAKEN = "vpn_taken:"
    const val ACCESSIBILITY_OFF = "accessibility_off"

    private const val ACCESSIBILITY_SERVICE = "expo.modules.freedomaccessibility.FreedomAccessibilityService"

    fun decide(
        vpnWanted: Boolean,
        vpnPaused: Boolean,
        tunnelUp: Boolean,
        alwaysOnApp: String?,
        ownPackage: String,
        accessibilityEnabled: Boolean,
        bankingActive: Boolean
    ): List<String> {
        val problems = mutableListOf<String>()
        if (vpnWanted && !vpnPaused && !tunnelUp) problems += VPN_DOWN
        if (!alwaysOnApp.isNullOrEmpty() && alwaysOnApp != ownPackage) problems += VPN_TAKEN + alwaysOnApp
        if (!accessibilityEnabled && !bankingActive) problems += ACCESSIBILITY_OFF
        return problems
    }

    fun listContains(enabled: String?, component: String): Boolean =
        !enabled.isNullOrEmpty() && enabled.split(':').any { it.equals(component, ignoreCase = true) }

    fun listWith(enabled: String?, component: String): String =
        if (enabled.isNullOrEmpty()) component else "$enabled:$component"

    fun accessibilityComponent(context: Context): String =
        "${context.packageName}/$ACCESSIBILITY_SERVICE"

    fun isAccessibilityEnabled(context: Context): Boolean = listContains(
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES),
        accessibilityComponent(context)
    )

    // Owner uid is API 31+. Older devices cannot tell whose VPN it is, so any VPN counts as up.
    // ponytail: pre-31 treats another app's VPN as ours; the phone in use is newer.
    fun isTunnelUp(context: Context): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return false
        return cm.allNetworks.any { net ->
            val caps = cm.getNetworkCapabilities(net) ?: return@any false
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || caps.ownerUid == Process.myUid())
        }
    }

    fun evaluate(context: Context): List<String> {
        val now = System.currentTimeMillis()
        return decide(
            vpnWanted = VpnWatchdog.isVpnWanted(context),
            vpnPaused = now < VpnWatchdog.pausedUntil(context),
            tunnelUp = isTunnelUp(context),
            alwaysOnApp = Settings.Secure.getString(context.contentResolver, "always_on_vpn_app"),
            ownPackage = context.packageName,
            accessibilityEnabled = isAccessibilityEnabled(context),
            bankingActive = now < context.getSharedPreferences("freedom_settings", Context.MODE_PRIVATE)
                .getLong("banking_until", 0L)
        )
    }
}
