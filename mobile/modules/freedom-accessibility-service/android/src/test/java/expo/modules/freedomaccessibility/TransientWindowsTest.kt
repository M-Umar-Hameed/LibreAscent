package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TransientWindowsTest {

    private val imes = setOf("com.google.android.inputmethod.latin", "com.samsung.android.honeyboard")

    @Test
    fun keyboardsAndSystemUiAreTransient() {
        // A keyboard opening over Reddit must not make a scan of Reddit look stale.
        assertTrue(TransientWindows.isTransient("com.google.android.inputmethod.latin", imes))
        assertTrue(TransientWindows.isTransient("com.samsung.android.honeyboard", imes))
        assertTrue(TransientWindows.isTransient("com.android.systemui", imes))
        assertTrue(TransientWindows.isTransient("com.android.systemui", emptySet()))
    }

    @Test
    fun appsAndLaunchersAreNot() {
        // Switching to a launcher or another app must still drop a stale result.
        assertFalse(TransientWindows.isTransient("com.reddit.frontpage", imes))
        assertFalse(TransientWindows.isTransient("com.google.android.apps.nexuslauncher", imes))
        assertFalse(TransientWindows.isTransient("com.google.android.inputmethod.latin", emptySet()))
    }

    private val own = "com.libreascent"

    @Test
    fun emptyForegroundIsSeededFromAnApp() {
        // Service connects while Instagram is already in front: no window-state
        // change may follow, so the probe or the first event must seed it.
        assertEquals("com.instagram.android", TransientWindows.seed("", "com.instagram.android", own, imes))
    }

    @Test
    fun seedingSkipsUnknownOwnAndTransientPackages() {
        assertEquals("", TransientWindows.seed("", null, own, imes))
        assertEquals("", TransientWindows.seed("", "", own, imes))
        assertEquals("", TransientWindows.seed("", own, own, imes))
        assertEquals("", TransientWindows.seed("", "com.android.systemui", own, imes))
        assertEquals("", TransientWindows.seed("", "com.google.android.inputmethod.latin", own, imes))
    }

    @Test
    fun seedingNeverOverridesAKnownForegroundApp() {
        // Once set, only window-state changes move it; a stray content event
        // from a background window must not.
        assertEquals("com.reddit.frontpage", TransientWindows.seed("com.reddit.frontpage", "com.whatsapp", own, imes))
    }
}
