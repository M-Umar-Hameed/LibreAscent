package expo.modules.freedomaccessibility

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * SettingsProtector — Implements "Hardcore Mode" (Lockdown).
 *
 * Monitors the System Settings app to prevent:
 * 1. Uninstalling the Freedom app
 * 2. Deactivating the Freedom Device Admin receiver
 * 3. Disabling the Freedom Accessibility Service
 *
 * Uses manual node tree traversal instead of findAccessibilityNodeInfosByText,
 * because Compose-based Settings (SpaActivity on Android 14+) doesn't support
 * findAccessibilityNodeInfosByText properly.
 */
class SettingsProtector {

    private var isHardcoreModeEnabled = false
    private var myPackageName: String = ""

    // Track when we're on a device admin page so we can re-check on
    // content-changed events (the text isn't available on the initial
    // window-state-changed event).
    private var onDeviceAdminPage = false

    companion object {
        private const val TAG = "SettingsProtector"
        private const val MAX_DEPTH = 75

        private val APP_INFO_TRIGGERS = listOf(
            "uninstall",
            "force stop",
            "clear data"
        )

        private val DEVICE_ADMIN_TRIGGERS = listOf(
            "deactivate this device admin app",
            "deactivate this device admin",
            "remove device admin",
            "disable device admin"
        )

        private val ACCESSIBILITY_TRIGGERS = listOf(
            "stop freedom",
            "turn off freedom",
            "use freedom",
            "shortcut",
            "off"
        )

        private val SETTINGS_PKGS = listOf(
            "settings", "manageapp", "applications", "com.google.android.settings"
        )
    }

    fun updateConfig(enabled: Boolean, packageName: String) {
        this.isHardcoreModeEnabled = enabled
        this.myPackageName = packageName
        Log.d(TAG, "Config updated: enabled=$enabled, pkg=$packageName")
    }

    /**
     * Check for sensitive activity by class name.
     * Called on TYPE_WINDOW_STATE_CHANGED.
     */
    fun checkActivityClass(service: AccessibilityService, event: AccessibilityEvent): Boolean {
        val className = event.className?.toString()?.lowercase() ?: return false

        if (className.contains("deviceadmin") || className.contains("appinfo")) {
            Log.d(TAG, "Detected sensitive activity: $className (hardcoreEnabled=$isHardcoreModeEnabled)")
        }

        if (!isHardcoreModeEnabled) {
            onDeviceAdminPage = false
            return false
        }

        // Track device admin pages — can't block here because the activity
        // class is the same for ALL apps. Text content needed to verify
        // it's Freedom's page, but it hasn't rendered yet at this point.
        if (className.contains("deviceadminadd") ||
            className.contains("deviceadminremove") ||
            className.contains("deviceadminsettings")) {
            onDeviceAdminPage = true
            Log.d(TAG, "Entered Device Admin page, will check content for Freedom")
            return false
        }

        // Left the device admin page
        if (onDeviceAdminPage && !className.contains("deviceadmin")) {
            onDeviceAdminPage = false
        }

        return false
    }

    fun checkSettingsScreen(service: AccessibilityService, event: AccessibilityEvent, rootNode: AccessibilityNodeInfo?) {
        if (!isHardcoreModeEnabled || rootNode == null) return

        val pkg = event.packageName?.toString()?.lowercase() ?: ""

        // --- Handle package installer apps (uninstall confirmation dialogs) ---
        if (pkg.contains("packageinstaller") || pkg.contains("installer")) {
            val allText = collectAllText(rootNode)
            if (containsFreedom(allText)) {
                Log.w(TAG, "Protection: Package installer for Freedom! Navigating back.")
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            }
            return
        }

        // --- Handle Settings app ---
        if (!SETTINGS_PKGS.any { pkg.contains(it) }) return

        val allText = collectAllText(rootNode)

        // Device Admin page: re-check on every event until content loads
        if (onDeviceAdminPage) {
            if (containsFreedom(allText)) {
                Log.w(TAG, "Protection: Device Admin deactivation for Freedom! Navigating back.")
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                onDeviceAdminPage = false
                return
            }
            // Content might not have loaded yet — keep checking on next event
            return
        }

        val freedomFound = containsFreedom(allText)
        if (!freedomFound) return

        // App Info danger actions for Freedom
        if (containsAny(allText, APP_INFO_TRIGGERS)) {
            Log.w(TAG, "Protection: App Info danger action for Freedom! Navigating back.")
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            return
        }

        // Accessibility settings for Freedom
        if (containsAny(allText, ACCESSIBILITY_TRIGGERS)) {
            Log.w(TAG, "Protection: Accessibility settings action for Freedom! Navigating back.")
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            return
        }
    }

    private fun collectAllText(node: AccessibilityNodeInfo, depth: Int = 0): List<String> {
        if (depth > MAX_DEPTH) return emptyList()

        val texts = mutableListOf<String>()

        val text = node.text?.toString()
        if (!text.isNullOrEmpty()) {
            texts.add(text)
        }
        val desc = node.contentDescription?.toString()
        if (!desc.isNullOrEmpty()) {
            texts.add(desc)
        }

        for (i in 0 until node.childCount) {
            try {
                val child = node.getChild(i) ?: continue
                texts.addAll(collectAllText(child, depth + 1))
            } catch (_: Exception) {}
        }

        return texts
    }

    private fun containsFreedom(texts: List<String>): Boolean {
        if (texts.any { it == "com.freedom.app" || it == "com.toukadebo.freedom" || it == myPackageName }) return true

        return texts.any { text ->
            val words = text.trim().split(Regex("\\s+"))
            words.any { it.equals("Freedom", ignoreCase = true) }
        }
    }

    private fun containsAny(texts: List<String>, triggers: List<String>): Boolean {
        return triggers.any { trigger ->
            texts.any { it.lowercase().contains(trigger.lowercase()) }
        }
    }
}
