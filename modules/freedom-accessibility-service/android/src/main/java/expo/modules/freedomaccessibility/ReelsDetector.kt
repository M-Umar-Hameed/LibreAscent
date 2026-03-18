package expo.modules.freedomaccessibility

import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Detects when users enter reels/shorts sections of social media apps.
 *
 * Detection strategy:
 * 1. Check if the foreground app is a monitored social media app
 * 2. Traverse the accessibility node tree looking for detection node IDs
 * 3. If a detection node is found → user is viewing reels
 *
 * This does NOT block the entire app — only the reels/shorts section.
 */
class ReelsDetector {

    data class ReelsAppConfig(
        val name: String,
        val packageName: String,
        val detectionNodes: List<String>
    )

    private val reelsApps = mutableMapOf<String, ReelsAppConfig>()
    private var lastDetectionState = mutableMapOf<String, Boolean>()

    /**
     * Update the list of monitored reels apps.
     */
    fun updateConfigs(configs: List<ReelsAppConfig>) {
        reelsApps.clear()
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
                    // Found a reels node — check if it's visible
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
                // Node search failed — continue checking other IDs
            }
        }

        // Fallback: check content descriptions and class names for reels keywords
        return scanNodeTreeForReelsHints(rootNode)
    }

    /**
     * Fallback detection: scan visible nodes for reels-related keywords.
     * This catches cases where resource IDs change across app updates.
     */
    private fun scanNodeTreeForReelsHints(node: AccessibilityNodeInfo?): Boolean {
        if (node == null) return false

        try {
            // Check this node's content description
            val contentDesc = node.contentDescription?.toString()?.lowercase() ?: ""
            if (REELS_KEYWORDS.any { contentDesc.contains(it) }) {
                // Verify it's a significant UI element (not just a small label)
                val className = node.className?.toString() ?: ""
                if (className.contains("ViewPager") ||
                    className.contains("RecyclerView") ||
                    className.contains("FrameLayout")) {
                    return true
                }
            }

            // Check children (limited depth to avoid performance issues)
            val childCount = node.childCount
            for (i in 0 until minOf(childCount, MAX_CHILD_SCAN)) {
                val child = node.getChild(i) ?: continue
                // Only scan 1 level deep for performance
                val childDesc = child.contentDescription?.toString()?.lowercase() ?: ""
                if (REELS_KEYWORDS.any { childDesc.contains(it) }) {
                    val className = child.className?.toString() ?: ""
                    child.recycle()
                    if (className.contains("ViewPager") ||
                        className.contains("RecyclerView")) {
                        return true
                    }
                } else {
                    child.recycle()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error scanning node tree: ${e.message}")
        }

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
        private const val MAX_CHILD_SCAN = 20

        // Fallback keywords for reels detection (lowercase)
        private val REELS_KEYWORDS = listOf(
            "shorts",
            "reels",
            "reel",
            "spotlight",
            "short video"
        )
    }
}
