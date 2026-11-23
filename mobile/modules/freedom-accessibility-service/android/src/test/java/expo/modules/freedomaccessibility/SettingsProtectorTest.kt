package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SettingsProtectorTest {
    @Test
    fun networkVpnPageForLibreAscentIsNotBlockedByGenericOffText() {
        val protector = SettingsProtector()
        val texts = listOf("Network & internet", "VPN", "LibreAscent", "Off")

        assertFalse(protector.shouldBlockSettingsTextsForTest(texts))
    }

    @Test
    fun fullDeviceAccessCardForLibreAscentIsBlockedButOtherAppsAreNot() {
        val protector = SettingsProtector()

        assertTrue(
            protector.shouldBlockSettingsTextsForTest(
                listOf("Review app with full device access", "LibreAscent Content Protection", "Remove access")
            )
        )
        assertFalse(
            protector.shouldBlockSettingsTextsForTest(
                listOf("Review app with full device access", "Some Other App", "Remove access")
            )
        )
    }

    @Test
    fun multipleUsersScreenIsBlockedButOtherSettingsScreensAreNot() {
        assertTrue(SettingsProtector.isUserSettingsScreen("com.android.settings.Settings\$UserSettingsActivity"))
        assertFalse(SettingsProtector.isUserSettingsScreen("com.android.settings.Settings\$UserDictionarySettingsActivity"))
        assertFalse(SettingsProtector.isUserSettingsScreen("com.android.settings.Settings\$SystemDashboardActivity"))
    }

    @Test
    fun usersPageIsBlockedByItsTextButTheSystemListRowIsNot() {
        assertTrue(SettingsProtector.isUsersPage(listOf("Share your phone by adding new users. Each user has a personal space", "Add user")))
        assertTrue(SettingsProtector.isUsersPage(listOf("Users", "Allow user switch", "Guest")))
        assertFalse(SettingsProtector.isUsersPage(listOf("Gestures", "Date & time", "Users", "Signed in as Umar Bin")))
    }

    @Test
    fun intrusionDetectionScreenIsBlockedButAdvancedProtectionAndOtherGoogleScreensAreNot() {
        assertTrue(
            SettingsProtector.isIntrusionDetectionScreen(
                "com.google.android.gms",
                ".intrusiondetection.ui.intrusiondetectionsettingsactivity"
            )
        )
        assertFalse(
            SettingsProtector.isIntrusionDetectionScreen(
                "com.google.android.gms",
                ".advancedprotection.ui.advancedprotectionsettingsactivity"
            )
        )
        assertFalse(SettingsProtector.isIntrusionDetectionScreen("com.google.android.gms", ".auth.uiflows.consent.consentactivity"))
        assertFalse(SettingsProtector.isIntrusionDetectionScreen("com.example.app", ".intrusiondetectionactivity"))
    }

    @Test
    fun deviceAdminListAndDeactivateScreenForLibreAscentAreBlocked() {
        val protector = SettingsProtector()

        assertTrue(
            protector.shouldBlockSettingsTextsForTest(
                listOf("Device admin", "Navigate up", "Find Hub", "LibreAscent Content Protection")
            )
        )
        assertTrue(
            protector.shouldBlockSettingsTextsForTest(
                listOf("LibreAscent Content Protection", "Deactivate this device admin app")
            )
        )
    }

    @Test
    fun deviceAdminScreensForOtherAppsAndTheSpecialAccessEntryAreNotBlocked() {
        val protector = SettingsProtector()

        assertFalse(
            protector.shouldBlockSettingsTextsForTest(
                listOf("Device admin", "Navigate up", "Find Hub", "Authenticator")
            )
        )
        assertFalse(
            protector.shouldBlockSettingsTextsForTest(
                listOf("Special app access", "Device admin apps", "1 active app")
            )
        )
        assertFalse(
            protector.shouldBlockSettingsTextsForTest(
                listOf("LibreAscent Content Protection", "Activate this device admin app")
            )
        )
    }

    @Test
    fun onlyTheActivateButtonIsClickedNeverDeactivate() {
        assertTrue(SettingsProtector.isActivateButtonText("Activate this device admin app"))
        assertTrue(SettingsProtector.isActivateButtonText("  Activate "))
        assertFalse(SettingsProtector.isActivateButtonText("Deactivate this device admin app"))
        assertFalse(SettingsProtector.isActivateButtonText("Cancel"))
    }

    @Test
    fun accessibilityPageForLibreAscentIsBlockedWhenTurnOffIsVisible() {
        val protector = SettingsProtector()
        val texts = listOf("Accessibility", "LibreAscent", "Turn off LibreAscent")

        assertTrue(protector.shouldBlockSettingsTextsForTest(texts))
    }
}
