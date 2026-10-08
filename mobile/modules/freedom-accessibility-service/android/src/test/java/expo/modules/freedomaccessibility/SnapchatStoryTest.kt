package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SnapchatStoryTest {
    @Test
    fun publicStoryBlocksOnlyOnceItHasSettled() {
        val detector = ReelsDetector()
        assertFalse(detector.snapchatPublicStorySettled(true, 1_000))
        assertFalse(detector.snapchatPublicStorySettled(true, 1_500))
        assertTrue(detector.snapchatPublicStorySettled(true, 1_800))
    }

    @Test
    fun aReplyBarArrivingInTimeKeepsAFriendsStoryOpen() {
        val detector = ReelsDetector()
        assertFalse(detector.snapchatPublicStorySettled(true, 1_000))
        assertFalse(detector.snapchatPublicStorySettled(false, 1_300))
        assertFalse(detector.snapchatPublicStorySettled(true, 2_000))
        assertTrue(detector.snapchatPublicStorySettled(true, 2_800))
    }
}
