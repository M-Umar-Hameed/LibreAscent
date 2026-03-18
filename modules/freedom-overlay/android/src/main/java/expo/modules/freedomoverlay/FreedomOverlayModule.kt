package expo.modules.freedomoverlay

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class FreedomOverlayModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("FreedomOverlayModule")

        AsyncFunction("hasOverlayPermission") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: run {
                        promise.resolve(false)
                        return@AsyncFunction
                    }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    promise.resolve(Settings.canDrawOverlays(context))
                } else {
                    promise.resolve(true)
                }
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }

        AsyncFunction("requestOverlayPermission") { promise: Promise ->
            try {
                val activity = appContext.currentActivity
                    ?: run {
                        promise.reject("ERR_NO_ACTIVITY", "No activity", null)
                        return@AsyncFunction
                    }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val intent = Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:${activity.packageName}")
                    )
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    activity.startActivity(intent)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_OVERLAY_PERMISSION", e.message, e)
            }
        }

        AsyncFunction("showOverlay") { message: String?, promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: run {
                        promise.reject("ERR_NO_CONTEXT", "No React context", null)
                        return@AsyncFunction
                    }

                // Check permission first
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                    !Settings.canDrawOverlays(context)) {
                    promise.reject("ERR_NO_PERMISSION", "Overlay permission not granted", null)
                    return@AsyncFunction
                }

                val intent = Intent(context, OverlayService::class.java).apply {
                    action = OverlayService.ACTION_SHOW
                    message?.let { putExtra(OverlayService.EXTRA_MESSAGE, it) }
                }
                context.startService(intent)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_OVERLAY_SHOW", e.message, e)
            }
        }

        AsyncFunction("hideOverlay") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: run {
                        promise.reject("ERR_NO_CONTEXT", "No React context", null)
                        return@AsyncFunction
                    }
                val intent = Intent(context, OverlayService::class.java).apply {
                    action = OverlayService.ACTION_HIDE
                }
                context.startService(intent)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_OVERLAY_HIDE", e.message, e)
            }
        }

        AsyncFunction("isOverlayShowing") { promise: Promise ->
            promise.resolve(OverlayService.isShowing)
        }
    }
}
