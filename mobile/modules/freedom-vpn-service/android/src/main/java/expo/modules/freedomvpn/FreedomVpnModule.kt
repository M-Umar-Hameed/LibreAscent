package expo.modules.freedomvpn

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class FreedomVpnModule : Module() {

    private var domainBlockedReceiver: BroadcastReceiver? = null
    private var vpnStatusReceiver: BroadcastReceiver? = null

    // Blocked-domain events are buffered and flushed on a fixed interval so an
    // ad-heavy page wakes the JS thread once instead of once per blocked
    // request. The buffer is only ever touched from the main thread
    // (LocalBroadcastManager delivery and the flush handler both run there).
    // Teardown runs on another thread and must not touch it.
    private val flushHandler = Handler(Looper.getMainLooper())
    private val pendingBlocked = mutableListOf<Map<String, Any?>>()
    private var flushScheduled = false

    private val flushRunnable = Runnable {
        flushScheduled = false
        val batch = pendingBlocked.toList()
        pendingBlocked.clear()
        for (payload in batch) {
            try {
                sendEvent("onDomainBlocked", payload)
            } catch (_: Exception) {}
        }
    }

    override fun definition() = ModuleDefinition {
        Name("FreedomVpnModule")

        Events("onDomainBlocked", "onVpnStatusChanged")

        OnCreate {
            registerReceivers()
        }

        OnDestroy {
            unregisterReceivers()
        }

        AsyncFunction("prepareVpn") { promise: Promise ->
            try {
                val activity = appContext.currentActivity
                    ?: run {
                        promise.resolve(false)
                        return@AsyncFunction
                    }

                val intent = VpnService.prepare(activity)
                if (intent != null) {
                    // Need VPN permission — launch system dialog
                    activity.startActivityForResult(intent, VPN_REQUEST_CODE)
                    promise.resolve(false)
                } else {
                    // Already prepared
                    promise.resolve(true)
                }
            } catch (e: Exception) {
                promise.reject("ERR_VPN_PREPARE", e.message, e)
            }
        }

        AsyncFunction("startVpn") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: run {
                        promise.reject("ERR_NO_CONTEXT", "No React context", null)
                        return@AsyncFunction
                    }

                val intent = Intent(context, FreedomVpnService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_VPN_START", e.message, e)
            }
        }

        AsyncFunction("stopVpn") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: run {
                        promise.reject("ERR_NO_CONTEXT", "No React context", null)
                        return@AsyncFunction
                    }
                // The one deliberate off switch: clear the intent first or
                // VpnWatchdog restarts what we are about to stop. A crash does
                // not clear it, so a crash still gets restarted.
                FreedomVpnService.setVpnWanted(context, false)
                FreedomVpnService.setAlwaysOn(context, false)
                val intent = Intent(context, FreedomVpnService::class.java)
                context.stopService(intent)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_VPN_STOP", e.message, e)
            }
        }

        AsyncFunction("isVpnActive") { promise: Promise ->
            promise.resolve(FreedomVpnService.isRunning)
        }

        AsyncFunction("isVpnPrepared") { promise: Promise ->
            val context = appContext.reactContext
                ?: run {
                    promise.resolve(false)
                    return@AsyncFunction
                }
            promise.resolve(VpnService.prepare(context) == null)
        }

        // Always-on restarts the tunnel before any app gets a packet out, which
        // the watchdog cannot. Only the Settings app can turn it on.
        AsyncFunction("isAlwaysOnVpnEnabled") { promise: Promise ->
            val context = appContext.reactContext
                ?: run {
                    promise.resolve(false)
                    return@AsyncFunction
                }
            val current = Settings.Secure.getString(
                context.contentResolver,
                "always_on_vpn_app"
            )
            promise.resolve(current == context.packageName)
        }

        AsyncFunction("openVpnSettings") { promise: Promise ->
            val context = appContext.reactContext
                ?: run {
                    promise.reject("ERR_NO_CONTEXT", "No React context", null)
                    return@AsyncFunction
                }
            try {
                context.startActivity(
                    Intent("android.net.vpn.SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_VPN_SETTINGS", e.message, e)
            }
        }

        AsyncFunction("updateBlocklist") { domains: List<String>, promise: Promise ->
            try {
                FreedomVpnService.blocklist.setDomains(domains)
                appContext.reactContext?.let { BlocklistPersistence.saveUserDomains(it, domains) }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_VPN_BLOCKLIST", e.message, e)
            }
        }

        AsyncFunction("addCategory") { name: String, domains: List<String>, replace: Boolean, promise: Promise ->
            try {
                FreedomVpnService.blocklist.addCategory(name, domains, replace)
                appContext.reactContext?.let {
                    BlocklistPersistence.saveCategory(it, name, domains, replace)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_VPN_CATEGORY", e.message, e)
            }
        }

        // Ends a stream of addCategory batches. Until it runs the batches sit in
        // a staging file, so a sync killed midway never leaves a partial
        // category for the next tunnel start to load.
        AsyncFunction("finalizeCategory") { name: String, promise: Promise ->
            appContext.reactContext?.let { BlocklistPersistence.finalizeCategory(it, name) }
            promise.resolve(null)
        }

        // Resolves whether the tunnel holds the category, in memory or on disk.
        // When it does, the caller can skip re-streaming it.
        AsyncFunction("setCategoryEnabled") { name: String, enabled: Boolean, promise: Promise ->
            val context = appContext.reactContext
                ?: run {
                    promise.reject("ERR_NO_CONTEXT", "No React context", null)
                    return@AsyncFunction
                }
            FreedomVpnService.setCategoryEnabled(context, name, enabled)
            promise.resolve(
                FreedomVpnService.blocklist.hasCategory(name) ||
                    BlocklistPersistence.hasCategory(context, name)
            )
        }

        // Lets a launch skip a re-push only for a category the tunnel actually
        // has. Falls back to the disk copy, which a stopped or still-loading
        // tunnel installs when it starts.
        AsyncFunction("getCategorySize") { name: String, promise: Promise ->
            val held = FreedomVpnService.blocklist.categorySize(name)
            promise.resolve(
                if (held > 0) held
                else appContext.reactContext?.let { BlocklistPersistence.categorySize(it, name) } ?: 0
            )
        }

        AsyncFunction("removeCategory") { name: String, promise: Promise ->
            try {
                FreedomVpnService.blocklist.removeCategory(name)
                appContext.reactContext?.let { BlocklistPersistence.deleteCategory(it, name) }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_VPN_CATEGORY_REMOVE", e.message, e)
            }
        }

        AsyncFunction("setWhitelist") { domains: List<String>, promise: Promise ->
            try {
                FreedomVpnService.blocklist.setWhitelist(domains)
                appContext.reactContext?.let { BlocklistPersistence.saveWhitelist(it, domains) }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_VPN_WHITELIST", e.message, e)
            }
        }

        // Takes effect on the next pinned lookup; clients keep a pinned answer
        // until its TTL runs out.
        AsyncFunction("setSafeSearch") { enabled: Boolean, promise: Promise ->
            val context = appContext.reactContext
                ?: run {
                    promise.reject("ERR_NO_CONTEXT", "No React context", null)
                    return@AsyncFunction
                }
            FreedomVpnService.setSafeSearch(context, enabled)
            promise.resolve(null)
        }

        AsyncFunction("getBlockedCount") { promise: Promise ->
            promise.resolve(FreedomVpnService.blockedCount)
        }

        AsyncFunction("getBlocklistSize") { promise: Promise ->
            promise.resolve(FreedomVpnService.blocklist.size())
        }
    }

    /**
     * Register broadcast receivers to forward native events to JS.
     */
    private fun registerReceivers() {
        val context = appContext.reactContext ?: return
        val lbm = LocalBroadcastManager.getInstance(context)

        // Domain blocked events
        domainBlockedReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val domain = intent?.getStringExtra(FreedomVpnService.EXTRA_DOMAIN) ?: return
                pendingBlocked.add(mapOf(
                    "domain" to domain,
                    "timestamp" to System.currentTimeMillis()
                ))
                if (!flushScheduled) {
                    flushScheduled = true
                    flushHandler.postDelayed(flushRunnable, FLUSH_INTERVAL_MS)
                }
            }
        }
        lbm.registerReceiver(
            domainBlockedReceiver!!,
            IntentFilter(FreedomVpnService.ACTION_DOMAIN_BLOCKED)
        )

        // VPN status events
        vpnStatusReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val active = intent?.getBooleanExtra("active", false) ?: return
                try {
                    sendEvent("onVpnStatusChanged", mapOf(
                        "active" to active
                    ))
                } catch (_: Exception) {
                    // Event might fail if no JS listeners
                }
            }
        }
        lbm.registerReceiver(
            vpnStatusReceiver!!,
            IntentFilter("expo.modules.freedomvpn.VPN_STATUS")
        )
    }

    /**
     * Unregister broadcast receivers.
     */
    private fun unregisterReceivers() {
        val context = appContext.reactContext ?: return
        val lbm = LocalBroadcastManager.getInstance(context)

        domainBlockedReceiver?.let { lbm.unregisterReceiver(it) }
        vpnStatusReceiver?.let { lbm.unregisterReceiver(it) }

        // removeCallbacks is thread-safe; the buffer itself must not be touched
        // here because teardown does not run on the main thread. It dies with
        // the module instance.
        flushHandler.removeCallbacks(flushRunnable)

        domainBlockedReceiver = null
        vpnStatusReceiver = null
    }

    companion object {
        const val VPN_REQUEST_CODE = 24601
        private const val FLUSH_INTERVAL_MS = 1000L
    }
}
