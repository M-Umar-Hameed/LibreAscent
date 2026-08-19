package expo.modules.freedomaccessibility

import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
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
    fun updateConfigs(configs: List<ReelsAppConfig>) {
        // Drop-then-add would leave a window where a reader sees no reels apps at all.
        reelsApps.keys.retainAll(configs.map { it.packageName }.toSet())
        configs.forEach { config ->
            reelsApps[config.packageName] = config
        }
        Log.i(TAG, "Updated reels configs: ${reelsApps.keys}")
    }

    /**
     * Check if a package is a monitored reels app.
     */
    fun isReelsApp(packageName: String): Boolean {
        return reelsApps.containsKey(packageName)
    }

    /**
     * Detect if the user is currently in a reels/shorts section.
     *
     * @param event The accessibility event
     * @param rootNode The root node of the active window
     * @param packageName The app's package name
     * @return Detection result with app name and whether reels are detected
     */
    fun detectReels(
        event: AccessibilityEvent,
        rootNode: AccessibilityNodeInfo?,
        packageName: String
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

        val isInReels = checkForReelsNodes(rootNode, packageName, config.detectionNodes)

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
     */
    private fun checkForReelsNodes(
        rootNode: AccessibilityNodeInfo,
        packageName: String,
        detectionNodes: List<String>
    ): Boolean {

        for (nodeId in detectionNodes) {
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
        return scanNodeTreeForReelsHints(rootNode, packageName)
    }

    /**
     * Fallback detection: use findAccessibilityNodeInfosByText to search the
     * entire node tree for reels keywords. This is much more reliable than
     * manual traversal since it searches all depths and checks both text
     * and contentDescription.
     */
    private fun scanNodeTreeForReelsHints(node: AccessibilityNodeInfo?, packageName: String): Boolean {
        if (node == null) return false

        try {
            for (keyword in REELS_KEYWORDS) {
                val matches = node.findAccessibilityNodeInfosByText(keyword)
                if (matches.isNullOrEmpty()) continue

                var found = false
                for (match in matches) {
                    if (!found && match.isVisibleToUser) {
                        // For Facebook, these keywords are often landing page entry points.
                        // We block the landing page if these keywords are present.
                        val isFacebookLanding = (keyword == "Watch" || keyword == "Video home") && 
                                                packageName.contains("com.facebook.")
                        
                        if (isFacebookLanding) {
                            Log.d(TAG, "Facebook Video Landing detected via keyword: $keyword")
                            found = true
                        } else {
                            // General swiping logic: check for scrollable ancestor
                            found = hasScrollableReelsAncestor(match, packageName)
                            if (found) Log.d(TAG, "Reels detected in $packageName via keyword: $keyword")
                        }
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
     * Walk up to 5 ancestors looking for a scrollable ViewPager or RecyclerView.
     */
    private fun hasScrollableReelsAncestor(node: AccessibilityNodeInfo, packageName: String): Boolean {
        var current = node.parent ?: return false
        for (i in 0 until 10) {
            val className = current.className?.toString() ?: ""
            // Only match ViewPager - the swipeable video container used by
            // reels/shorts feeds. RecyclerView is too broad for Instagram,
            // but Facebook often uses RecyclerView for its reels.
            val isViewPager = className.contains("ViewPager")
            val isFacebookRecycler = packageName.contains("com.facebook.") && className.contains("RecyclerView")
            
            if ((isViewPager || isFacebookRecycler) && current.isScrollable) {
                current.recycle()
                return true
            }

            val next = current.parent
            current.recycle()
            current = next ?: return false
        }
        current.recycle()
        return false
    }

    /**
     * Reset detection state (e.g., when user navigates away from a reels app).
     */
    fun resetState(packageName: String) {
        lastDetectionState.remove(packageName)
    }

    data class DetectionResult(
        val appName: String,
        val packageName: String,
        val isInReels: Boolean
    )

    companion object {
        private const val TAG = "ReelsDetector"

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
