package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ScanSlotTest {

    @Test
    fun idleSlotRunsTheFirstOfferAndGoesIdleWhenNothingIsPending() {
        val slot = ScanSlot<String>()

        assertTrue(slot.offer("a"))
        assertNull(slot.finish())
        // Idle again, so the next event starts straight away.
        assertTrue(slot.offer("b"))
    }

    @Test
    fun burstWhileInFlightCoalescesIntoTheNewestEvent() {
        val slot = ScanSlot<String>()
        slot.offer("a")

        assertFalse(slot.offer("b"))
        assertFalse(slot.offer("c"))
        assertFalse(slot.offer("d"))

        assertEquals("d", slot.finish())
        assertNull(slot.finish())
    }

    @Test
    fun slotStaysInFlightWhileItsPendingEventRuns() {
        // The pending event runs without the slot going idle, so an event
        // arriving during that run must queue rather than start a second scan.
        val slot = ScanSlot<String>()
        slot.offer("a")
        slot.offer("b")

        assertEquals("b", slot.finish())
        assertFalse(slot.offer("c"))
        assertEquals("c", slot.finish())
        assertNull(slot.finish())
    }

    @Test
    fun slotsAreIndependentSoOneKindCannotStarveAnother() {
        val reels = ScanSlot<String>()
        val browser = ScanSlot<String>()
        reels.offer("com.instagram.android")
        reels.offer("com.instagram.android")

        assertTrue(browser.offer("com.android.chrome"))
    }

    @Test
    fun rateLimitAllowsOneScanPerIntervalPerPackage() {
        val limit = PerKeyRateLimit(500)

        assertTrue(limit.tryAcquire("com.reddit.frontpage", 1_000))
        assertFalse(limit.tryAcquire("com.reddit.frontpage", 1_100))
        assertFalse(limit.tryAcquire("com.reddit.frontpage", 1_499))
        assertTrue(limit.tryAcquire("com.reddit.frontpage", 1_500))
    }

    @Test
    fun rateLimitIsPerPackage() {
        val limit = PerKeyRateLimit(500)

        assertTrue(limit.tryAcquire("com.reddit.frontpage", 1_000))
        assertTrue(limit.tryAcquire("com.twitter.android", 1_100))
    }

    @Test
    fun rejectedAttemptsDoNotExtendTheWindow() {
        // A steady stream of events must still get a scan every interval, not
        // be locked out for as long as the stream lasts.
        val limit = PerKeyRateLimit(500)
        limit.tryAcquire("com.reddit.frontpage", 0)
        for (t in 100L..400L step 100) limit.tryAcquire("com.reddit.frontpage", t)

        assertTrue(limit.tryAcquire("com.reddit.frontpage", 500))
    }
}
