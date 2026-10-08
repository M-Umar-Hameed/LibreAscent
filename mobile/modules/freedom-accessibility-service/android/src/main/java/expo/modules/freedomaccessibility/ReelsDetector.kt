package expo.modules.freedomaccessibility

import android.content.Context
import android.graphics.Rect
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Detects when users enter reels/shorts sections of social media apps.
 *
 * Detection strategy:
 * 1. Check if the foreground app is a monitored social media app
 * 2. Traverse the accessibility node tree looking for detection node IDs
 * 3. If a detection node is found - user is viewing reels
 *
 * This does NOT block the entire app - only the reels/shorts section.
 */
class ReelsDetector {

    data class ReelsAppConfig(
        val name: String,
        val packageName: String,
        val detectionNodes: List<String>
    )

    // Written from the JS thread via updateConfigs, read from the accessibility thread.
    private val reelsApps = ConcurrentHashMap<String, ReelsAppConfig>()
    private val lastDetectionState = ConcurrentHashMap<String, Boolean>()

    /**
     * Update the list of monitored reels apps.
     */
    fun updateConfigs(configs: List<ReelsAppConfig>, context: Context? = null) {
        // Drop-then-add would leave a window where a reader sees no reels apps at all.
        reelsApps.keys.retainAll(configs.map { it.packageName }.toSet())
        configs.forEach { config ->
            reelsApps[config.packageName] = config
        }
        Log.i(TAG, "Updated reels configs: ${reelsApps.keys}")
        context?.let { persistConfigs(it, configs) }
    }

