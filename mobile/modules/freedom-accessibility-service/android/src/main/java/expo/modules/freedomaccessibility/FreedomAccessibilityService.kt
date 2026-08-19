package expo.modules.freedomaccessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.widget.ImageView
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.localbroadcastmanager.content.LocalBroadcastManager

/**
 * Freedom Accessibility Service - URL monitoring + Reels detection.
 *
 * Layer 2 + Layer 3 of the content blocking architecture:
 * - Layer 2: Monitors browser URL bars to catch content the VPN didn't block
 * - Layer 3: Detects reels/shorts sections in social media apps
 *
 * When harmful content is detected, broadcasts an event to trigger the overlay.
 */
class FreedomAccessibilityService : AccessibilityService() {

    private val browserMonitor = BrowserUrlMonitor()
    private val reelsDetector = ReelsDetector()
    private val contentMatcher = ContentMatcher()
    private val settingsProtector = SettingsProtector()
    private var currentPackage: String = ""

    // Instant overlay drawn directly by the accessibility service
    private var windowManager: WindowManager? = null
    private var instantOverlay: FrameLayout? = null
    private var isInstantOverlayShowing = false
    private var reelsOverlayPackage: String? = null
    private val handler = Handler(Looper.getMainLooper())
    private var packageAddedReceiver: PackageAddedReceiver? = null
    private var lastUrlCheckTime: Long = 0
    private var consecutiveBlockCount = 0
    private var lastCheckUrl: String = ""
    private var blockCooldownUntil: Long = 0
    private var lastFullScanAt: Long = 0
    private var fullScanPending = false
    // Remember the last whitelisted domain per browser, so text-only events still get context
    private var lastWhitelistedDomain: String? = null
    private var lastWhitelistedPackage: String? = null
    // True while the expensive event/flag set is subscribed. Guards setServiceInfo
    // so it runs on scope transitions only, never per event.
    private var deepInspectionEnabled = false
    private var scopeDowngradePending = false
    // When an in-app/detached WebView last announced itself. Such packages cannot
    // be known in advance, so the WebView's own events are the only signal, and a
    // timestamp cannot be pointed at the wrong package by a transient window.
    private var webviewSeenAt: Long = 0

    companion object {
        private const val TAG = "FreedomA11y"
        private const val OVERLAY_DURATION_MS = 5000L
        private val OVERLAY_DISMISS_TOKEN = Any()
        private val SCOPE_TOKEN = Any()
        private val REPROBE_TOKEN = Any()
        private val FULL_SCAN_TOKEN = Any()

        // Content-changed stays subscribed for every package: an in-app WebView
        // lives in a package we cannot enumerate, and its events are the only
        // way to discover it. The device-wide tax this task targets is the two
        // node/window flags, so those plus text and focus events are the part
        // that is scoped to the foreground app.
        private val IDLE_EVENT_TYPES = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_WINDOWS_CHANGED or
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        private val DEEP_EVENT_TYPES = IDLE_EVENT_TYPES or
                AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED or
                AccessibilityEvent.TYPE_VIEW_FOCUSED
        private val IDLE_FLAGS = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
        private val DEEP_FLAGS = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
                AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        private const val NOTIFICATION_TIMEOUT_MS = 100L
        // Transient windows (IME, shade, recents, edge panels) report their own
        // package while a monitored app stays foreground. Re-resolve the real
        // foreground window this long after such an event instead of trusting it.
        private const val SCOPE_DOWNGRADE_DELAY_MS = 1000L
        // Flags take effect asynchronously, so the event that triggered an
        // upgrade is handled without them. Re-run the tamper check once they land.
        private const val SCOPE_REPROBE_DELAY_MS = 400L
        // How long a sighting of an in-app WebView holds the deep scope. Long
        // enough to ride out a keyboard or shade round trip and a reading pause;
        // short enough that a closed WebView stops costing anything. Expiry is
        // safe because content-changed events are never unsubscribed, so the next
        // WebView event re-arms the hold before anything can be scanned without it.
        private const val WEBVIEW_HOLD_MS = 5000L
        // ponytail: the full-screen text pass reads every node of every browser
        // window and is the only caller that runs the per-indicator node searches,
        // so it is rate limited rather than run on each of up to ten events per
        // second. Ceiling: one leading scan plus one trailing scan per interval,
        // so a page is recognised up to this much late but never skipped. A
        // per-package or per-URL scan budget if that latency ever matters.
        private const val FULL_SCAN_MIN_INTERVAL_MS = 750L

        // Built-in keywords for NSFW app scanning (Reddit, Twitter labels)
        private val NSFW_BUILTIN_KEYWORDS = listOf(
            "NSFW",
            "18+",
            "Sensitive content",
            "Content warning",
            "Adult content",
            "Mature content"
        )

        @Volatile
        var isRunning: Boolean = false
            private set

        // ponytail: single-entry background cache, process-scoped so it survives
        // the service being disabled and re-enabled (banking mode). The theme
        // holds exactly one image; add an LruCache only if that changes.
        @Volatile
        private var cachedBackground: Bitmap? = null
        @Volatile
        private var cachedBackgroundKey: String = ""
        @Volatile
        private var backgroundDecodeInFlight = false

        // Shared instances for config updates from the Module
        var sharedBrowserMonitor: BrowserUrlMonitor? = null
            private set
        var sharedReelsDetector: ReelsDetector? = null
            private set
        var sharedContentMatcher: ContentMatcher? = null
            private set
        var sharedSettingsProtector: SettingsProtector? = null
            private set

        // Pending configs buffer - holds configs sent before service was ready
        var pendingBrowserConfigs: List<BrowserUrlMonitor.BrowserConfig>? = null

        // Broadcast actions
        const val ACTION_URL_BLOCKED = "expo.modules.freedomaccessibility.URL_BLOCKED"
        const val ACTION_REELS_DETECTED = "expo.modules.freedomaccessibility.REELS_DETECTED"
        const val EXTRA_URL = "url"
        const val EXTRA_DOMAIN = "domain"
        const val EXTRA_MATCH_TYPE = "match_type"
        const val EXTRA_MATCHED_VALUE = "matched_value"
        const val EXTRA_APP_NAME = "app_name"
        const val EXTRA_PACKAGE_NAME = "package_name"
        const val EXTRA_IS_IN_REELS = "is_in_reels"

        // Domains that indicate the browser might be showing proxied/AMP content
        private val SEARCH_ENGINE_PATTERNS = listOf(
            "google.", "bing.com", "duckduckgo.com", "yahoo.", "baidu.com",
            "yandex.", "ecosia.org", "startpage.com", "ampproject.org",
            "webcache.googleusercontent.com", "translate.google"
        )

        // Domain-like pattern used to scan the full-screen text blob fallback scan.
        private val FALLBACK_DOMAIN_PATTERN = Regex("[a-z0-9]([a-z0-9-]*[a-z0-9])?\\.[a-z0-9][a-z0-9-]*[a-z0-9](?:\\.[a-z]{2,})?")
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        isRunning = true
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager

        // Load persisted browser configs immediately so browsers are recognized
        // before JS has a chance to call updateBrowserConfigs
        browserMonitor.loadPersistedConfigs(this)
        contentMatcher.loadPersistedData(this)

        sharedBrowserMonitor = browserMonitor
        sharedReelsDetector = reelsDetector
        sharedContentMatcher = contentMatcher
        sharedSettingsProtector = settingsProtector

        // Apply any pending configs that arrived before the service was ready
        applyPendingConfigs()

        // Initialize SettingsProtector from persisted state
        val prefs = getSharedPreferences("freedom_settings", MODE_PRIVATE)
        val hardcoreEnabled = prefs.getBoolean("hardcore_mode", false)
        val appPkg = prefs.getString("app_package", packageName) ?: packageName
        settingsProtector.updateConfig(hardcoreEnabled, appPkg)
        Log.i(TAG, "SettingsProtector initialized: hardcore=$hardcoreEnabled, pkg=$appPkg")

        // Start in the idle scope; deep inspection is turned on only while a
        // monitored app is foreground.
        applyServiceScope(deep = false, force = true)

        Log.i(TAG, "Freedom Accessibility Service connected, data loaded: ${browserMonitor.getLoadedBrowserCount()} browsers")

        // Insta-stop on resume: reconnect may follow a banking window ending
        // while a blocked app is foreground. rootInActiveWindow can be null at
        // the instant of connect, so probe shortly after. The same probe seeds
        // the scope, since no window-state change may follow a reconnect.
        handler.postDelayed({
            enforceForegroundIfBlocked()
            syncScopeToForegroundWindow()
        }, 300)

        // PACKAGE_ADDED is not on the implicit-broadcast exception list, so a
        // manifest receiver never fires on API 26+; register at runtime for the
        // service's lifetime instead.
        if (packageAddedReceiver == null) {
            val filter = IntentFilter(Intent.ACTION_PACKAGE_ADDED).apply { addDataScheme("package") }
            packageAddedReceiver = PackageAddedReceiver().also { registerReceiver(it, filter) }
        }
    }

