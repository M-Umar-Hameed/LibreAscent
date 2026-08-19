package expo.modules.freedomvpn

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class FreedomVpnModule : Module() {

    private var domainBlockedReceiver: BroadcastReceiver? = null
    private var vpnStatusReceiver: BroadcastReceiver? = null

    // Blocked-domain events are buffered and flushed on a fixed interval so an
    // ad-heavy page wakes the JS thread once instead of once per blocked
    // request. Touched only from the main thread (LocalBroadcastManager
    // delivery and the flush handler both run there).
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

        AsyncFunction("updateBlocklist") { domains: List<String>, promise: Promise ->
            try {
                FreedomVpnService.blocklist.setDomains(domains)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_VPN_BLOCKLIST", e.message, e)
            }
        }

        AsyncFunction("addCategory") { name: String, domains: List<String>, replace: Boolean, promise: Promise ->
            try {
                FreedomVpnService.blocklist.addCategory(name, domains, replace)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_VPN_CATEGORY", e.message, e)
            }
        }

        AsyncFunction("removeCategory") { name: String, promise: Promise ->
            try {
                FreedomVpnService.blocklist.removeCategory(name)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_VPN_CATEGORY_REMOVE", e.message, e)
            }
        }

        AsyncFunction("setWhitelist") { domains: List<String>, promise: Promise ->
            try {
                FreedomVpnService.blocklist.setWhitelist(domains)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_VPN_WHITELIST", e.message, e)
            }
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

        flushHandler.removeCallbacks(flushRunnable)
        flushScheduled = false
        pendingBlocked.clear()

        domainBlockedReceiver = null
        vpnStatusReceiver = null
    }

    companion object {
        const val VPN_REQUEST_CODE = 24601
        private const val FLUSH_INTERVAL_MS = 1000L
    }
}