    /** Restore after a service restart; Android destroys this service on app update. */
    fun loadPersistedConfigs(context: Context) {
        val stored = try {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_REELS_CONFIGS, null)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read reels configs: ${e.message}")
            null
        }
        val configs = parseConfigs(stored)
        if (configs.isEmpty()) return
        configs.forEach { config -> reelsApps[config.packageName] = config }
        Log.i(TAG, "Restored reels configs: ${reelsApps.keys}")
    }

    private fun persistConfigs(context: Context, configs: List<ReelsAppConfig>) {
        try {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_REELS_CONFIGS, serializeConfigs(configs))
                .apply()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to persist reels configs: ${e.message}")
        }
    }

    /**
     * Check if a package is a monitored reels app.
     */
    fun isReelsApp(packageName: String): Boolean {
        return reelsApps.containsKey(packageName)
    }

    /** The enabled reels app whose short videos [url] opens on the web, if any. */
    fun enabledAppForUrl(url: String): ReelsAppConfig? =
        shortVideoPackages(url).firstNotNullOfOrNull { reelsApps[it] }

    /**
     * Detect if the user is currently in a reels/shorts section.
     *
     * @param rootNode The root node of the active window
     * @param packageName The app's package name
     * @param deadline uptimeMillis after which no further node search starts
     * @return Detection result with app name and whether reels are detected
     */
    fun detectReels(
        rootNode: AccessibilityNodeInfo?,
        packageName: String,
        deadline: Long
    ): DetectionResult? {
        val config = reelsApps[packageName] ?: return null

        if (rootNode == null) {
            // No root node available
            return null
        }

        // IMPORTANT: If the active window isn't the app we're monitoring (e.g., our overlay is active),
        // don't report a state change. Reporting "not in reels" while the overlay is showing
        // will cause a loop (hide overlay -> detect reels -> show overlay -> repeat).
        val rootPackage = rootNode.packageName?.toString()
        if (rootPackage != null && rootPackage != packageName) {
            return null
        }

        // Out of budget before a match is not evidence of having left reels, and
        // reporting it as such would drop the overlay.
        val isInReels = checkForReelsNodes(rootNode, packageName, config.detectionNodes, deadline) ?: return null

        // Only report state changes to avoid spamming
        val previousState = lastDetectionState[packageName] ?: false
        if (isInReels != previousState) {
            lastDetectionState[packageName] = isInReels
            return DetectionResult(
                appName = config.name,
                packageName = packageName,
                isInReels = isInReels
            )
        }

        // No state change
        return null
    }

    /**
     * Search the node tree for any of the detection node IDs.
     *
     * @return null when the deadline passed before the answer was known.
     */
    private fun checkForReelsNodes(
        rootNode: AccessibilityNodeInfo,
        packageName: String,
        detectionNodes: List<String>,
        deadline: Long
    ): Boolean? {
        // Facebook strips its view ids, and its home feed shows Reels and Stories
        // labels, so only labels the reel viewer itself carries count.
        if (packageName.contains("com.facebook.")) {
            for (marker in FACEBOOK_REEL_VIEWER_MARKERS) {
                if (overDeadline(deadline)) return null
                val matches = rootNode.findAccessibilityNodeInfosByText(marker) ?: continue
                var found = false
                for (match in matches) {
                    if (!found && match.isVisibleToUser &&
                        isFacebookReelViewerLabel(match.contentDescription?.toString() ?: match.text?.toString())
                    ) {
                        found = true
                    }
                    match.recycle()
                }
                if (found) return true
            }
            return false
        }

        // Snapchat plays friends' stories and Discover in the same viewer; only a
        // friend's story offers "Reply to <name>...".
        if (packageName == SNAPCHAT && isSnapchatDiscoverViewer(rootNode)) return true

        for (nodeId in detectionNodes) {
            if (overDeadline(deadline)) return null
            val fullResourceId = "$packageName:id/$nodeId"
            try {
                val nodes = rootNode.findAccessibilityNodeInfosByViewId(fullResourceId)
                if (nodes != null && nodes.isNotEmpty()) {
                    // Found a reels node - check if it's visible
                    val found = nodes.any { node ->
                        val visible = node.isVisibleToUser
                        node.recycle()
                        visible
                    }
                    if (found) {
                        Log.d(TAG, "Reels detected in $packageName via node: $nodeId")
                        return true
                    }
                }
            } catch (e: Exception) {
                // Node search failed - continue checking other IDs
            }
        }

        // Fallback: check content descriptions and class names for reels keywords
        return scanNodeTreeForReelsHints(rootNode, packageName, deadline)
    }

    /**
     * Fallback detection: use findAccessibilityNodeInfosByText to search the
     * entire node tree for reels keywords. This is much more reliable than
     * manual traversal since it searches all depths and checks both text
     * and contentDescription.
     *
     * @return null when the deadline passed before every keyword was searched.
     */
    private fun scanNodeTreeForReelsHints(node: AccessibilityNodeInfo?, packageName: String, deadline: Long): Boolean? {
        if (node == null) return false

        try {
            val windowBounds = Rect().also { node.getBoundsInScreen(it) }
            for (keyword in REELS_KEYWORDS) {
                if (overDeadline(deadline)) return null
                val matches = node.findAccessibilityNodeInfosByText(keyword)
                if (matches.isNullOrEmpty()) continue

                var found = false
                for (match in matches) {
                    if (!found && match.isVisibleToUser) {
                        val label = match.text?.toString() ?: match.contentDescription?.toString()
                        found = hasScrollableReelsAncestor(match, packageName, label, windowBounds.height())
                        if (found) Log.d(TAG, "Reels detected in $packageName via keyword: $keyword")
                    }
                    match.recycle()
                }
                if (found) return true
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error scanning node tree: ${e.message}")
        }

        return false
    }

    /**
     * Walk up to 10 ancestors until one decides whether the label sits in a
     * scrollable reels feed container.
     */
    private fun hasScrollableReelsAncestor(
        node: AccessibilityNodeInfo,
        packageName: String,
        label: String?,
        windowHeight: Int
    ): Boolean {
        var current = node.parent ?: return false
        val bounds = Rect()
        for (i in 0 until 10) {
            val className = current.className?.toString() ?: ""
            current.getBoundsInScreen(bounds)
            reelsAncestorVerdict(className, current.isScrollable, packageName, label, bounds.height(), windowHeight)?.let {
                current.recycle()
                return it
            }

            val next = current.parent
            current.recycle()
            current = next ?: return false
        }
        current.recycle()
        return false
    }

    @Volatile
    private var snapchatPublicViewerSince = 0L

    /**
     * Discover, Quick Add suggestions and other public stories offer "View
     * Profile" and no reply bar; a friend's story offers "Reply to <name>...".
     * The reply bar renders a moment after the viewer opens, so the verdict
     * waits until the public signs have held for SNAPCHAT_SETTLE_MS.
     */
    private fun isSnapchatDiscoverViewer(root: AccessibilityNodeInfo): Boolean {
        val viewerOpen = anyVisible(root.findAccessibilityNodeInfosByViewId("$SNAPCHAT:id/opera_viewer"))
        var friendStory = false
        if (viewerOpen) {
            for (node in root.findAccessibilityNodeInfosByText("Reply to") ?: emptyList()) {
                if (node.isVisibleToUser && node.text?.toString()?.startsWith("Reply to") == true) {
                    friendStory = true
                }
                node.recycle()
            }
        }
        val publicStory = viewerOpen && !friendStory &&
            anyVisible(root.findAccessibilityNodeInfosByText("View Profile"))
        val now = android.os.SystemClock.uptimeMillis()
        return snapchatPublicStorySettled(publicStory, now)
    }

    internal fun snapchatPublicStorySettled(publicStory: Boolean, now: Long): Boolean {
        if (!publicStory) {
            snapchatPublicViewerSince = 0L
            return false
        }
        if (snapchatPublicViewerSince == 0L) snapchatPublicViewerSince = now
        return now - snapchatPublicViewerSince >= SNAPCHAT_SETTLE_MS
    }

    private fun anyVisible(nodes: List<AccessibilityNodeInfo>?): Boolean {
        if (nodes.isNullOrEmpty()) return false
        var visible = false
        for (node in nodes) {
            if (node.isVisibleToUser) visible = true
            node.recycle()
        }
        return visible
    }

    /**
     * Reset detection state (e.g., when user navigates away from a reels app).
     *
     * @return true if the package was last seen in reels.
     */
    fun resetState(packageName: String): Boolean {
        return lastDetectionState.remove(packageName) == true
    }

    private fun overDeadline(deadline: Long) = android.os.SystemClock.uptimeMillis() > deadline

    data class DetectionResult(
        val appName: String,
        val packageName: String,
        val isInReels: Boolean
    )

    companion object {
        private const val TAG = "ReelsDetector"
        private const val PREFS_NAME = "freedom_settings"
        private const val KEY_REELS_CONFIGS = "reels_configs"
        private const val YOUTUBE = "com.google.android.youtube"
        private const val SNAPCHAT = "com.snapchat.android"
        private const val SNAPCHAT_SETTLE_MS = 800L

        /**
         * What one ancestor of a visible reels label says: true when it is the
         * scrollable reels feed, false when it rules the label out, null to keep
         * climbing. ViewPager is the swipeable video container reels feeds use;
         * RecyclerView is too broad for Instagram, but Facebook often uses it for
         * reels. YouTube's Shorts feed is a RecyclerView too, and there the
         * nearest scrollable one decides: it counts only for a label reading
         * exactly "Shorts" (titles contain the word, "Watch later" the other
         * keywords) in a list taller than half the window. A filter chip sits in
         * a short horizontal list, which must not be skipped for the tall feed
         * around it.
         */
        internal fun reelsAncestorVerdict(
            className: String,
            scrollable: Boolean,
            packageName: String,
            label: String?,
            height: Int,
            windowHeight: Int
        ): Boolean? {
            if (!scrollable) return null
            // Facebook's home feed carries a Reels shelf and tab labels inside its
            // scrolling lists and tab pager, so a label there says nothing about
            // the reel viewer.
            if (packageName.contains("com.facebook.")) return false
            if (className.contains("ViewPager")) return true
            if (!className.contains("RecyclerView")) return null
            if (packageName != YOUTUBE) return null
            return label?.trim().equals("Shorts", ignoreCase = true) && height * 2 > windowHeight
        }

        /**
         * Packages of the apps whose short videos [url] opens on the web. Matches
         * the host and any subdomain (m., www.) and the first path segment.
         */
        internal fun shortVideoPackages(url: String): List<String> {
            val u = url.trim().lowercase().substringAfter("://").substringBefore(' ')
            val hostEnd = u.indexOfAny(charArrayOf('/', '?', '#')).let { if (it < 0) u.length else it }
            val host = u.substring(0, hostEnd)
            val firstSegment = u.substring(hostEnd).substringBefore('?').substringBefore('#')
                .removePrefix("/").substringBefore('/')
            fun on(domain: String) = host == domain || host.endsWith(".$domain")
            return when {
                on("youtube.com") && firstSegment == "shorts" -> listOf(YOUTUBE)
                on("instagram.com") && (firstSegment == "reel" || firstSegment == "reels") ->
                    listOf("com.instagram.android")
                on("facebook.com") && firstSegment == "reel" -> listOf("com.facebook.katana")
                on("tiktok.com") -> listOf("com.zhiliaoapp.musically", "com.ss.android.ugc.trill")
                else -> emptyList()
            }
        }

        fun serializeConfigs(configs: List<ReelsAppConfig>): String {
            val array = JSONArray()
            configs.forEach { config ->
                array.put(
                    JSONObject().apply {
                        put("name", config.name)
                        put("packageName", config.packageName)
                        put("detectionNodes", JSONArray(config.detectionNodes))
                    }
                )
            }
            return array.toString()
        }

        fun parseConfigs(json: String?): List<ReelsAppConfig> {
            if (json.isNullOrBlank()) return emptyList()
            return try {
                val array = JSONArray(json)
                val out = ArrayList<ReelsAppConfig>(array.length())
                for (i in 0 until array.length()) {
                    val obj = array.optJSONObject(i) ?: continue
                    val packageName = obj.optString("packageName")
                    if (packageName.isNullOrBlank()) continue
                    val nodes = obj.optJSONArray("detectionNodes")
                    val detectionNodes = if (nodes == null) {
                        emptyList()
                    } else {
                        (0 until nodes.length()).mapNotNull { nodes.optString(it).takeIf { s -> s.isNotBlank() } }
                    }
                    out.add(
                        ReelsAppConfig(
                            name = obj.optString("name"),
                            packageName = packageName,
                            detectionNodes = detectionNodes,
                        )
                    )
                }
                out
            } catch (e: Exception) {
                Log.w(TAG, "Failed to parse reels configs: ${e.message}")
                emptyList()
            }
        }

        // Seen on device (Facebook, Oct 2026): the Reels tab and reel viewer label
        // these controls; the home feed's Reels shelf and Stories do not.
        private val FACEBOOK_REEL_VIEWER_MARKERS = listOf(
            "Reels tab details",
            "Navigate to your Reels profile",
            "'s reels"
        )

        internal fun isFacebookReelViewerLabel(label: String?): Boolean {
            val l = label?.trim() ?: return false
            return l.equals("Reels tab details", ignoreCase = true) ||
                l.equals("Navigate to your Reels profile", ignoreCase = true) ||
                (l.startsWith("View ", ignoreCase = true) && l.endsWith("'s reels", ignoreCase = true))
        }

        // Fallback keywords for reels detection
        private val REELS_KEYWORDS = listOf(
            "Shorts",
            "Reels",
            "Reel",
            "Spotlight",
            "Short video",
            "Video home",
            "Watch",
            "Watch feed",
            "Videos on Watch"
        )
    }
}