    /**
     * Apply any browser configs that were sent before the service was ready.
     */
    private fun applyPendingConfigs() {
        pendingBrowserConfigs?.let { configs ->
            browserMonitor.updateConfigs(configs, this)
            pendingBrowserConfigs = null
            Log.i(TAG, "Applied ${configs.size} pending browser configs")
        }
    }

    /**
     * Packages that need the expensive event/flag set while they are foreground.
     * Derived from live config, so it follows browser, blocked-app, reels, NSFW
     * and hardcore-mode changes without a separate list.
     */
    private fun needsDeepInspection(packageName: String): Boolean {
        return browserMonitor.isBrowser(packageName) ||
                reelsDetector.isReelsApp(packageName) ||
                contentMatcher.isNsfwMonitoredApp(packageName) ||
                contentMatcher.getAppConfig(packageName) != null ||
                (settingsProtector.isHardcoreEnabled() && isSettingsPackage(packageName))
    }

    private fun isSettingsPackage(packageName: String): Boolean {
        return packageName == "com.android.settings" ||
                packageName == "com.google.android.settings" ||
                packageName.contains("packageinstaller") ||
                packageName.contains("settings") ||
                packageName.contains("manageapp")
    }

    /**
     * Switch the subscription scope. Upgrades apply immediately. A request to
     * downgrade is never trusted on its own: it schedules a re-resolution of the
     * real foreground window, because transient windows report their own package
     * while a monitored app is still in front.
     */
    private fun updateEventScope(deep: Boolean) {
        if (deep) {
            if (deepInspectionEnabled && !scopeDowngradePending) return
            handler.removeCallbacksAndMessages(SCOPE_TOKEN)
            scopeDowngradePending = false
            applyServiceScope(true)
            return
        }
        if (!deepInspectionEnabled || scopeDowngradePending) return
        scopeDowngradePending = true
        handler.postAtTime({
            scopeDowngradePending = false
            applyServiceScope(resolveForegroundScope())
        }, SCOPE_TOKEN, android.os.SystemClock.uptimeMillis() + SCOPE_DOWNGRADE_DELAY_MS)
    }

    /**
     * Resolve the scope the currently focused window actually requires. Anything
     * unresolvable — no root, or our own overlay in front — keeps the current
     * scope rather than dropping coverage on a guess.
     */
    private fun resolveForegroundScope(): Boolean {
        if (android.os.SystemClock.uptimeMillis() - webviewSeenAt < WEBVIEW_HOLD_MS) return true
        val root = rootInActiveWindow ?: return deepInspectionEnabled
        val pkg = root.packageName?.toString()
        root.recycle()
        if (pkg.isNullOrEmpty() || pkg == applicationContext.packageName) return deepInspectionEnabled
        return needsDeepInspection(pkg)
    }

