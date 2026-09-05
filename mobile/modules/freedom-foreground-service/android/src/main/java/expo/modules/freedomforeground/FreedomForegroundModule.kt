package expo.modules.freedomforeground

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class FreedomForegroundModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("FreedomForegroundModule")

        AsyncFunction("startService") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: run {
                        promise.reject("ERR_NO_CONTEXT", "No React context", null)
                        return@AsyncFunction
                    }
                val intent = Intent(context, FreedomForegroundService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_FOREGROUND_START", e.message, e)
            }
        }

        AsyncFunction("stopService") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: run {
                        promise.reject("ERR_NO_CONTEXT", "No React context", null)
                        return@AsyncFunction
                    }
                val intent = Intent(context, FreedomForegroundService::class.java)
                context.stopService(intent)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_FOREGROUND_STOP", e.message, e)
            }
        }

        AsyncFunction("isServiceRunning") { promise: Promise ->
            promise.resolve(FreedomForegroundService.isRunning)
        }

        AsyncFunction("updateNotification") { title: String?, text: String?, promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: run {
                        promise.reject("ERR_NO_CONTEXT", "No React context", null)
                        return@AsyncFunction
                    }
                val intent = Intent(context, FreedomForegroundService::class.java).apply {
                    action = FreedomForegroundService.ACTION_UPDATE_NOTIFICATION
                    title?.let { putExtra(FreedomForegroundService.EXTRA_TITLE, it) }
                    text?.let { putExtra(FreedomForegroundService.EXTRA_TEXT, it) }
                }
                context.startService(intent)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_FOREGROUND_UPDATE", e.message, e)
            }
        }

        AsyncFunction("setAutoStart") { enabled: Boolean, promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: run {
                        promise.reject("ERR_NO_CONTEXT", "No React context", null)
                        return@AsyncFunction
                    }
                val prefs = context.getSharedPreferences(
                    BootReceiver.PREFS_NAME,
                    Context.MODE_PRIVATE
                )
                prefs.edit().putBoolean(BootReceiver.KEY_AUTO_START, enabled).apply()
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_AUTO_START", e.message, e)
            }
        }

        // Banking mode switches the accessibility service off, so the usage-stats
        // guard is the only thing blocking apps during that window. Settings uses
        // this to refuse starting banking while the grant is missing.
        AsyncFunction("hasUsageStatsPermission") { promise: Promise ->
            val context = appContext.reactContext
            if (context == null) {
                promise.resolve(false)
                return@AsyncFunction
            }
            promise.resolve(BankingAppGuard.hasUsageStatsPermission(context))
        }

        AsyncFunction("openUsageStatsSettings") { promise: Promise ->
            val context = appContext.reactContext
            if (context == null) {
                promise.reject("NO_CONTEXT", "React context unavailable", null)
                return@AsyncFunction
            }
            try {
                val intent = android.content.Intent(
                    android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS
                ).apply { flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK }
                context.startActivity(intent)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("OPEN_FAILED", e.message, e)
            }
        }

        AsyncFunction("isAutoStartEnabled") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: run {
                        promise.resolve(true)
                        return@AsyncFunction
                    }
                val prefs = context.getSharedPreferences(
                    BootReceiver.PREFS_NAME,
                    Context.MODE_PRIVATE
                )
                promise.resolve(prefs.getBoolean(BootReceiver.KEY_AUTO_START, true))
            } catch (e: Exception) {
                promise.resolve(true)
            }
        }
    }
}
