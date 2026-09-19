package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReelsDetectorTest {

    private fun config(pkg: String, vararg nodes: String) =
        ReelsDetector.ReelsAppConfig(name = pkg, packageName = pkg, detectionNodes = nodes.toList())

    @Test
    fun configsSurviveASerializeParseRoundTrip() {
        // Android destroys the accessibility service on every app update, so a
        // memory-only config list means reels blocking silently stops until JS
        // happens to push again.
        val configs = listOf(
            config("com.instagram.android", "clips_viewer_view_pager", "reels_tray"),
            config("com.google.android.youtube", "reel_recycler"),
        )

        val restored = ReelsDetector.parseConfigs(ReelsDetector.serializeConfigs(configs))

        assertEquals(2, restored.size)
        assertEquals("com.instagram.android", restored[0].packageName)
        assertEquals(listOf("clips_viewer_view_pager", "reels_tray"), restored[0].detectionNodes)
        assertEquals(listOf("reel_recycler"), restored[1].detectionNodes)
    }

    @Test
    fun configsWithNoDetectionNodesRoundTrip() {
        val restored = ReelsDetector.parseConfigs(ReelsDetector.serializeConfigs(listOf(config("com.x.app"))))

        assertEquals(1, restored.size)
        assertTrue(restored[0].detectionNodes.isEmpty())
    }

    @Test
    fun malformedStoredDataYieldsNothingInsteadOfThrowing() {
        // This parse runs inside onServiceConnected; throwing there would take
        // down the whole accessibility layer, not just reels detection.
        assertTrue(ReelsDetector.parseConfigs(null).isEmpty())
        assertTrue(ReelsDetector.parseConfigs("").isEmpty())
        assertTrue(ReelsDetector.parseConfigs("not json").isEmpty())
        assertTrue(ReelsDetector.parseConfigs("[{}]").isEmpty())
    }
}