    private fun applyServiceScope(deep: Boolean, force: Boolean = false) {
        if (!force && deep == deepInspectionEnabled) return
        val info = serviceInfo ?: AccessibilityServiceInfo()
        info.eventTypes = if (deep) DEEP_EVENT_TYPES else IDLE_EVENT_TYPES
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.notificationTimeout = NOTIFICATION_TIMEOUT_MS
        info.flags = if (deep) DEEP_FLAGS else IDLE_FLAGS
        serviceInfo = info
        deepInspectionEnabled = deep
        if (deep) {
            handler.removeCallbacksAndMessages(REPROBE_TOKEN)
            handler.postAtTime({ reprobeSettingsProtection() }, REPROBE_TOKEN,
                android.os.SystemClock.uptimeMillis() + SCOPE_REPROBE_DELAY_MS)
        }
    }

    /**
     * A confirmation dialog can be fully rendered before the deep flags land and
     * emit nothing afterwards to retry on, so re-run the tamper check once they
     * have. Only the settings/installer path needs this; the other consumers get
     * a steady stream of content-changed events to retry on.
     */
    private fun reprobeSettingsProtection() {
        if (!settingsProtector.isHardcoreEnabled()) return
        val root = rootInActiveWindow ?: return
        val pkg = root.packageName?.toString()
        if (!pkg.isNullOrEmpty() && isSettingsPackage(pkg)) {
            settingsProtector.checkSettingsScreen(this, pkg, root)
        }
        root.recycle()
    }

    /**
     * Seed the scope from the currently focused window, for the case where the
     * service (re)connects while a monitored app is already foreground.
     */
    private fun syncScopeToForegroundWindow() {
        applyServiceScope(resolveForegroundScope())
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        val packageName = event.packageName?.toString() ?: return

        // Skip our own app's events
        if (packageName == applicationContext.packageName) return

        // Always intercept raw webview events even if the OS attributes them to a different package
        // (Samsung Internet often delegates rendering to Android System Webview in a detached process)
        val classNameStr = event.className?.toString()?.lowercase() ?: ""
        val isDetachedWebview = classNameStr.contains("chromium") || classNameStr.contains("webview") || classNameStr.contains("sandboxed_process")

        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            Log.d(TAG, "WINDOW STATE CHANGED | Pkg: $packageName | Class: $classNameStr")
        }

        val isBlockedApp = contentMatcher.getAppConfig(packageName) != null
        val isSettingsApp = isSettingsPackage(packageName)

