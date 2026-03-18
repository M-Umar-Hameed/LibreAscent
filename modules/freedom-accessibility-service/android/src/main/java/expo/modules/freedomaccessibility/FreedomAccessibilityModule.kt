package expo.modules.freedomaccessibility

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.provider.Settings
import android.text.TextUtils
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class FreedomAccessibilityModule : Module() {

    companion object {
        var cachedInstalledApps: List<Map<String, String>>? = null
    }

    // Shared fallback matcher used when the Accessibility Service is not running.
    // Keeps batched appendCategoryDomains calls accumulated across invocations.
    private var fallbackMatcher: ContentMatcher? = null

    private fun getOrCreateFallbackMatcher(context: android.content.Context): ContentMatcher {
        var m = fallbackMatcher
        if (m == null) {
            m = ContentMatcher()
            m.loadPersistedData(context)
            fallbackMatcher = m
        }
        return m
    }

    private var urlBlockedReceiver: BroadcastReceiver? = null
    private var reelsDetectedReceiver: BroadcastReceiver? = null

    override fun definition() = ModuleDefinition {
        Name("FreedomAccessibilityModule")

        Events("onUrlBlocked", "onReelsDetected")

        OnCreate {
            registerReceivers()
            // Prefetch installed apps silently in the background so it's ready for the UX
            java.lang.Thread {
                prefetchInstalledApps(appContext.reactContext)
            }.start()
        }

        OnDestroy {
            unregisterReceivers()
        }

        AsyncFunction("isAccessibilityEnabled") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: run {
                        promise.resolve(false)
                        return@AsyncFunction
                    }
                promise.resolve(isServiceEnabled(context))
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }

        AsyncFunction("openAccessibilitySettings") { promise: Promise ->
            try {
                val activity = appContext.currentActivity
                    ?: run {
                        promise.reject("ERR_NO_ACTIVITY", "No activity", null)
                        return@AsyncFunction
                    }
                val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(intent)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_ACCESSIBILITY_SETTINGS", e.message, e)
            }
        }

        AsyncFunction("updateBrowserConfigs") { configs: List<Map<String, Any>>, promise: Promise ->
            try {
                val browserConfigs = configs.map { config ->
                    BrowserUrlMonitor.BrowserConfig(
                        name = config["name"] as? String ?: "",
                        packageName = config["packageName"] as? String ?: "",
                        urlBarId = config["urlBarId"] as? String ?: ""
                    )
                }

                val monitor = FreedomAccessibilityService.sharedBrowserMonitor
                if (monitor != null) {
                    // Service is running — update directly and persist
                    monitor.updateConfigs(browserConfigs, appContext.reactContext)
                } else {
                    // Service not yet ready — buffer for when it connects
                    FreedomAccessibilityService.pendingBrowserConfigs = browserConfigs
                    // Also persist so next service startup picks them up
                    val context = appContext.reactContext
                    if (context != null) {
                        val tempMonitor = BrowserUrlMonitor()
                        tempMonitor.updateConfigs(browserConfigs, context)
                    }
                }

                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_BROWSER_CONFIGS", e.message, e)
            }
        }

        AsyncFunction("updateReelsConfigs") { configs: List<Map<String, Any>>, promise: Promise ->
            try {
                val reelsConfigs = configs.map { config ->
                    @Suppress("UNCHECKED_CAST")
                    val nodes = (config["detectionNodes"] as? List<String>) ?: emptyList()
                    ReelsDetector.ReelsAppConfig(
                        name = config["name"] as? String ?: "",
                        packageName = config["packageName"] as? String ?: "",
                        detectionNodes = nodes
                    )
                }

                // Update the running service's detector
                FreedomAccessibilityService.sharedReelsDetector?.updateConfigs(reelsConfigs)

                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_REELS_CONFIGS", e.message, e)
            }
        }

        AsyncFunction("updateBlockedDomains") { domains: List<String>, promise: Promise ->
            try {
                val context = appContext.reactContext
                val matcher = FreedomAccessibilityService.sharedContentMatcher
                if (matcher != null) {
                    matcher.setDomains(domains, context)
                } else if (context != null) {
                    // Service not running, persist directly
                    ContentMatcher().setDomains(domains, context)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_BLOCKED_DOMAINS", e.message, e)
            }
        }

        AsyncFunction("updateBlockedKeywords") { keywords: List<String>, promise: Promise ->
            try {
                val context = appContext.reactContext
                val matcher = FreedomAccessibilityService.sharedContentMatcher
                if (matcher != null) {
                    matcher.setKeywords(keywords, context)
                } else if (context != null) {
                    // Service not running, persist directly
                    ContentMatcher().setKeywords(keywords, context)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_BLOCKED_KEYWORDS", e.message, e)
            }
        }

        AsyncFunction("updateAdultBlockingEnabled") { enabled: Boolean, promise: Promise ->
            try {
                Log.i("FreedomAccessibilityModule", "updateAdultBlockingEnabled: $enabled")
                val context = appContext.reactContext
                val matcher = FreedomAccessibilityService.sharedContentMatcher
                if (matcher != null) {
                    matcher.setAdultBlockingEnabled(enabled, context)
                } else if (context != null) {
                    ContentMatcher().setAdultBlockingEnabled(enabled, context)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_ADULT_BLOCKING", e.message, e)
            }
        }

        AsyncFunction("updateCategoryDomains") { categoryId: String, domains: List<String>, promise: Promise ->
            try {
                val context = appContext.reactContext
                val matcher = FreedomAccessibilityService.sharedContentMatcher
                if (matcher != null) {
                    matcher.setCategoryDomains(categoryId, domains, context)
                } else if (context != null) {
                    val tempMatcher = ContentMatcher()
                    tempMatcher.loadPersistedData(context)
                    tempMatcher.setCategoryDomains(categoryId, domains, context)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_CATEGORY_DOMAINS", e.message, e)
            }
        }

        AsyncFunction("clearCategoryDomains") { categoryId: String, promise: Promise ->
            try {
                val context = appContext.reactContext
                val matcher = FreedomAccessibilityService.sharedContentMatcher
                if (matcher != null) {
                    matcher.clearCategoryDomains(categoryId, context)
                } else if (context != null) {
                    getOrCreateFallbackMatcher(context).clearCategoryDomains(categoryId, context)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_CLEAR_CATEGORY", e.message, e)
            }
        }

        AsyncFunction("getCategoryDomainCount") { categoryId: String, promise: Promise ->
            try {
                val matcher = FreedomAccessibilityService.sharedContentMatcher
                if (matcher != null) {
                    promise.resolve(matcher.getCategoryDomainCount(categoryId))
                } else {
                    val context = appContext.reactContext
                    if (context != null) {
                        promise.resolve(getOrCreateFallbackMatcher(context).getCategoryDomainCount(categoryId))
                    } else {
                        promise.resolve(0)
                    }
                }
            } catch (e: Exception) {
                promise.reject("ERR_GET_COUNT", e.message, e)
            }
        }

        AsyncFunction("appendCategoryDomains") { categoryId: String, domains: List<String>, promise: Promise ->
            try {
                val matcher = FreedomAccessibilityService.sharedContentMatcher
                if (matcher != null) {
                    matcher.appendCategoryDomains(categoryId, domains)
                } else {
                    // Service not running — use a shared fallback matcher so batched
                    // appends accumulate across calls instead of being discarded.
                    val context = appContext.reactContext
                    if (context != null) {
                        val fallback = getOrCreateFallbackMatcher(context)
                        fallback.appendCategoryDomains(categoryId, domains)
                    }
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_APPEND_DOMAINS", e.message, e)
            }
        }

        AsyncFunction("finalizeCategorySync") { categoryId: String, promise: Promise ->
            try {
                val context = appContext.reactContext
                val matcher = FreedomAccessibilityService.sharedContentMatcher
                if (matcher != null) {
                    matcher.finalizeCategorySync(categoryId, context)
                } else if (context != null) {
                    // Use the shared fallback matcher that accumulated batched domains
                    val fallback = getOrCreateFallbackMatcher(context)
                    fallback.finalizeCategorySync(categoryId, context)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_FINALIZE_SYNC", e.message, e)
            }
        }

        AsyncFunction("setCategoryEnabled") { categoryId: String, enabled: Boolean, promise: Promise ->
            try {
                val context = appContext.reactContext
                val matcher = FreedomAccessibilityService.sharedContentMatcher
                if (matcher != null) {
                    matcher.setCategoryEnabled(categoryId, enabled, context)
                } else if (context != null) {
                    val tempMatcher = ContentMatcher()
                    tempMatcher.loadPersistedData(context)
                    tempMatcher.setCategoryEnabled(categoryId, enabled, context)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_CATEGORY_ENABLED", e.message, e)
            }
        }

        AsyncFunction("setIncludedDomains") { domains: List<String>, promise: Promise ->
            try {
                val context = appContext.reactContext
                val matcher = FreedomAccessibilityService.sharedContentMatcher
                if (matcher != null) {
                    matcher.setIncludedDomains(domains, context)
                } else if (context != null) {
                    val tempMatcher = ContentMatcher()
                    tempMatcher.loadPersistedData(context)
                    tempMatcher.setIncludedDomains(domains, context)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_INCLUDED_DOMAINS", e.message, e)
            }
        }

        AsyncFunction("updateBlockedApps") { configs: List<Map<String, Any>>, promise: Promise ->
            try {
                val context = appContext.reactContext
                val appConfigs = configs.map { map ->
                    ContentMatcher.AppConfig(
                        packageName = map["packageName"] as? String ?: "",
                        appName = map["appName"] as? String ?: "",
                        surveillanceType = map["surveillanceType"] as? String ?: "none",
                        surveillanceValue = (map["surveillanceValue"] as? Number)?.toInt() ?: 0,
                        startTime = map["startTime"] as? String,
                        endTime = map["endTime"] as? String
                    )
                }
                
                val matcher = FreedomAccessibilityService.sharedContentMatcher
                if (matcher != null) {
                    matcher.setBlockedApps(appConfigs, context)
                } else if (context != null) {
                    ContentMatcher().setBlockedApps(appConfigs, context)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_BLOCKED_APPS", e.message, e)
            }
        }

        AsyncFunction("updateWhitelist") { domains: List<String>, promise: Promise ->
            try {
                val context = appContext.reactContext
                val matcher = FreedomAccessibilityService.sharedContentMatcher
                if (matcher != null) {
                    matcher.setWhitelist(domains, context)
                } else if (context != null) {
                    // Service not running, persist directly
                    ContentMatcher().setWhitelist(domains, context)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_WHITELIST", e.message, e)
            }
        }

        AsyncFunction("updateHardcoreMode") { enabled: Boolean, promise: Promise ->
            try {
                val context = appContext.reactContext
                val packageName = context?.packageName ?: ""

                // Persist to SharedPreferences so the service can read it on startup
                context?.getSharedPreferences("freedom_settings", Context.MODE_PRIVATE)
                    ?.edit()
                    ?.putBoolean("hardcore_mode", enabled)
                    ?.putString("app_package", packageName)
                    ?.apply()

                // Also update the live service if it's running
                FreedomAccessibilityService.sharedSettingsProtector?.updateConfig(enabled, packageName)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_HARDCORE_MODE", e.message, e)
            }
        }

        AsyncFunction("getInstalledApps") { promise: Promise ->
            if (cachedInstalledApps != null) {
                promise.resolve(cachedInstalledApps!!)
                return@AsyncFunction
            }

            val context = appContext.reactContext ?: run {
                promise.resolve(emptyList<Map<String, String>>())
                return@AsyncFunction
            }
            
            java.lang.Thread {
                try {
                    val apps = prefetchInstalledApps(context)
                    promise.resolve(apps)
                } catch (e: Exception) {
                    promise.reject("ERR_GET_APPS", e.message, e)
                }
            }.start()
        }
    }

    private fun prefetchInstalledApps(context: Context?): List<Map<String, String>> {
        if (context == null) return emptyList()
        val pm = context.packageManager
        val intent = android.content.Intent(android.content.Intent.ACTION_MAIN, null)
        intent.addCategory(android.content.Intent.CATEGORY_LAUNCHER)
        
        val activities = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            pm.queryIntentActivities(
                intent,
                android.content.pm.PackageManager.ResolveInfoFlags.of(0L)
            )
        } else {
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(intent, 0)
        }

        val result = mutableListOf<Map<String, String>>()
        
        for (resolveInfo in activities) {
            val packageName = resolveInfo.activityInfo.packageName
            val name = resolveInfo.loadLabel(pm).toString()
            result.add(mapOf(
                "name" to name,
                "packageName" to packageName
            ))
        }
        
        // Deduplicate and sort alphabetically
        val uniqueSorted = result
            .distinctBy { it["packageName"] }
            .sortedBy { it["name"]?.lowercase() }
            
        cachedInstalledApps = uniqueSorted
        return uniqueSorted
    }

    private fun isServiceEnabled(context: Context): Boolean {
        val serviceName = "${context.packageName}/${FreedomAccessibilityService::class.java.canonicalName}"
        val enabledServices = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false

        val colonSplitter = TextUtils.SimpleStringSplitter(':')
        colonSplitter.setString(enabledServices)
        while (colonSplitter.hasNext()) {
            val componentName = colonSplitter.next()
            if (componentName.equals(serviceName, ignoreCase = true)) {
                return true
            }
        }
        return false
    }

    /**
     * Register broadcast receivers to forward native events to JS.
     */
    private fun registerReceivers() {
        val context = appContext.reactContext ?: return
        val lbm = LocalBroadcastManager.getInstance(context)

        // URL blocked events
        urlBlockedReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val url = intent?.getStringExtra(FreedomAccessibilityService.EXTRA_URL) ?: return
                try {
                    sendEvent("onUrlBlocked", mapOf(
                        "url" to url,
                        "domain" to (intent.getStringExtra(FreedomAccessibilityService.EXTRA_DOMAIN) ?: ""),
                        "matchType" to (intent.getStringExtra(FreedomAccessibilityService.EXTRA_MATCH_TYPE) ?: ""),
                        "matchedValue" to (intent.getStringExtra(FreedomAccessibilityService.EXTRA_MATCHED_VALUE) ?: ""),
                        "timestamp" to System.currentTimeMillis()
                    ))
                } catch (_: Exception) {}
            }
        }
        lbm.registerReceiver(
            urlBlockedReceiver!!,
            IntentFilter(FreedomAccessibilityService.ACTION_URL_BLOCKED)
        )

        // Reels detection events
        reelsDetectedReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val packageName = intent?.getStringExtra(FreedomAccessibilityService.EXTRA_PACKAGE_NAME) ?: return
                try {
                    sendEvent("onReelsDetected", mapOf(
                        "appName" to (intent.getStringExtra(FreedomAccessibilityService.EXTRA_APP_NAME) ?: ""),
                        "packageName" to packageName,
                        "isInReels" to intent.getBooleanExtra(FreedomAccessibilityService.EXTRA_IS_IN_REELS, false),
                        "timestamp" to System.currentTimeMillis()
                    ))
                } catch (_: Exception) {}
            }
        }
        lbm.registerReceiver(
            reelsDetectedReceiver!!,
            IntentFilter(FreedomAccessibilityService.ACTION_REELS_DETECTED)
        )
    }

    private fun unregisterReceivers() {
        val context = appContext.reactContext ?: return
        val lbm = LocalBroadcastManager.getInstance(context)

        urlBlockedReceiver?.let { lbm.unregisterReceiver(it) }
        reelsDetectedReceiver?.let { lbm.unregisterReceiver(it) }

        urlBlockedReceiver = null
        reelsDetectedReceiver = null
    }
}
