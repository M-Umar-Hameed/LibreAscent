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

    @Volatile private var isHardcoreModeEnabled = false
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

        // Android's "Review app with full device access" card and list put a
        // Remove access button beside the app, which strips its accessibility access.
        private val REMOVE_ACCESS_TRIGGERS = listOf(
            "remove access"
        )

        // Firefox's add-ons screens name the extension beside its Remove and Disable
        // controls; the extension is how Firefox gets blocked, so it must stay.
        private const val BROWSER_EXTENSION_NAME = "libreascent mobile blocker"

        private val DEVICE_ADMIN_TRIGGERS = listOf(
            "deactivate this device admin app",
            "deactivate this device admin",
            "remove device admin",
            "disable device admin"
        )

        // Page titles of the Device admin list: "Device admin" here, "Device admin apps" elsewhere.
        private val DEVICE_ADMIN_TITLES = setOf("device admin", "device admin apps")

        // Only phrases that appear on LibreAscent's own accessibility detail
        // page (the toggle screen). Generic "off"/"shortcut" would match the
        // main Accessibility list, where every service shows an On/Off status,
        // and block the entire page instead of just LibreAscent's entry.
        private val ACCESSIBILITY_TRIGGERS = listOf(
            "stop libreascent",
            "turn off libreascent",
            "use libreascent"
        )

        private val ACCESSIBILITY_CONTEXT_TRIGGERS = listOf(
            "accessibility",
            "installed apps",
            "downloaded apps",
            "screen reader",
            "stop libreascent",
            "turn off libreascent",
            "use libreascent"
        )

        private val SETTINGS_PKGS = listOf(
            "settings", "manageapp", "applications", "com.google.android.settings"
        )

        // System > Multiple users: another profile is a way around the blocks.
        internal fun isUserSettingsScreen(className: String): Boolean =
            className.lowercase().contains("usersettingsactivity")

        // The Users page opened from System is a generic SubSettings screen, so it
        // is told apart by its own text, not its class.
        internal fun isUsersPage(texts: List<String>): Boolean =
            texts.any {
                val t = it.trim().lowercase()
                t.contains("adding new users") || t == "allow user switch"
            }

        internal fun isActivateButtonText(text: String): Boolean {
            val t = text.trim().lowercase()
            return t.startsWith("activate") && !t.contains("deactivate")
        }

        /**
         * Intrusion Detection lives in Google Play Services, not the Settings app.
         * The Advanced Protection screen is no longer blocked: the service declares
         * isAccessibilityTool, so Advanced Protection no longer shuts it down, and
         * its unknown-sources restriction needs the screen reachable to switch off.
         * [className] is lowercased.
         */
        internal fun isIntrusionDetectionScreen(packageName: String, className: String): Boolean =
            packageName.startsWith("com.google.android.") &&
                className.contains("intrusiondetection")
    }

    fun updateConfig(enabled: Boolean, packageName: String) {
        this.isHardcoreModeEnabled = enabled
        this.myPackageName = packageName
        Log.d(TAG, "Config updated: enabled=$enabled, pkg=$packageName")
    }

    fun isHardcoreEnabled(): Boolean = isHardcoreModeEnabled

    // Uptime until which the device admin activate page is let through and clicked.
    @Volatile private var adminActivationUntil = 0L

    fun allowAdminActivationFor(ms: Long) {
        adminActivationUntil = android.os.SystemClock.uptimeMillis() + ms
    }

    private fun adminActivationOpen(): Boolean =
        android.os.SystemClock.uptimeMillis() < adminActivationUntil

    private fun clickActivate(node: AccessibilityNodeInfo, depth: Int = 0): Boolean {
        if (depth > MAX_DEPTH) return false
        if (node.text?.toString()?.let(::isActivateButtonText) == true) {
            var target: AccessibilityNodeInfo? = node
            while (target != null && !target.isClickable) target = target.parent
            return target?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
        }
        for (i in 0 until node.childCount) {
            val child = try { node.getChild(i) } catch (_: Exception) { null } ?: continue
            if (clickActivate(child, depth + 1)) return true
        }
        return false
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

        if (isUserSettingsScreen(className)) {
            Log.w(TAG, "Protection: Multiple users screen. Navigating back.")
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            return true
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

    fun checkBrowserExtensionScreen(service: AccessibilityService, rootNode: AccessibilityNodeInfo?) {
        if (!isHardcoreModeEnabled || rootNode == null) return
        if (containsAny(collectAllText(rootNode), listOf(BROWSER_EXTENSION_NAME))) {
            Log.w(TAG, "Protection: browser extension screen for Freedom! Navigating back.")
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
        }
    }

    fun checkSettingsScreen(service: AccessibilityService, packageName: String, rootNode: AccessibilityNodeInfo?) {
        if (!isHardcoreModeEnabled || rootNode == null) return

        val pkg = packageName.lowercase()

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

        if (isUsersPage(allText)) {
            Log.w(TAG, "Protection: Users page. Navigating back.")
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            return
        }

        // Re-activation after the admin was switched off: the activate page must
        // stay up long enough to be clicked. A deactivate page never takes this branch.
        if (adminActivationOpen() && containsFreedom(allText) && !containsAny(allText, DEVICE_ADMIN_TRIGGERS)) {
            if (clickActivate(rootNode)) {
                Log.w(TAG, "Protection: Device Admin re-activated.")
                adminActivationUntil = 0L
            }
            return
        }

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

        if (containsAny(allText, REMOVE_ACCESS_TRIGGERS)) {
            Log.w(TAG, "Protection: Remove access action for Freedom! Navigating back.")
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            return
        }

        // The device admin class event arrives after the first content events, so
        // waiting on it leaves the Deactivate button tappable for a few hundred ms.
        if (shouldBlockDeviceAdmin(allText)) {
            Log.w(TAG, "Protection: Device Admin screen for Freedom! Navigating back.")
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            return
        }

        // Accessibility settings for Freedom. Keep this narrow: network/VPN
        // settings can show "LibreAscent" and "Off" without being tamper UI.
        if (shouldBlockAccessibilitySettings(allText)) {
            Log.w(TAG, "Protection: Accessibility settings action for Freedom! Navigating back.")
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            return
        }
    }

    internal fun shouldBlockSettingsTextsForTest(texts: List<String>): Boolean {
        return containsFreedom(texts) &&
            (containsAny(texts, APP_INFO_TRIGGERS) ||
                containsAny(texts, REMOVE_ACCESS_TRIGGERS) ||
                shouldBlockDeviceAdmin(texts) ||
                shouldBlockAccessibilitySettings(texts))
    }

    // The deactivate screen, or the Device admin list whose LibreAscent row leads to it.
    private fun shouldBlockDeviceAdmin(texts: List<String>): Boolean {
        return containsAny(texts, DEVICE_ADMIN_TRIGGERS) ||
            texts.any { it.trim().lowercase() in DEVICE_ADMIN_TITLES }
    }

    private fun shouldBlockAccessibilitySettings(texts: List<String>): Boolean {
        return containsFreedom(texts) &&
            containsAny(texts, ACCESSIBILITY_CONTEXT_TRIGGERS) &&
            containsAny(texts, ACCESSIBILITY_TRIGGERS)
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
        if (texts.any { it == "com.libreascent.app" || it == myPackageName }) return true

        return texts.any { text ->
            val words = text.trim().split(Regex("\\s+"))
            words.any { it.equals("LibreAscent", ignoreCase = true) }
        }
    }

    private fun containsAny(texts: List<String>, triggers: List<String>): Boolean {
        return triggers.any { trigger ->
            texts.any { it.lowercase().contains(trigger.lowercase()) }
        }
    }
}
