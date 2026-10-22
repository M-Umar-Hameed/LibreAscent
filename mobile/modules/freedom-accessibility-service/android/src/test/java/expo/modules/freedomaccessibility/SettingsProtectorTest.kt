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
    fun advancedProtectionScreenIsBlockedButOtherGoogleScreensAreNot() {
        assertTrue(
            SettingsProtector.isAdvancedProtectionScreen(
                "com.google.android.gms",
                ".advancedprotection.ui.advancedprotectionsettingsactivity"
            )
        )
        assertFalse(SettingsProtector.isAdvancedProtectionScreen("com.google.android.gms", ".auth.uiflows.consent.consentactivity"))
        assertFalse(SettingsProtector.isAdvancedProtectionScreen("com.example.app", ".advancedprotectionactivity"))
    }

    @Test
    fun accessibilityPageForLibreAscentIsBlockedWhenTurnOffIsVisible() {
        val protector = SettingsProtector()
        val texts = listOf("Accessibility", "LibreAscent", "Turn off LibreAscent")

        assertTrue(protector.shouldBlockSettingsTextsForTest(texts))
    }
}
