package expo.modules.freedomdeviceadmin

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class FreedomDeviceAdminModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("FreedomDeviceAdminModule")

        AsyncFunction("isAdminActive") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: run {
                        promise.resolve(false)
                        return@AsyncFunction
                    }
                val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                val componentName = ComponentName(context, FreedomDeviceAdminReceiver::class.java)
                promise.resolve(dpm.isAdminActive(componentName))
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }

        AsyncFunction("requestAdminActivation") { promise: Promise ->
            try {
                val activity = appContext.currentActivity
                    ?: run {
                        promise.reject("ERR_NO_ACTIVITY", "No activity", null)
                        return@AsyncFunction
                    }
                val context = appContext.reactContext
                    ?: run {
                        promise.reject("ERR_NO_CONTEXT", "No context", null)
                        return@AsyncFunction
                    }
                val componentName = ComponentName(context, FreedomDeviceAdminReceiver::class.java)
                val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
                    putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, componentName)
                    putExtra(
                        DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                        "Freedom needs Device Administrator access to prevent accidental uninstallation. This ensures continuous protection."
                    )
                }
                activity.startActivityForResult(intent, ADMIN_REQUEST_CODE)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_DEVICE_ADMIN", e.message, e)
            }
        }
    }

    companion object {
        const val ADMIN_REQUEST_CODE = 24602
    }
}
