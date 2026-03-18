package expo.modules.freedomaccessibility

import android.content.Context
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * Monitors browser URL bars via the accessibility node tree.
 *
 * When a browser is in the foreground, this monitor:
 * 1. Finds the URL bar node by its resource ID
 * 2. Extracts the current URL text
 * 3. Checks against the content matcher
 *
 * Browser configs are pushed from JS at startup and can be updated at runtime.
 * Configs are also persisted to SharedPreferences so the service can load them
 * immediately on startup without waiting for JS.
 */
class BrowserUrlMonitor {

    data class BrowserConfig(
        val name: String,
        val packageName: String,
        val urlBarId: String
    )

    private val browsers = mutableMapOf<String, BrowserConfig>()
    private var lastDetectedUrl: String = ""

    /**
     * Update the list of monitored browsers and persist to SharedPreferences.
     */
    fun updateConfigs(configs: List<BrowserConfig>, context: Context? = null) {
        browsers.clear()
        configs.forEach { config ->
            browsers[config.packageName] = config
        }
        Log.i(TAG, "Updated browser configs: ${browsers.keys}")

        // Persist so the service can load configs on next startup
        context?.let { persistConfigs(it, configs) }
    }

    /**
     * Load browser configs from SharedPreferences (for service startup).
     */
    fun loadPersistedConfigs(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val json = prefs.getString(PREFS_KEY_BROWSERS, null) ?: return

        try {
            val array = JSONArray(json)
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                val config = BrowserConfig(
                    name = obj.getString("name"),
                    packageName = obj.getString("packageName"),
                    urlBarId = obj.getString("urlBarId")
                )
                browsers[config.packageName] = config
            }
            Log.i(TAG, "Loaded ${browsers.size} persisted browser configs")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to load persisted browser configs: ${e.message}")
        }
    }

    private fun persistConfigs(context: Context, configs: List<BrowserConfig>) {
        try {
            val array = JSONArray()
            configs.forEach { config ->
                val obj = JSONObject().apply {
                    put("name", config.name)
                    put("packageName", config.packageName)
                    put("urlBarId", config.urlBarId)
                }
                array.put(obj)
            }
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(PREFS_KEY_BROWSERS, array.toString())
                .apply()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to persist browser configs: ${e.message}")
        }
    }

    /**
     * Check if a package is a monitored browser.
     */
    fun isBrowser(packageName: String): Boolean {
        return browsers.containsKey(packageName)
    }

    fun getLoadedBrowserCount(): Int = browsers.size
    fun getLoadedBrowserPackages(): String = browsers.keys.joinToString(", ")

    /**
     * Debug: try all known Firefox URL bar IDs and log what we find.
     */
    fun debugFindUrlBar(rootNode: AccessibilityNodeInfo, packageName: String) {
        val idsToTry = FIREFOX_URL_BAR_FALLBACKS + listOf(
            "toolbar",
            "mozac_browser_toolbar_title_view",
            "mozac_browser_toolbar_page_title",
            "url_bar_title_text", // Alternative Generic
            "display_url", // Tor/Fennec Fallback
            "location_bar_edit_text", // Samsung Generic Location Bar
            "bottombar_url" // Vivaldi/Brave bottom bary
        )
        for (id in idsToTry) {
            val fullId = "$packageName:id/$id"
            try {
                val nodes = rootNode.findAccessibilityNodeInfosByViewId(fullId)
                if (nodes != null && nodes.isNotEmpty()) {
                    val text = nodes[0].text?.toString() ?: "(no text)"
                    val desc = nodes[0].contentDescription?.toString() ?: "(no desc)"
                    Log.d(TAG, "FIREFOX_URL_DEBUG FOUND id=$fullId text=[$text] desc=[$desc]")
                    nodes.forEach { it.recycle() }
                }
            } catch (_: Exception) {}
        }

        // Also walk the tree to find any EditText or TextView with URL-like content
        try {
            dumpNodeTree(rootNode, packageName, 0, 3)
        } catch (_: Exception) {}
    }

    /**
     * Deep debug: dump ALL text/desc nodes in the top 800px of the screen from ALL windows.
     * Logs every node regardless of whether it looks like a URL. This helps discover
     * Samsung Browser's AMP/redirect indicator bar resource IDs and text.
     */
    fun debugDumpAllWindows(windows: List<android.view.accessibility.AccessibilityWindowInfo>?, rootNode: AccessibilityNodeInfo?, packageName: String) {
        Log.d(TAG, "=== DEBUG DUMP START (pkg=$packageName, windowCount=${windows?.size ?: 0}) ===")

        if (rootNode != null) {
            Log.d(TAG, "--- Active window root (pkg=${rootNode.packageName}) childCount=${rootNode.childCount} ---")
            deepDumpNode(rootNode, 0, 30)
        }

        windows?.forEachIndexed { idx, window ->
            try {
                val root = window.root
                if (root != null) {
                    val winPkg = root.packageName?.toString() ?: "unknown"
                    Log.d(TAG, "--- Window[$idx] id=${window.id} type=${window.type} pkg=$winPkg childCount=${root.childCount} ---")
                    deepDumpNode(root, 0, 30)
                    root.recycle()
                }
            } catch (e: Exception) {}
        }
        Log.d(TAG, "=== DEBUG DUMP END ===")
    }

    /**
     * Dump EVERY node that has any text, contentDescription, or viewId.
     * No position filtering, no URL heuristic — raw dump to discover hidden nodes.
     */
    private fun deepDumpNode(node: AccessibilityNodeInfo, depth: Int, maxDepth: Int) {
        if (depth > maxDepth) return

        val rect = android.graphics.Rect()
        node.getBoundsInScreen(rect)

        val text = node.text?.toString()
        val desc = node.contentDescription?.toString()
        val viewId = node.viewIdResourceName
        val className = node.className?.toString()?.substringAfterLast('.')

        // Log ANY node that has text, desc, or a viewId — no position filter
        val hasContent = text != null || desc != null || viewId != null
        if (hasContent) {
            val indent = "  ".repeat(minOf(depth, 10))
            val textHex = text?.let { dumpHex(it.take(30)) } ?: ""
            Log.d(TAG, "${indent}DUMP d=$depth [$rect] cls=$className id=$viewId text=[${text?.take(80)}] desc=[${desc?.take(80)}] hex=[$textHex]")
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            deepDumpNode(child, depth + 1, maxDepth)
            child.recycle()
        }
    }

    /**
     * Convert a string to hex representation to detect invisible/control characters.
     */
    private fun dumpHex(s: String): String {
        return s.map { String.format("%04x", it.code) }.joinToString(" ")
    }

    /**
     * Debug: recursively dump node tree looking for URL-like text nodes.
     */
    private fun dumpNodeTree(node: AccessibilityNodeInfo, packageName: String, depth: Int, maxDepth: Int) {
        if (depth > maxDepth) return
        val text = node.text?.toString()
        val viewId = node.viewIdResourceName
        val className = node.className?.toString()
        if (text != null && (looksLikeUrl(text) || viewId?.contains("url") == true || viewId?.contains("toolbar") == true)) {
            Log.d(TAG, "FIREFOX_TREE_DEBUG depth=$depth class=$className id=$viewId text=[$text]")
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            dumpNodeTree(child, packageName, depth + 1, maxDepth)
            child.recycle()
        }
    }

    /**
     * Extract the URL from a browser's accessibility event.
     *
     * @param event The accessibility event from the browser
     * @param rootNode The root node of the active window
     * @param packageName The browser's package name
     * @return The extracted URL, or null if not found
     */
    fun extractUrlCandidates(
        event: AccessibilityEvent,
        rootNode: AccessibilityNodeInfo?,
        packageName: String
    ): Set<String>? {
        val config = browsers[packageName] ?: return null

        val candidates = mutableSetOf<String>()

        findUrlByResourceId(rootNode, packageName, config.urlBarId)?.let { candidates.add(it) }
        tryFallbackUrlBarIds(rootNode, packageName, config.urlBarId)?.let { candidates.add(it) }
        findUrlFromEventText(event)?.let { candidates.add(it) }
        extractUrlFromToolbarDescription(rootNode, packageName)?.let { candidates.add(it) }
        
        tryUniversalFallbackIdsAll(rootNode, packageName).forEach { candidates.add(it) }
        
        // Explicit Samsung Toolbar Search (bypasses event.packageName mismatch)
        if (packageName == "com.sec.android.app.sbrowser") {
            findUrlByResourceId(rootNode, "com.sec.android.app.sbrowser", "location_bar_edit_text")?.let { candidates.add(it) }
        }
        
        // Final fallback: Comprehensive Web/Indicators search
        searchWebViewForUrls(rootNode).forEach { candidates.add(it) }

        // Samsung Specific: Aggressive layered toolbar scan
        if (packageName == "com.sec.android.app.sbrowser" && rootNode != null) {
            scanSamsungToolbar(rootNode, candidates)
        }

        findUrlFromWindowEvent(event)?.let { candidates.add(it) }

        return finalizeCandidates(candidates)
    }

    private fun scanSamsungToolbar(root: AccessibilityNodeInfo, candidates: MutableSet<String>) {
        val toolbarIds = listOf(
            "com.sec.android.app.sbrowser:id/toolbar",
            "com.sec.android.app.sbrowser:id/toolbar_outer",
            "com.sec.android.app.sbrowser:id/location_bar",
            "com.sec.android.app.sbrowser:id/location_bar_edit_text",
            "com.sec.android.app.sbrowser:id/url_bar_parent",
            "com.sec.android.app.sbrowser:id/url_bar_container"
        )
        for (id in toolbarIds) {
            try {
                val nodes = root.findAccessibilityNodeInfosByViewId(id)
                nodes?.forEach { node ->
                    collectAllTextInBranch(node, candidates)
                    node.recycle()
                }
            } catch (_: Exception) {}
        }
    }

    private fun collectAllTextInBranch(node: AccessibilityNodeInfo, candidates: MutableSet<String>): String {
        val branchText = java.lang.StringBuilder()
        
        node.text?.toString()?.let { 
            if (it.isNotBlank()) {
                candidates.add(it)
                branchText.append(it)
            }
        }
        
        node.contentDescription?.toString()?.let { 
            if (it.isNotBlank()) {
                candidates.add(it)
                if (branchText.isEmpty()) branchText.append(it)
            }
        }
        
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val childText = collectAllTextInBranch(child, candidates)
            if (childText.isNotBlank()) {
                branchText.append(childText)
            }
            child.recycle()
        }
        
        val fullText = branchText.toString()
        if (fullText.isNotBlank()) {
            candidates.add(fullText)
        }
        return fullText
    }

    /**
     * More aggressive extraction that scans ALL windows for browser content.
     * Useful when the browser has detached toolbars or floating windows.
     */
    fun extractUrlCandidatesWithWindows(
        event: AccessibilityEvent,
        windows: List<android.view.accessibility.AccessibilityWindowInfo>?,
        activeRoot: AccessibilityNodeInfo?,
        targetPackageName: String
    ): Set<String>? {
        val candidates = mutableSetOf<String>()
        
        // 1. Try standard extraction on active root provided by the service
        extractUrlCandidates(event, activeRoot, targetPackageName)?.forEach { candidates.add(it) }

        // 2. Try standard extraction on event source (often narrower but highly relevant)
        val eventRoot = event.source
        if (eventRoot != null && eventRoot != activeRoot) {
            extractUrlCandidates(event, eventRoot, targetPackageName)?.forEach { candidates.add(it) }
            eventRoot.recycle()
        }

        // 2. If empty, scavenge ALL windows
        if (candidates.isEmpty() && windows != null) {
            for (window in windows) {
                try {
                    val root = window.root ?: continue
                    val winPkg = root.packageName?.toString() ?: ""
                    
                    // Focus on windows belonging to the browser, or system/null windows that might host its UI
                    if (winPkg == targetPackageName || winPkg.isEmpty() || winPkg == "android") {
                        searchWebViewForUrls(root).forEach { candidates.add(it) }
                        
                        // Try direct resource ID on this root too
                        val config = browsers[targetPackageName]
                        if (config != null) {
                            findUrlByResourceId(root, targetPackageName, config.urlBarId)?.let { candidates.add(it) }
                            if (targetPackageName == "com.sec.android.app.sbrowser") {
                                findUrlByResourceId(root, "com.sec.android.app.sbrowser", "location_bar_edit_text")?.let { candidates.add(it) }
                            }
                        }
                    }
                    root.recycle()
                } catch (_: Exception) {}
            }
        }

        return finalizeCandidates(candidates)
    }

    private fun finalizeCandidates(candidates: Set<String>): Set<String>? {
        if (candidates.isEmpty()) return null
        val normalized = candidates.map { normalizeUrl(it) }.filter { it.isNotBlank() }.toSet()
        return if (normalized.isEmpty()) null else normalized
    }

    /**
     * Search WebView content for blocked domain text using findAccessibilityNodeInfosByText.
     * This catches AMP pages, redirects, and other cases where the URL bar shows a
     * search engine domain but the actual content is from a blocked site.
     *
     * Unlike tree traversal, findAccessibilityNodeInfosByText can find text rendered
     * inside WebViews (which are opaque to tree scanning).
     *
     * @param rootNode The root node to search in
     * @param keywords The set of blocked keywords to search for
     * @return Set of URL-like text found that might be blocked domains
     */
    /**
     * Search WebView content for blocked domain text or keywords using findAccessibilityNodeInfosByText.
     * This catches AMP pages, redirects, and other cases where the URL bar is hidden
     * or the actual content is from a blocked site but the URL bar is misleading.
     *
     * Unlike tree traversal, findAccessibilityNodeInfosByText can find text rendered
     * inside WebViews (which are opaque to tree scanning).
     */
    fun searchWebViewForUrls(
        rootNode: AccessibilityNodeInfo?,
        keywords: Set<String> = emptySet()
    ): Set<String> {
        val found = mutableSetOf<String>()
        if (rootNode == null) return found

        // 1. Recursive scan (will catch native components and exposed WebViews)
        fun scanNodes(node: AccessibilityNodeInfo, depth: Int, maxDepth: Int) {
            if (depth > maxDepth) return
            
            val text = node.text?.toString()
            if (text != null && text.length in 3..254) {
                if (looksLikeUrl(text)) found.add(text)
                // Check keywords during scan as well
                for (kw in keywords) {
                    if (text.contains(kw, ignoreCase = true)) {
                        found.add(kw) // Add the keyword itself as a candidate
                    }
                }
            }
            val desc = node.contentDescription?.toString()
            if (desc != null && desc.length in 3..254) {
                if (looksLikeUrl(desc)) {
                    extractUrlFromDescription(desc)?.let { found.add(it) } ?: found.add(desc)
                }
                for (kw in keywords) {
                    if (desc.contains(kw, ignoreCase = true)) found.add(kw)
                }
            }
            
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                scanNodes(child, depth + 1, maxDepth)
                child.recycle()
            }
        }
        
        try {
            scanNodes(rootNode, 0, MAX_SCAN_DEPTH)
        } catch (e: Exception) {
            Log.w(TAG, "Error in WebView deep tree scan: ${e.message}")
        }
        
        // 2. Targeted IPC search (forces Samsung WebViews/Toolbars to reveal opaque text nodes)
        // This is critical because Samsung Internet does not populate child views until explicitly searched!
        val searchIndicators = ADULT_TLDS + listOf(
            "http", "www", ".com", ".net", ".org", ".co", ".io", ".me", ".cc", ".info", ".ly", ".gl", "://"
        ) + keywords.toList() // Search for custom keywords directly via IPC
        
        for (indicator in searchIndicators) {
            if (indicator.length < 3) continue 
            try {
                val nodes = rootNode.findAccessibilityNodeInfosByText(indicator)
                if (nodes != null) {
                    for (node in nodes) {
                        // 1. Take node text/desc
                        node.text?.toString()?.let { found.add(it) }
                        node.contentDescription?.toString()?.let { found.add(it) }
                        
                        // 2. Take PARENT text (crucial for split text nodes like [pornhub][.com])
                        node.parent?.let { parent ->
                            parent.text?.toString()?.let { found.add(it) }
                            parent.contentDescription?.toString()?.let { found.add(it) }
                            
                            // 3. Briefly check siblings if parent is a container
                            for (i in 0 until minOf(parent.childCount, 5)) {
                                parent.getChild(i)?.let { sibling ->
                                    sibling.text?.toString()?.let { found.add(it) }
                                    sibling.recycle()
                                }
                            }
                            parent.recycle()
                        }
                    }
                    nodes.forEach { it.recycle() }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Error in WebView text extraction for '$indicator': ${e.message}")
            }
        }
        
        if (found.isNotEmpty()) {
            Log.d(TAG, "searchWebViewForUrls found ${found.size} candidates using indicators and tree scan")
        }
        return found
    }

    /**
     * Clear the last detected URL cache. Use after a block to force immediate re-detection.
     */
    fun clearLastUrl() {
        lastDetectedUrl = ""
    }

    /**
     * Try alternative URL bar IDs for browsers that change IDs across versions.
     * Firefox in particular has used several different IDs over the years.
     */
    private fun tryFallbackUrlBarIds(
        rootNode: AccessibilityNodeInfo?,
        packageName: String,
        primaryId: String
    ): String? {
        if (rootNode == null) return null
        val fallbacks = FIREFOX_URL_BAR_FALLBACKS.filter { it != primaryId }
        if (!isMozillaBased(packageName)) return null
        for (id in fallbacks) {
            val result = findUrlByResourceId(rootNode, packageName, id)
            if (result != null) return result
        }
        return null
    }

    /**
     * Try common URL bar IDs that work across many Chromium-based browsers, returning all found.
     */
    private fun tryUniversalFallbackIdsAll(
        rootNode: AccessibilityNodeInfo?,
        packageName: String
    ): List<String> {
        val results = mutableListOf<String>()
        if (rootNode == null) return results
        for (id in UNIVERSAL_URL_BAR_FALLBACKS) {
            val result = findUrlByResourceId(rootNode, packageName, id)
            if (result != null) results.add(result)
        }
        return results
    }

    /**
     * Find the URL bar node by its resource ID and extract text.
     */
    private fun findUrlByResourceId(
        rootNode: AccessibilityNodeInfo?,
        packageName: String,
        urlBarId: String
    ): String? {
        if (rootNode == null) return null

        val fullResourceId = if (urlBarId.contains(":")) urlBarId else "$packageName:id/$urlBarId"

        try {
            val nodes = rootNode.findAccessibilityNodeInfosByViewId(fullResourceId)
            if (nodes != null && nodes.isNotEmpty()) {
                val urlNode = nodes[0]
                val text = urlNode.text?.toString()
                if (text != null && text.length >= 3) {
                    nodes.forEach { it.recycle() }
                    return text
                }
                
                // Log if we found the ID but it has no text (pruning check)
                Log.d(TAG, "Found resource ID $fullResourceId but text was null or too short: [$text]")

                // Samsung/Chrome optimization: if we found the toolbar node but it has no text,
                // do an immediate tree-scan restricted to this branch.
                val branchCands = searchWebViewForUrls(urlNode)
                if (branchCands.isNotEmpty()) {
                    val winner = branchCands.first()
                    Log.d(TAG, "Branch scan recovered text from ID branch: $winner")
                    nodes.forEach { it.recycle() }
                    return winner
                }

                // If the container itself has no text, search its immediate children (older method)
                val childCandidates = mutableListOf<String>()
                collectUrlCandidates(urlNode, 0, 3, childCandidates)
                nodes.forEach { it.recycle() }
                return childCandidates.firstOrNull()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error finding URL bar: ${e.message}")
        }

        return null
    }

    private fun findUrlFromEventText(event: AccessibilityEvent): String? {
        // Check event text (reversed to check newest first)
        event.text?.reversed()?.forEach { text ->
            val str = text?.toString() ?: return@forEach
            if (looksLikeUrl(str)) return str
            // Sometimes the domain is hiding inside a page title (e.g. "pornhub.com - videos")
            val words = str.split(Regex("\\s+"))
            if (words.size > 1) {
                for (word in words) {
                    if (word.length in 4..254 && looksLikeUrl(word)) return word
                }
            }
        }
        
        val contentDesc = event.contentDescription?.toString()
        if (contentDesc != null) {
            if (looksLikeUrl(contentDesc)) return contentDesc
            val extracted = extractUrlFromDescription(contentDesc)
            if (extracted != null) return extracted
            
            val words = contentDesc.split(Regex("\\s+"))
            if (words.size > 1) {
                for (word in words) {
                    if (word.length in 4..254 && looksLikeUrl(word)) return word
                }
            }
        }
        return null
    }

    private fun findUrlFromWindowEvent(event: AccessibilityEvent): String? {
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            event.text?.reversed()?.forEach { text ->
                val str = text?.toString() ?: return@forEach
                if (looksLikeUrl(str)) return str
                
                val words = str.split(Regex("\\s+"))
                if (words.size > 1) {
                    for (word in words) {
                        if (word.length in 4..254 && looksLikeUrl(word)) return word
                    }
                }
            }
        }
        return null
    }

    /**
     * Extract a URL from a contentDescription that may contain additional text.
     * Firefox's toolbar uses descriptions like " example.com. Search or enter address".
     */
    private fun extractUrlFromDescription(description: String): String? {
        val trimmed = description.trim()
        // Split on ". " to separate the URL from descriptive text
        val parts = trimmed.split(". ")
        if (parts.isNotEmpty()) {
            val candidate = parts[0].trim().trimEnd('.')
            if (candidate.isNotEmpty() && looksLikeUrl(candidate)) {
                return candidate
            }
        }
        return null
    }

    /**
     * Scan the accessibility tree for toolbar nodes that contain URL-like contentDescription.
     * Modern Firefox uses Compose UI where the URL bar is not a standard EditText
     * but a Compose view with contentDescription containing the URL.
     */
    private fun extractUrlFromToolbarDescription(
        rootNode: AccessibilityNodeInfo?,
        packageName: String
    ): String? {
        if (rootNode == null) return null
        // Only use tree scanning for Mozilla-based browsers (Compose-based toolbar)
        if (!isMozillaBased(packageName)) return null

        try {
            return scanNodeForUrl(rootNode, 0, MAX_SCAN_DEPTH)
        } catch (e: Exception) {
            Log.w(TAG, "Error scanning tree for URL: ${e.message}")
        }
        return null
    }

    /**
     * Recursively scan node tree for contentDescription containing a URL.
     */
    private fun scanNodeForUrl(node: AccessibilityNodeInfo, depth: Int, maxDepth: Int): String? {
        if (depth > maxDepth) return null

        val desc = node.contentDescription?.toString()
        if (desc != null) {
            val extracted = extractUrlFromDescription(desc)
            if (extracted != null) return extracted
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = scanNodeForUrl(child, depth + 1, maxDepth)
            child.recycle()
            if (result != null) return result
        }

        return null
    }

    private fun scanTreeForAllUrls(rootNode: AccessibilityNodeInfo?): List<String>? {
        if (rootNode == null) return null
        val candidates = mutableListOf<String>()
        collectUrlCandidates(rootNode, 0, MAX_SCAN_DEPTH, candidates)
        return if (candidates.isEmpty()) null else candidates
    }

    private fun findByClassName(rootNode: AccessibilityNodeInfo?, classMarker: String): String? {
        if (rootNode == null) return null
        fun scan(node: AccessibilityNodeInfo, depth: Int): String? {
            if (depth > 60) return null
            val cls = node.className?.toString() ?: ""
            if (cls.contains(classMarker, ignoreCase = true)) {
                val text = node.text?.toString()
                // Accept any substantial text from a confirmed Location/URL bar class
                if (text != null && text.length >= 3) return text
            }
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                val result = scan(child, depth + 1)
                child.recycle()
                if (result != null) return result
            }
            return null
        }
        return try { scan(rootNode, 0) } catch (e: Exception) { null }
    }

    private fun collectUrlCandidates(node: AccessibilityNodeInfo, depth: Int, maxDepth: Int, output: MutableList<String>) {

        val text = node.text?.toString()
        if (text != null && text.length in 4..254 && looksLikeUrl(text)) {
            output.add(text)
        }
        val desc = node.contentDescription?.toString()
        if (desc != null && desc.length in 4..254 && looksLikeUrl(desc)) {
            extractUrlFromDescription(desc)?.let { output.add(it) } ?: output.add(desc)
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectUrlCandidates(child, depth + 1, maxDepth, output)
            child.recycle()
        }
    }




    fun extractAllText(rootNode: AccessibilityNodeInfo?): String {
        if (rootNode == null) return ""
        val sb = StringBuilder()
        
        fun traverse(node: AccessibilityNodeInfo, depth: Int) {
            if (depth > 60) return
            val t = node.text?.toString()
            if (!t.isNullOrBlank()) {
                sb.append(t).append(" ")
            }
            val d = node.contentDescription?.toString()
            if (!d.isNullOrBlank()) {
                sb.append(d).append(" ")
            }
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                traverse(child, depth + 1)
                child.recycle()
            }
        }
        
        try {
            traverse(rootNode, 0)
        } catch (_: Exception) {}
        return sb.toString()
    }

    private fun isMozillaBased(packageName: String): Boolean {
        return packageName.startsWith("org.mozilla.") || 
               packageName == "net.waterfox.android.release" ||
               packageName == "org.torproject.torbrowser" ||
               packageName == "com.cookiedev.mull" ||
               packageName == "org.gnu.icecat" ||
               packageName == "io.github.forkmaintainers.iceraven" ||
               packageName.contains("fennec")
    }

    /**
     * URL heuristic — does this string look like a URL or a blocked identifier?
     */
    private fun looksLikeUrl(text: String): Boolean {
        // Strip out invisible control characters like U+200E that Samsung injects
        val stripped = text.replace(Regex("[\\u200E\\u200F\\u200B\\u200C\\u200D\\uFEFF]"), "").trim()
        val t = stripped.lowercase()
        
        if (t.isEmpty() || t.length < 3 || t == ".com" || t == ".net") return false
        
        // Protocol or WWW is a definite URL
        if (t.startsWith("http://") || t.startsWith("https://") || t.startsWith("www.")) return true
        
        // If it contains Samsung's pipe separator, it's a URL candidate!
        if (t.contains('|')) return true

        // If it has spaces but no dots/slashes, it's just a search query (ignore)
        if (t.contains(' ') && !t.contains('.') && !t.contains('/')) return false
        
        // If it contains common TLDs, it's a candidate regardless of spaces (to catch Page Titles)
        if (t.contains(".com") || t.contains(".net") || t.contains(".tv") || 
            t.contains(".xxx") || t.contains(".org") || t.contains(".site") || 
            t.contains(".io") || t.contains(".me") || t.contains(".cc") || t.contains(".info")) return true
            
        // Standard domain pattern
        val dotIndex = t.indexOf('.')
        if (dotIndex > 0 && dotIndex < t.length - 2 && !t.contains(' ')) return true
        
        // Fallback: If it's short and contains a dot, it might be a domain (e.g. "sex.com")
        if (dotIndex > 0 && dotIndex < t.length - 2) return true

        return false
    }

    private fun normalizeUrl(url: String): String {
        // Handle Samsung Internet's masked URLs and Titles
        // Example: "pornhub.com | Watch Videos" -> We want "pornhub.com"
        val split = url.split('|')
        val firstPart = split[0].trim()
        
        // If there's a second part (the Title), we should check that too 
        // through the Matcher, but normalizeUrl returns one primary candidate.
        // We'll return the whole thing if it's not a clear pipe to let keywords hit.
        val cleanUrl = if (split.size > 1 && looksLikeUrl(firstPart)) firstPart else url.trim()

        // Strip Unicode formatting characters
        val stripped = cleanUrl.replace(Regex("[\\u200E\\u200F\\u200B\\u200C\\u200D\\uFEFF]"), "")

        return stripped.lowercase()
            .removePrefix("https://")
            .removePrefix("http://")
            .removePrefix("www.")
            .removeSuffix("/")
    }

    companion object {
        private const val TAG = "BrowserUrlMonitor"
        private const val PREFS_NAME = "freedom_browser_configs"
        private const val PREFS_KEY_BROWSERS = "browsers"
        private const val MAX_SCAN_DEPTH = 150

        // Firefox has changed URL bar IDs across versions
        private val FIREFOX_URL_BAR_FALLBACKS = listOf(
            "mozac_browser_toolbar_url_view",
            "url_bar_title",
            "mozac_browser_toolbar_edit_url_view",
            "url_bar"
        )

        // TLDs almost exclusively used for adult content — search WebView text for these
        private val ADULT_TLDS = listOf(
            ".xxx", ".porn", ".sex", ".adult", ".sexy"
        )

        private val UNIVERSAL_URL_BAR_FALLBACKS = listOf(
            "url_bar", "url_edit", "url_field", "url",
            "address_bar", "location_bar_edit_text", "url_bar_text",
            "omnibarTextInput", "url_bar_title", "url_text",
            "address_bar_text", "search_entry", "url_view",
            "search_box", "search_edit_text", "tv_url",
            "search_edit", "search_button", "search_view",
            "location_bar", "urlBar", "addressBar", "search_area",
            "search_input", "url_input", "edit_text", "text_view",
            "url_container", "address_container", "search_container",
            "custom_tab_url", "privacy_bar", "url_anchor",
            // Samsung Internet AMP/redirect indicator bar IDs
            "pagehead_url", "amp_url", "original_url", "site_url",
            "header_text", "page_url", "security_url", "url_info"
        )
    }
}
