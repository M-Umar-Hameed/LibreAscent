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
    fun accessibilityPageForLibreAscentIsBlockedWhenTurnOffIsVisible() {
        val protector = SettingsProtector()
        val texts = listOf("Accessibility", "LibreAscent", "Turn off LibreAscent")

        assertTrue(protector.shouldBlockSettingsTextsForTest(texts))
    }
}
