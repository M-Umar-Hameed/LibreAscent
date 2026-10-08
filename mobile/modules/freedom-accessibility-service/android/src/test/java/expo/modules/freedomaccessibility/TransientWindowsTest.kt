package expo.modules.freedomaccessibility

import kotlin.test.Test
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
}