        // Track current foreground app
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            // ponytail: scope follows the foreground package only. A config change
            // made while its own app is already foreground takes effect on the next
            // window-state change; push an update from the module if that ever matters.
            updateEventScope(isDetachedWebview || needsDeepInspection(packageName))
            if (packageName != currentPackage) {
                // User switched apps - reset reels state for both old and new app
                // so detection fires fresh when (re-)entering a reels app.
                if (currentPackage.isNotEmpty()) {
                    reelsDetector.resetState(currentPackage)
                    broadcastReelsDetected(ReelsDetector.DetectionResult("App", currentPackage, false))
                }
                reelsDetector.resetState(packageName)
                currentPackage = packageName
                lastCheckUrl = ""
                lastUrlCheckTime = 0
                consecutiveBlockCount = 0
                // A scan for the previous app must not rate limit the new one's first.
                lastFullScanAt = 0
                handler.removeCallbacksAndMessages(FULL_SCAN_TOKEN)
                fullScanPending = false
                // Dismiss any lingering overlay - but never dismiss a reels
                // overlay here. The reels overlay is dismissed only by the
                // "I understand" button handler, which sends the user home/back.
                if (reelsOverlayPackage == null) {
                    hideInstantOverlay()
                }
            }
        }

        val isNsfwMonitored = contentMatcher.isNsfwMonitoredApp(packageName)
        val shouldHandleAsBrowser =
            browserMonitor.isBrowser(packageName) || isDetachedWebview

        if (isDetachedWebview) {
            // An in-app WebView in an otherwise unmonitored app is only ever
            // announced by its own events, so upgrade on sight and hold the scope
            // for a while after the last sighting.
            webviewSeenAt = android.os.SystemClock.uptimeMillis()
            updateEventScope(true)
        }

        if (!shouldHandleAsBrowser && !isBlockedApp && !isSettingsApp && !reelsDetector.isReelsApp(packageName) && !isNsfwMonitored) {
            if (classNameStr.contains("browser") || classNameStr.contains("web")) {
                Log.d(TAG, "SAMSUNG DEBUG: Ignored event from non-monitored package | Pkg: $packageName | Class: $classNameStr")
            }
            return
        }

        try {
            val rootNode = rootInActiveWindow

            // Check Device Admin activity by class name (doesn't need rootNode)
            if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                if (settingsProtector.checkActivityClass(this, event)) {
                    rootNode?.recycle()
                    return
                }
            }

            // Route to appropriate handler
            val appConfig = contentMatcher.getAppConfig(packageName)
            when {
                appConfig != null -> {
                    // Block only on actual foreground launch (window-state change).
                    // System popups that render under a blocked app's package —
                    // e.g. the Play Protect scan dialog layered over the package
                    // installer, attributed to com.android.vending — emit only
                    // content-changed events and must not trip the app block.
                    if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
                        !isSystemServedDialog(classNameStr)) {
                        Log.w(TAG, "Blocking app launch: $packageName (Config: ${appConfig.appName}, surveillance: ${appConfig.surveillanceType})")
                        showInstantOverlay(packageName, "${appConfig.appName} is blocked", appConfig.surveillanceType, appConfig.surveillanceValue)
                        // Only go home for hard blocks - timer/click overlays need user interaction
                        if (appConfig.surveillanceType == "none") {
                            performGlobalAction(GLOBAL_ACTION_HOME)
                        }
                    }
                }
                shouldHandleAsBrowser -> {
                    handleBrowserEvent(event, rootNode, packageName)
                }
                reelsDetector.isReelsApp(packageName) -> {
                    handleReelsEvent(event, rootNode, packageName)
                }
                isNsfwMonitored -> {
                    handleNsfwScan(rootNode, packageName)
                }
                isSettingsApp -> {
                    settingsProtector.checkSettingsScreen(this, packageName, rootNode)
                }
            }

            rootNode?.recycle()
        } catch (e: Exception) {
            Log.w(TAG, "Error processing accessibility event: ${e.message}")
        }
    }

    /**
     * Play Store serves some UIs that aren't the store itself and must not be
     * blocked when Play Store is a blocked app — notably the in-app review
     * (rating) card, which is a transparent finsky/Play Core activity overlaid
     * on the host app. Identify those by activity class so the app block skips
     * them. classNameStr is already lowercased by the caller.
     */
    private fun isSystemServedDialog(classNameStr: String): Boolean {
        return classNameStr.contains("inappreview") ||
                classNameStr.contains("playcoredialogwrapper")
    }

    /**
     * Handle a browser event - extract URLs and check for blocked content.
     * Scans ALL windows belonging to the browser (not just the active window)
     * to catch AMP bars, secondary URL indicators, etc.
     */
    private fun handleBrowserEvent(
        event: AccessibilityEvent,
        rootNode: android.view.accessibility.AccessibilityNodeInfo?,
        packageName: String
    ) {
        // After a block, suppress further checks for 3s to let the Home action complete
        // and prevent background CONTENT_CHANGED events from re-triggering the block
        if (System.currentTimeMillis() < blockCooldownUntil) return

        val candidates = mutableSetOf<String>()
        val keywords = contentMatcher.getKeywords().toSet()

        browserMonitor.extractUrlCandidatesWithWindows(event, windows, rootNode, packageName)?.let { candidates.addAll(it) }

        if (candidates.isEmpty()) {
            if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                Log.d(TAG, "Browser $packageName: URL extraction returned null")
            }
            return
        }

        // Check if we should perform a broader visual scan (if we only found search engine URLs)
        val searchWebViews = candidates.all { url ->
            SEARCH_ENGINE_PATTERNS.any { pattern -> url.contains(pattern) }
        }


        val now = System.currentTimeMillis()
        var blockedResult: ContentMatcher.MatchResult? = null
        var blockedCandidate = ""
        var allowedCandidate = candidates.first()

        // Determine if ANY candidate contains a whitelisted domain.
        // Check all candidates - URL bar, title, toolbar text - not just the first.
        // Also check embedded domains in text (e.g. "2026 mangaread.org inc.")
        var pageWhitelisted = false
        var contextDomain: String? = null
        for (c in candidates) {
            val d = c.lowercase().removePrefix("https://").removePrefix("http://").removePrefix("www.")
                .substringBefore('/').substringBefore('?').substringBefore(' ')
            if (d.contains('.') && d.isNotEmpty() && contentMatcher.isWhitelisted(d)) {
                pageWhitelisted = true
                contextDomain = d
                break
            }
        }
        // Fallback: scan all candidate text for embedded whitelisted domains
        if (!pageWhitelisted) {
            for (c in candidates) {
                if (contentMatcher.containsWhitelistedDomainPublic(c)) {
                    pageWhitelisted = true
                    contextDomain = "embedded-whitelist"
                    break
                }
            }
        }
        // Cache: remember whitelisted domain for this browser so text-only events inherit it.
        // Clear cache when we see a real URL that is NOT whitelisted (user navigated away).
        val hasRealUrl = candidates.any { it.contains('.') && !it.contains(' ') }
        if (pageWhitelisted) {
            lastWhitelistedDomain = contextDomain
            lastWhitelistedPackage = packageName
        } else if (hasRealUrl) {
            lastWhitelistedDomain = null
            lastWhitelistedPackage = null
        } else if (packageName == lastWhitelistedPackage && lastWhitelistedDomain != null) {
            pageWhitelisted = true
            contextDomain = lastWhitelistedDomain
        }

        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            if (Math.random() < 0.1) {
                Log.d(TAG, "Raw Candidates from $packageName: $candidates")
            }
        } else {
            Log.d(TAG, "Raw Candidates from $packageName: $candidates")
        }

        // Check ALL candidates against the content matcher
        for (candidate in candidates) {
            val result = contentMatcher.isUrlBlocked(candidate, contextDomain)
            if (result.blocked) {
                blockedResult = result
                blockedCandidate = candidate
                break
            } else if (candidate.length > 5 && !candidate.contains("google.") && !candidate.contains("bing.com")) {
                allowedCandidate = candidate
            }
        }

        // Secondary fallback for Chrome/Samsung Internet hidden URLs or AMP masks
        // If current URL bar just says "google.com", we scan the entire visible screen
        // as a large string blob and check for any blocked domains or keywords.
        if (blockedResult == null && searchWebViews && rootNode != null) {
            if (now - lastFullScanAt >= FULL_SCAN_MIN_INTERVAL_MS) {
                lastFullScanAt = now
                scanFullScreenForBlock(rootNode, packageName, contextDomain, pageWhitelisted)?.let {
                    blockedResult = it.first
                    blockedCandidate = it.second
                }
            } else {
                // The suppressed event may be the last of its burst, so a page that
                // finishes rendering inside the interval would otherwise never be
                // scanned at all. One trailing pass covers that.
                scheduleTrailingFullScan(packageName, contextDomain, pageWhitelisted)
            }
        }

        val matched = blockedResult
        if (matched == null) {
            // URL is Allowed
            if (allowedCandidate != lastCheckUrl || now - lastUrlCheckTime > 300) {
                lastCheckUrl = allowedCandidate
                lastUrlCheckTime = now
                Log.d(TAG, "URL allowed: $allowedCandidate (from ${candidates.size} candidates)")
            }
            return
        }

        // We have a Block!
        if (blockedCandidate == lastCheckUrl && now - lastUrlCheckTime < 300) return

        applyBlock(packageName, blockedCandidate, matched)
    }

    /**
     * Scan the whole visible screen as one text blob for a blocked keyword or
     * domain. This is the fallback for hidden URLs and AMP/proxy masks, where the
     * URL bar reads as a search engine throughout.
     *
     * @return the match and the text it was found in, or null if nothing matched.
     */
    private fun scanFullScreenForBlock(
        rootNode: android.view.accessibility.AccessibilityNodeInfo,
        packageName: String,
        contextDomain: String?,
        pageWhitelisted: Boolean
    ): Pair<ContentMatcher.MatchResult, String>? {
        val sb = StringBuilder()
        sb.append(browserMonitor.extractAllText(rootNode))

        // Samsung Internet leaves WebView children unpopulated until an explicit
        // node text search forces them.
        browserMonitor.searchWebViewForUrls(rootNode, deep = true)
            .forEach { sb.append(' ').append(it) }

        try {
            for (window in windows) {
                if (window.id != rootNode.windowId) {
                    val windowRoot = window.root
                    if (windowRoot != null) {
                        if (windowRoot.packageName?.toString() == packageName) {
                            sb.append(" ").append(browserMonitor.extractAllText(windowRoot))
                        }
                        windowRoot.recycle()
                    }
                }
            }
        } catch (_: Exception) {}

        val fullText = sb.toString()
        if (fullText.isBlank()) return null

        // 1. Keyword check on the full blob - skip if page is whitelisted
        if (!pageWhitelisted) {
            val matchedKeyword = contentMatcher.findMatchingKeywordDirectly(fullText)
            if (matchedKeyword != null) {
                Log.w(TAG, "SAMSUNG BLOCK: Found keyword [$matchedKeyword] in visual text")
                return ContentMatcher.MatchResult(true, ContentMatcher.MatchType.KEYWORD, matchedKeyword) to matchedKeyword
            }
        }

        // 2. Regex Scan: Find everything that looks like a domain in the blob
        val lowerText = fullText.lowercase()
        // PASS A: Standard matching
        for (match in FALLBACK_DOMAIN_PATTERN.findAll(lowerText)) {
            val word = match.value
            if (word.length > 5) {
                val result = contentMatcher.isUrlBlocked(word, contextDomain)
                if (result.blocked) {
                    Log.w(TAG, "SAMSUNG BLOCK: Found domain [$word] in visual text via Regex")
                    return result to word
                }
            }
        }

        // PASS B: Compact matching (catch "y o u t u b e . c o m")
        val compactText = lowerText.replace(" ", "")
        for (match in FALLBACK_DOMAIN_PATTERN.findAll(compactText)) {
            val word = match.value
            if (word.length > 5) {
                val result = contentMatcher.isUrlBlocked(word, contextDomain)
                if (result.blocked) {
                    Log.w(TAG, "SAMSUNG BLOCK: Found compact domain [$word] in visual text via Regex")
                    return result to word
                }
            }
        }
        return null
    }

    /**
     * Run one full-screen scan after the rate limit expires, against whatever is
     * foreground then. Only one is ever queued.
     */
    private fun scheduleTrailingFullScan(
        packageName: String,
        contextDomain: String?,
        pageWhitelisted: Boolean
    ) {
        if (fullScanPending) return
        fullScanPending = true
        handler.postAtTime({
            fullScanPending = false
            if (System.currentTimeMillis() < blockCooldownUntil) return@postAtTime
            val root = rootInActiveWindow ?: return@postAtTime
            if (root.packageName?.toString() == packageName) {
                lastFullScanAt = System.currentTimeMillis()
                scanFullScreenForBlock(root, packageName, contextDomain, pageWhitelisted)?.let {
                    applyBlock(packageName, it.second, it.first)
                }
            }
            root.recycle()
        }, FULL_SCAN_TOKEN, android.os.SystemClock.uptimeMillis() + FULL_SCAN_MIN_INTERVAL_MS)
    }

    private fun applyBlock(
        packageName: String,
        blockedCandidate: String,
        blockedResult: ContentMatcher.MatchResult
    ) {
        val now = System.currentTimeMillis()
        lastCheckUrl = blockedCandidate
        lastUrlCheckTime = now
        consecutiveBlockCount++

        Log.i(TAG, "Blocked URL: $blockedCandidate (${blockedResult.matchType}: ${blockedResult.matchedValue}) - Attempt $consecutiveBlockCount")

        // Show instant overlay with the actual blocked reason
        showInstantOverlay(packageName, "${blockedResult.matchedValue} is blocked")

        // Suppress further checks for 3s so background events don't re-trigger
        blockCooldownUntil = now + 3000

        // Then navigate away from blocked content
        openBlankPage(packageName)

        // If the user is still on the same blocked URL after multiple attempts, be more aggressive
        if (consecutiveBlockCount > 3) {
            Log.w(TAG, "Block persistent! Performing GLOBAL_ACTION_HOME")
            performGlobalAction(GLOBAL_ACTION_HOME)
            consecutiveBlockCount = 0
        }

        // Also broadcast for JS layer
        broadcastUrlBlocked(blockedCandidate, blockedResult)
    }

    /**
     * Handle a reels app event - detect reels/shorts section.
     */
    private fun handleReelsEvent(
        event: AccessibilityEvent,
        rootNode: android.view.accessibility.AccessibilityNodeInfo?,
        packageName: String
    ) {
        val result = reelsDetector.detectReels(event, rootNode, packageName) ?: return

        if (result.isInReels) {
            Log.i(TAG, "Reels detected in ${result.appName}")
            reelsOverlayPackage = packageName
            showInstantOverlay(packageName, "${result.appName} Reels blocked")
        } else {
            Log.i(TAG, "User left reels in ${result.appName}")
            reelsOverlayPackage = null
            hideInstantOverlay()
        }

        broadcastReelsDetected(result)
    }

    private var lastNsfwBlockTime = 0L

    private fun handleNsfwScan(
        rootNode: android.view.accessibility.AccessibilityNodeInfo?,
        packageName: String
    ) {
        if (rootNode == null || isInstantOverlayShowing) return

        val now = System.currentTimeMillis()
        if (now - lastNsfwBlockTime < 2000) return

        // Combine built-in NSFW labels with user keywords
        val allKeywords = NSFW_BUILTIN_KEYWORDS + contentMatcher.getKeywords()

        // ponytail: one IPC per keyword; a single tree walk would mean
        // reimplementing Android's own text-match semantics
        for (keyword in allKeywords) {
            try {
                val matches = rootNode.findAccessibilityNodeInfosByText(keyword)
                if (matches.isNullOrEmpty()) continue

                var found = false
                for (match in matches) {
                    if (!found && match.isVisibleToUser) {
                        found = true
                    }
                    match.recycle()
                }

                if (found) {
                    Log.i(TAG, "NSFW keyword '$keyword' found in $packageName")
                    lastNsfwBlockTime = now
                    reelsOverlayPackage = packageName
                    showInstantOverlay(packageName, "Explicit content blocked")
                    return
                }
            } catch (_: Exception) {}
        }
    }

    /**
     * Navigate browser away from blocked content.
     *
     * Strategy:
     * 1. Bring our own app to the foreground (immediate, reliable block)
     * 2. Then press Back via accessibility to leave the blocked page in the browser
     *
     * This works for ALL browsers including Firefox, which rejects about:blank
     * and data: URI intents.
     */
    private fun openBlankPage(browserPackage: String) {
        if (!browserMonitor.isBrowser(browserPackage)) {
            performGlobalAction(GLOBAL_ACTION_HOME)
            return
        }

        // 1. Immediately press Back to pop the browser stack/history
        performGlobalAction(GLOBAL_ACTION_BACK)
        
        // 2. Safely trigger Home after a short delay so the system registers it.
        // We removed the ACTION_VIEW intent because it was dragging the browser 
        // back to the foreground and canceling the Home action!
        handler.postDelayed({
            performGlobalAction(GLOBAL_ACTION_HOME)
            
            // Backup Home Intent just in case the Global Action fails
            try {
                val homeIntent = Intent(Intent.ACTION_MAIN).apply {
                    addCategory(Intent.CATEGORY_HOME)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(homeIntent)
            } catch (_: Exception) {}
            
        }, 150)
        
        Log.d(TAG, "Navigating away from $browserPackage (Back + Home)")
    }

    /**
     * Show a full-screen blocking overlay INSTANTLY using the accessibility
     * service's own window manager. This avoids the delay of starting a
     * separate service via startService().
     *
     * The overlay auto-hides after OVERLAY_DURATION_MS.
     */
    private fun loadThemeFromPrefs(): org.json.JSONObject {
        val prefs = getSharedPreferences("freedom_settings", MODE_PRIVATE)
        val json = prefs.getString("overlay_theme", null)
        return if (json != null) {
            try { org.json.JSONObject(json) } catch (_: Exception) { org.json.JSONObject() }
        } else org.json.JSONObject()
    }

    @Synchronized
    private fun showInstantOverlay(targetPackage: String, message: String, surveillanceType: String = "none", surveillanceValue: Int = 0) {
        handler.post {
            if (isInstantOverlayShowing) {
                return@post
            }

            try {
                val theme = loadThemeFromPrefs()
                val bgColor = theme.optString("bgColor", "#0B1215")
                val accentColor = theme.optString("accentColor", "#2DD4BF")
                val textColorHex = theme.optString("textColor", "#FFFFFF")
                val mutedTextColor = theme.optString("mutedTextColor", "#CBD5E1")
                val cardBgColor = theme.optString("cardBgColor", "#1A2421")
                val titleStr = theme.optString("title", "Blocked!")
                val subtitleStr = theme.optString("subtitle", "Stay Sharp - Stay Disciplined")
                val headingStr = theme.optString("heading", "You are on a mission to build a better future!")
                val bodyStr = theme.optString("body", "Giving in to cheap dopamine is not an option. Back away right now, get back to the grind, and crush your goals today!")

                val params = WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.OPAQUE
                )
                params.gravity = Gravity.CENTER

                val density = resources.displayMetrics.density

                val customImagePath = theme.optString("customImagePath", "")

                val container = object : FrameLayout(this@FreedomAccessibilityService) {
                    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
                        if (event.action == android.view.KeyEvent.ACTION_DOWN && event.keyCode == android.view.KeyEvent.KEYCODE_BACK) {
                            if (reelsDetector.isReelsApp(targetPackage)) {
                                reelsOverlayPackage = null
                                hideInstantOverlay()
                                // Wait for overlay to detach, then press back to return to App's Feed/Camera
                                handler.postDelayed({ performGlobalAction(GLOBAL_ACTION_BACK) }, 150)
                            } else {
                                performGlobalAction(GLOBAL_ACTION_HOME)
                            }
                            return true
                        }
                        return super.dispatchKeyEvent(event)
                    }
                }.apply {
                    setBackgroundColor(Color.parseColor(bgColor))
                    isFocusableInTouchMode = true
                }

                // Background image + scrim
                if (customImagePath.isNotEmpty()) {
                    addBackgroundImage(container, customImagePath)
                }

                val layout = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER
                    setPadding((24 * density).toInt(), (60 * density).toInt(), (24 * density).toInt(), (60 * density).toInt())
                }

                // Accent circle with icon
                val iconRing = FrameLayout(this).apply {
                    val size = (100 * density).toInt()
                    layoutParams = LinearLayout.LayoutParams(size, size).apply { gravity = Gravity.CENTER; bottomMargin = (20 * density).toInt() }
                    background = android.graphics.drawable.GradientDrawable().apply {
                        shape = android.graphics.drawable.GradientDrawable.OVAL
                        setColor(Color.parseColor(accentColor) and 0x1AFFFFFF or 0x1A000000)
                        setStroke((3 * density).toInt(), Color.parseColor(accentColor) and 0x80FFFFFF.toInt() or -0x80000000)
                    }
                }
                val iconInner = TextView(this).apply {
                    text = ""
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 44f)
                    gravity = Gravity.CENTER
                    layoutParams = FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        Gravity.CENTER
                    )
                }
                iconRing.addView(iconInner)

                val title = TextView(this).apply {
                    text = titleStr
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 36f)
                    setTextColor(Color.parseColor(textColorHex))
                    typeface = Typeface.DEFAULT_BOLD
                    gravity = Gravity.CENTER
                    isAllCaps = true
                    letterSpacing = 0.12f
                    setPadding(0, 0, 0, (4 * density).toInt())
                }

                val subtitle = TextView(this).apply {
                    text = subtitleStr
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                    setTextColor(Color.parseColor(accentColor))
                    typeface = Typeface.DEFAULT_BOLD
                    gravity = Gravity.CENTER
                    isAllCaps = true
                    letterSpacing = 0.1f
                    setPadding(0, 0, 0, (24 * density).toInt())
                }

                // Card with heading + body
                val card = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor(cardBgColor))
                        cornerRadius = (16 * density)
                    }
                    setPadding((24 * density).toInt(), (20 * density).toInt(), (24 * density).toInt(), (20 * density).toInt())
                }
                val accentBar = android.view.View(this).apply {
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (4 * density).toInt()).apply { bottomMargin = (12 * density).toInt() }
                    setBackgroundColor(Color.parseColor(accentColor))
                }
                val cardHeading = TextView(this).apply {
                    text = headingStr
                    setTextColor(Color.parseColor(textColorHex))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                    typeface = Typeface.DEFAULT_BOLD
                    gravity = Gravity.CENTER
                    setPadding(0, 0, 0, (6 * density).toInt())
                }
                val cardBody = TextView(this).apply {
                    text = bodyStr
                    setTextColor(Color.parseColor(mutedTextColor))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                    gravity = Gravity.CENTER
                }
                card.addView(accentBar)
                card.addView(cardHeading)
                card.addView(cardBody)

                val cardParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = (24 * density).toInt() }

                // Dynamic message (what was blocked)
                val blockedInfo = TextView(this).apply {
                    text = message
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                    setTextColor(Color.parseColor(mutedTextColor))
                    gravity = Gravity.CENTER
                    setPadding(0, 0, 0, (16 * density).toInt())
                }

                val button = TextView(this).apply {
                    text = "I understand"
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                    setTextColor(Color.parseColor(textColorHex))
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor(accentColor))
                        cornerRadius = (8 * density)
                    }
                    gravity = Gravity.CENTER
                    setPadding(
                        (32 * density).toInt(), (14 * density).toInt(),
                        (32 * density).toInt(), (14 * density).toInt()
                    )
                }

                var clicksLeft = surveillanceValue
                var secondsLeft = surveillanceValue

                fun updateButtonState() {
                    when (surveillanceType) {
                        "timer" -> {
                            if (secondsLeft > 0) {
                                button.text = "Wait ${secondsLeft}s"
                                button.isEnabled = false
                                button.alpha = 0.5f
                            } else {
                                button.text = "I understand"
                                button.isEnabled = true
                                button.alpha = 1.0f
                            }
                        }
                        "click" -> {
                            if (clicksLeft > 0) {
                                button.text = "Tap $clicksLeft times"
                                button.isEnabled = true
                                button.alpha = 1.0f
                            } else {
                                button.text = "I understand"
                                button.isEnabled = true
                                button.alpha = 1.0f
                            }
                        }
                        else -> {
                            button.text = "I understand"
                            button.isEnabled = true
                        }
                    }
                }

                button.setOnClickListener {
                    if (surveillanceType == "click" && clicksLeft > 0) {
                        clicksLeft--
                        updateButtonState()
                        if (clicksLeft == 0) {
                            // Done!
                        }
                        return@setOnClickListener
                    }

                    if (button.isEnabled) {
                         if (surveillanceType == "timer" || surveillanceType == "click") {
                             // They passed the barrier: Temporarily whitelist for 15 minutes
                             contentMatcher.allowAppTemporarily(targetPackage, 15 * 60 * 1000L)
                             
                             Log.i(TAG, "Unlocking $targetPackage dynamically via Intent...")
                             val launchIntent = packageManager.getLaunchIntentForPackage(targetPackage)
                             if (launchIntent != null) {
                                 launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                                 startActivity(launchIntent)
                             } else {
                                 Log.w(TAG, "Launch intent for $targetPackage is null, unable to reopen.")
                             }
                         } else if (reelsDetector.isReelsApp(targetPackage)) {
                             // Reels block: exit reels trap by pressing Back, placing user on the app's Feed/Camera
                             reelsOverlayPackage = null
                             hideInstantOverlay()
                             handler.postDelayed({ performGlobalAction(GLOBAL_ACTION_BACK) }, 150)
                             return@setOnClickListener
                         } else {
                             // Hard block: navigate away
                             if (currentPackage.isNotEmpty()) {
                                 openBlankPage(currentPackage)
                             } else {
                                 performGlobalAction(GLOBAL_ACTION_HOME)
                             }
                         }
                         reelsOverlayPackage = null
                         hideInstantOverlay()
                    }
                }

                updateButtonState()

                layout.addView(iconRing)
                layout.addView(title)
                layout.addView(subtitle)
                layout.addView(card, cardParams)
                layout.addView(blockedInfo)
                layout.addView(button)

                val layoutParams = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.CENTER
                )
                container.addView(layout, layoutParams)

                windowManager?.addView(container, params)
                instantOverlay = container
                isInstantOverlayShowing = true
                Log.i(TAG, "Instant overlay shown: $message")

                if (surveillanceType == "timer" && secondsLeft > 0) {
                    val timerRunnable = object : Runnable {
                        override fun run() {
                            if (!isInstantOverlayShowing) return
                            if (secondsLeft > 0) {
                                secondsLeft--
                                updateButtonState()
                                handler.postDelayed(this, 1000)
                            }
                        }
                    }
                    handler.postDelayed(timerRunnable, 1000)
                } else if (surveillanceType == "none" && reelsOverlayPackage == null) {
                    // Auto-hide after duration only if no interaction needed
                    // and this is NOT a reels overlay (reels overlays persist
                    // until the user clicks "I understand")
                    handler.postAtTime({ hideInstantOverlay() },
                        OVERLAY_DISMISS_TOKEN,
                        android.os.SystemClock.uptimeMillis() + OVERLAY_DURATION_MS)
                }

            } catch (e: Exception) {
                Log.e(TAG, "Failed to show instant overlay: ${e.message}")
            }
        }
    }

    /**
     * Attach the theme background image and its scrim. A cached bitmap is
     * applied immediately; otherwise the decode runs off the main thread and
     * the views are inserted underneath the message when it lands. The overlay
     * itself never waits on the image — it is already opaque without it.
     */
    private fun addBackgroundImage(container: FrameLayout, path: String) {
        val bgImage = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }
        val scrim = android.view.View(this).apply {
            setBackgroundColor(Color.parseColor("#66000000"))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        val key = backgroundKey(path)
        val cached = if (cachedBackgroundKey == key) cachedBackground else null
        if (cached != null) {
            bgImage.setImageBitmap(cached)
            container.addView(bgImage)
            container.addView(scrim)
            return
        }

        if (backgroundDecodeInFlight) return
        backgroundDecodeInFlight = true

        val metrics = resources.displayMetrics
        val reqWidth = metrics.widthPixels
        val reqHeight = metrics.heightPixels

        Thread {
            // Throwable, not Exception: a large image throws OutOfMemoryError,
            // which would otherwise reach the default handler and kill the
            // process, taking this service with it. The overlay is opaque
            // without the image.
            val bitmap = try {
                decodeSampledBackground(path, reqWidth, reqHeight)
            } catch (e: Throwable) {
                Log.w(TAG, "Failed to load overlay background: ${e.message}")
                null
            }
            handler.post {
                backgroundDecodeInFlight = false
                if (bitmap == null) return@post
                cachedBackground = bitmap
                cachedBackgroundKey = key
                if (container.parent == null) return@post
                bgImage.setImageBitmap(bitmap)
                container.addView(bgImage, 0)
                container.addView(scrim, 1)
            }
        }.start()
    }

    /**
     * Cache key for the theme background. The picker writes every custom image
     * to the same file name, so the path alone would never change and a new
     * image would never be picked up.
     */
    private fun backgroundKey(path: String): String {
        val file = Uri.parse(path).path ?: return path
        return "$path:${java.io.File(file).lastModified()}"
    }

    /**
     * Decode the background at no more resolution than the screen needs.
     */
    private fun decodeSampledBackground(path: String, reqWidth: Int, reqHeight: Int): Bitmap? {
        val uri = Uri.parse(path)

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        // Either dimension still covering the screen is enough to halve again.
        // Requiring both leaves ordinary portrait/landscape photos at full size.
        var sampleSize = 1
        while (bounds.outWidth / (sampleSize * 2) >= reqWidth ||
            bounds.outHeight / (sampleSize * 2) >= reqHeight
        ) {
            sampleSize *= 2
        }

        val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
        return contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, options)
        }
    }

    private fun hideInstantOverlay() {
        handler.post {
            // Drop this overlay's queued auto-dismiss. Left pending, it would
            // fire during a later overlay and cut that one short.
            handler.removeCallbacksAndMessages(OVERLAY_DISMISS_TOKEN)
            if (!isInstantOverlayShowing) return@post
            try {
                instantOverlay?.let { windowManager?.removeView(it) }
            } catch (e: Exception) {
                Log.w(TAG, "Error removing instant overlay: ${e.message}")
            }
            instantOverlay = null
            isInstantOverlayShowing = false
            Log.i(TAG, "Instant overlay hidden")
        }
    }

    /**
     * Broadcast blocked URL event to overlay service and JS layer.
     */
    private fun broadcastUrlBlocked(url: String, result: ContentMatcher.MatchResult) {
        val intent = Intent(ACTION_URL_BLOCKED).apply {
            putExtra(EXTRA_URL, url)
            putExtra(EXTRA_DOMAIN, url.substringBefore('/'))
            putExtra(EXTRA_MATCH_TYPE, result.matchType.name)
            putExtra(EXTRA_MATCHED_VALUE, result.matchedValue)
        }
        LocalBroadcastManager.getInstance(this).sendBroadcast(intent)
    }

    /**
     * Broadcast reels detection event to overlay service and JS layer.
     */
    private fun broadcastReelsDetected(result: ReelsDetector.DetectionResult) {
        val intent = Intent(ACTION_REELS_DETECTED).apply {
            putExtra(EXTRA_APP_NAME, result.appName)
            putExtra(EXTRA_PACKAGE_NAME, result.packageName)
            putExtra(EXTRA_IS_IN_REELS, result.isInReels)
        }
        LocalBroadcastManager.getInstance(this).sendBroadcast(intent)
    }

    /**
     * On (re)connect — e.g. when the banking window ends and the service is
     * re-enabled — redirect home immediately if a blocked app is foregrounded,
     * instead of waiting for the next window-state change.
     */
    private fun enforceForegroundIfBlocked() {
        val root = rootInActiveWindow ?: return
        val pkg = root.packageName?.toString()
        root.recycle()
        if (pkg.isNullOrEmpty() || pkg == applicationContext.packageName) return
        val config = contentMatcher.getAppConfig(pkg) ?: return
        if (config.surveillanceType == "none") {
            Log.w(TAG, "Insta-stop on resume: $pkg blocked, GLOBAL_ACTION_HOME")
            performGlobalAction(GLOBAL_ACTION_HOME)
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        isRunning = false
        hideInstantOverlay()
        handler.removeCallbacksAndMessages(null)
        packageAddedReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (e: IllegalArgumentException) {
                // Not registered — nothing to do.
            }
        }
        packageAddedReceiver = null
        sharedBrowserMonitor = null
        sharedReelsDetector = null
        sharedContentMatcher = null
        sharedSettingsProtector = null
        Log.i(TAG, "Freedom Accessibility Service destroyed")
        super.onDestroy()
    }
}
