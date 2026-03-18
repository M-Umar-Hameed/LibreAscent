package expo.modules.freedomaccessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.localbroadcastmanager.content.LocalBroadcastManager

/**
 * Freedom Accessibility Service — URL monitoring + Reels detection.
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
    private val handler = Handler(Looper.getMainLooper())
    private var lastUrlCheckTime: Long = 0
    private var consecutiveBlockCount = 0
    private var lastCheckUrl: String = ""
    private var lastSamsungDebugTime: Long = 0
    private var blockCooldownUntil: Long = 0

    companion object {
        private const val TAG = "FreedomA11y"
        private const val OVERLAY_DURATION_MS = 5000L
        private val OVERLAY_DISMISS_TOKEN = Object()

        @Volatile
        var isRunning: Boolean = false
            private set

        // Shared instances for config updates from the Module
        var sharedBrowserMonitor: BrowserUrlMonitor? = null
            private set
        var sharedReelsDetector: ReelsDetector? = null
            private set
        var sharedContentMatcher: ContentMatcher? = null
            private set
        var sharedSettingsProtector: SettingsProtector? = null
            private set

        // Pending configs buffer — holds configs sent before service was ready
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

        // Configure the service programmatically for finer control
        val info = serviceInfo ?: AccessibilityServiceInfo()
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
                AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.notificationTimeout = 100
        info.flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
                AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        serviceInfo = info

        Log.i(TAG, "Freedom Accessibility Service connected, data loaded: ${browserMonitor.getLoadedBrowserCount()} browsers")
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
        val isSettingsApp = packageName == "com.android.settings" ||
                packageName == "com.google.android.settings" ||
                packageName.contains("packageinstaller") ||
                packageName.contains("settings") ||
                packageName.contains("manageapp")

        if (!browserMonitor.isBrowser(packageName) && !isDetachedWebview && !isBlockedApp && !isSettingsApp) {
            if (classNameStr.contains("browser") || classNameStr.contains("web")) {
                Log.d(TAG, "SAMSUNG DEBUG: Ignored event from non-monitored package | Pkg: $packageName | Class: $classNameStr")
            }
            return
        }
        // Track current foreground app
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            if (packageName != currentPackage) {
                // User switched apps — reset all blocking state for previous app
                if (currentPackage.isNotEmpty()) {
                    reelsDetector.resetState(currentPackage)
                    broadcastReelsDetected(ReelsDetector.DetectionResult("App", currentPackage, false))
                }
                currentPackage = packageName
                // Clear stale URL check state so it doesn't leak across apps
                lastCheckUrl = ""
                lastUrlCheckTime = 0
                consecutiveBlockCount = 0
                // Dismiss any lingering overlay from the previous app
                hideInstantOverlay()
            }
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
                    // Block the entire app
                    Log.w(TAG, "Blocking app launch: $packageName (Config: ${appConfig.appName})")
                    
                    // Show our instant overlay
                    showInstantOverlay(packageName, "${appConfig.appName} is blocked", appConfig.surveillanceType, appConfig.surveillanceValue)
                    performGlobalAction(GLOBAL_ACTION_HOME)
                }
                browserMonitor.isBrowser(packageName) -> {
                    handleBrowserEvent(event, rootNode, packageName)
                }
                reelsDetector.isReelsApp(packageName) -> {
                    handleReelsEvent(event, rootNode, packageName)
                }
                packageName == "com.android.settings" ||
                packageName == "com.google.android.settings" ||
                packageName.contains("packageinstaller") ||
                packageName.contains("settings") ||
                packageName.contains("manageapp") -> {
                    settingsProtector.checkSettingsScreen(this, event, rootNode)
                }
            }

            rootNode?.recycle()
        } catch (e: Exception) {
            Log.w(TAG, "Error processing accessibility event: ${e.message}")
        }
    }

    /**
     * Handle a browser event — extract URLs and check for blocked content.
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
        val sourceNode = event.source
        
        if (packageName == "com.sec.android.app.sbrowser") {
            // AGGRESSIVE LOGGING: Let's see exactly what events Samsung Internet broadcasts under the hood
            val typeStr = AccessibilityEvent.eventTypeToString(event.eventType)
            val pkgHex = packageName.map { String.format("%04x", it.code) }.joinToString(" ")
            Log.d(TAG, "SAMSUNG RAW EVENT | Pkg: $packageName | Hex: $pkgHex | Type: $typeStr | Class: ${event.className} | Text: ${event.text?.joinToString(",")} | Desc: ${event.contentDescription}")

            // DEBUG: Deep dump event.source for Samsung Browser to find hidden URL nodes
            if (sourceNode != null) {
                val now = System.currentTimeMillis()
                if (now - lastSamsungDebugTime > 3000) {
                    lastSamsungDebugTime = now
                    try {
                        Log.d(TAG, "SAMSUNG SOURCE DUMP: cls=${sourceNode.className} id=${sourceNode.viewIdResourceName} text=[${sourceNode.text}] desc=[${sourceNode.contentDescription}] childCount=${sourceNode.childCount}")
                        browserMonitor.debugDumpAllWindows(windows, rootNode, packageName)
                    } catch (e: Exception) {
                        Log.w(TAG, "Debug dump failed: ${e.message}")
                    }
                }
            }
        }
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

        // Determine the primary page domain for whitelist context.
        // If the page domain is whitelisted, keyword blocking is skipped.
        val primaryDomain = candidates.firstOrNull { it.contains('.') && !it.contains(' ') }
            ?.lowercase()?.removePrefix("https://")?.removePrefix("http://")?.removePrefix("www.")
            ?.substringBefore('/')?.substringBefore('?') ?: ""
        val pageWhitelisted = primaryDomain.isNotEmpty() && contentMatcher.isWhitelisted(primaryDomain)
        val contextDomain = if (pageWhitelisted) primaryDomain else null

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
            val sb = StringBuilder()
            sb.append(browserMonitor.extractAllText(rootNode))

            try {
                for (window in windows) {
                    if (window.id != event.windowId) {
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
            if (fullText.isNotBlank()) {
                // 1. Keyword check on the full blob — skip if page is whitelisted
                if (!pageWhitelisted) {
                    val matchedKeyword = contentMatcher.findMatchingKeywordDirectly(fullText)
                    if (matchedKeyword != null) {
                        Log.w(TAG, "SAMSUNG BLOCK: Found keyword [$matchedKeyword] in visual text")
                        blockedResult = ContentMatcher.MatchResult(true, ContentMatcher.MatchType.KEYWORD, matchedKeyword)
                        blockedCandidate = matchedKeyword
                    }
                }

                // 2. Regex Scan: Find everything that looks like a domain in the blob
                if (blockedResult == null) {
                    val domainPattern = Regex("[a-z0-9]([a-z0-9-]*[a-z0-9])?\\.[a-z0-9][a-z0-9-]*[a-z0-9](?:\\.[a-z]{2,})?")

                    // PASS A: Standard matching
                    var matches = domainPattern.findAll(fullText.lowercase())
                    for (match in matches) {
                        val word = match.value
                        if (word.length > 5) {
                            val result = contentMatcher.isUrlBlocked(word, contextDomain)
                            if (result.blocked) {
                                Log.w(TAG, "SAMSUNG BLOCK: Found domain [$word] in visual text via Regex")
                                blockedResult = result
                                blockedCandidate = word
                                break
                            }
                        }
                    }

                    // PASS B: Compact matching (catch "y o u t u b e . c o m")
                    if (blockedResult == null) {
                        val compactText = fullText.replace(" ", "").lowercase()
                        matches = domainPattern.findAll(compactText)
                        for (match in matches) {
                            val word = match.value
                            if (word.length > 5) {
                                val result = contentMatcher.isUrlBlocked(word, contextDomain)
                                if (result.blocked) {
                                    Log.w(TAG, "SAMSUNG BLOCK: Found compact domain [$word] in visual text via Regex")
                                    blockedResult = result
                                    blockedCandidate = word
                                    break
                                }
                            }
                        }
                    }
                }
            }
        }

        if (blockedResult == null) {
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
     * Handle a reels app event — detect reels/shorts section.
     */
    private fun handleReelsEvent(
        event: AccessibilityEvent,
        rootNode: android.view.accessibility.AccessibilityNodeInfo?,
        packageName: String
    ) {
        val result = reelsDetector.detectReels(event, rootNode, packageName) ?: return

        if (result.isInReels) {
            Log.i(TAG, "Reels detected in ${result.appName}")
        } else {
            Log.i(TAG, "User left reels in ${result.appName}")
        }

        broadcastReelsDetected(result)
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
        if (!browserMonitor.isBrowser(browserPackage)) return

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
    @Synchronized
    private fun showInstantOverlay(targetPackage: String, message: String, surveillanceType: String = "none", surveillanceValue: Int = 0) {
        handler.post {
            if (isInstantOverlayShowing) {
                // If it's already showing, just update message (unless it's a timer/clicker)
                return@post
            }

            try {
                val params = WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    // Never use FLAG_NOT_FOCUSABLE — overlay must block all touches
                    // to prevent interaction with the app underneath.
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.OPAQUE
                )
                params.gravity = Gravity.CENTER

                val density = resources.displayMetrics.density

                val container = FrameLayout(this).apply {
                    setBackgroundColor(Color.BLACK)
                }

                val layout = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER
                }

                val emoji = TextView(this).apply {
                    text = "\u26D4"
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 64f)
                    gravity = Gravity.CENTER
                }

                val title = TextView(this).apply {
                    text = "Stay Away"
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f)
                    setTextColor(Color.WHITE)
                    typeface = Typeface.DEFAULT_BOLD
                    gravity = Gravity.CENTER
                    setPadding(0, (24 * density).toInt(), 0, (16 * density).toInt())
                }

                val subtitle = TextView(this).apply {
                    text = message
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                    setTextColor(Color.parseColor("#AAAAAA"))
                    gravity = Gravity.CENTER
                    setPadding(0, 0, 0, (32 * density).toInt())
                }

                val button = TextView(this).apply {
                    text = "I understand"
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.parseColor("#333333"))
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
                         if (surveillanceType != "none") {
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
                         } else {
                             // Hard block: Try to reset the browser to home before leaving
                             if (currentPackage.isNotEmpty()) {
                                 openBlankPage(currentPackage)
                             } else {
                                 performGlobalAction(GLOBAL_ACTION_HOME)
                             }
                         }
                         hideInstantOverlay() 
                    }
                }

                updateButtonState()

                layout.addView(emoji)
                layout.addView(title)
                layout.addView(subtitle)
                layout.addView(button)

                val layoutParams = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT,
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
                } else if (surveillanceType == "none") {
                    // Auto-hide after duration only if no interaction needed
                    handler.postAtTime({ hideInstantOverlay() },
                        OVERLAY_DISMISS_TOKEN,
                        android.os.SystemClock.uptimeMillis() + OVERLAY_DURATION_MS)
                }

            } catch (e: Exception) {
                Log.e(TAG, "Failed to show instant overlay: ${e.message}")
            }
        }
    }

    private fun hideInstantOverlay() {
        handler.post {
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

    override fun onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        isRunning = false
        hideInstantOverlay()
        handler.removeCallbacksAndMessages(null)
        sharedBrowserMonitor = null
        sharedReelsDetector = null
        sharedContentMatcher = null
        sharedSettingsProtector = null
        Log.i(TAG, "Freedom Accessibility Service destroyed")
        super.onDestroy()
    }
}
