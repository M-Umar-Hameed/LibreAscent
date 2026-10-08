package expo.modules.freedomforeground

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ProtectionCheckTest {

    private fun decide(
        wanted: Boolean = true,
        paused: Boolean = false,
        up: Boolean = true,
        alwaysOn: String? = null,
        a11y: Boolean = true,
        banking: Boolean = false
    ) = ProtectionCheck.decide(wanted, paused, up, alwaysOn, "com.me", a11y, banking)

    @Test
    fun healthyHasNoProblems() {
        assertEquals(emptyList(), decide())
        assertEquals(emptyList(), decide(alwaysOn = "com.me", wanted = false, up = false))
    }

    @Test
    fun tunnelDownOnlyCountsWhenWantedAndNotPaused() {
        assertEquals(listOf("vpn_down"), decide(up = false))
        assertEquals(emptyList(), decide(up = false, paused = true))
        assertEquals(emptyList(), decide(up = false, wanted = false))
    }

    @Test
    fun otherAlwaysOnVpnIsReportedWithPackage() {
        assertEquals(listOf("vpn_down", "vpn_taken:ch.protonvpn"), decide(up = false, alwaysOn = "ch.protonvpn"))
        assertEquals(emptyList(), decide(alwaysOn = ""))
    }

    @Test
    fun accessibilityMissingIsForgivenInsideBankingWindow() {
        assertEquals(listOf("accessibility_off"), decide(a11y = false))
        assertEquals(emptyList(), decide(a11y = false, banking = true))
    }

    @Test
    fun enabledListMatchingAndAppend() {
        val c = "com.me/expo.modules.freedomaccessibility.FreedomAccessibilityService"
        assertFalse(ProtectionCheck.listContains(null, c))
        assertFalse(ProtectionCheck.listContains("com.other/x.Svc", c))
        assertTrue(ProtectionCheck.listContains("com.other/x.Svc:$c", c))
        assertEquals(c, ProtectionCheck.listWith("", c))
        assertEquals("com.other/x.Svc:$c", ProtectionCheck.listWith("com.other/x.Svc", c))
    }
}
