package expo.modules.freedomdeviceadmin

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast

/**
 * Device Admin Receiver — prevents uninstallation.
 * Shows warning when user tries to deactivate admin.
 */
class FreedomDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Toast.makeText(context, "Freedom: Device admin enabled", Toast.LENGTH_SHORT).show()
    }

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        return "Disabling device admin will allow Freedom to be uninstalled. Your content blocking protection will stop."
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Toast.makeText(context, "Freedom: Device admin disabled", Toast.LENGTH_SHORT).show()
    }
}
