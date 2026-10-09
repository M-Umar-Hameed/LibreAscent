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

        assertEquals(true to null, slot.offer("a"))
        assertNull(slot.finish())
        // Idle again, so the next event starts straight away.
        assertTrue(slot.offer("b").first)
    }

    @Test
    fun burstWhileInFlightCoalescesIntoTheNewestEvent() {
        val slot = ScanSlot<String>()
        slot.offer("a")

        assertFalse(slot.offer("b").first)
        assertFalse(slot.offer("c").first)
        assertFalse(slot.offer("d").first)

        assertEquals("d", slot.finish())
        assertNull(slot.finish())
    }

    @Test
    fun everyDisplacedPendingItemIsHandedBackExactlyOnce() {
        // Browser items carry event copies that must be recycled; one dropped
        // silently leaks, one handed back twice is recycled twice.
        val slot = ScanSlot<String>()
        val displaced = mutableListOf<String>()
        for (item in listOf("a", "b", "c", "d")) slot.offer(item).second?.let { displaced.add(it) }

        assertEquals(listOf("b", "c"), displaced)
        assertEquals("d", slot.finish())
    }

    @Test
    fun slotStaysInFlightWhileItsPendingEventRuns() {
        // The pending event runs without the slot going idle, so an event
        // arriving during that run must queue rather than start a second scan.
        val slot = ScanSlot<String>()
        slot.offer("a")
        slot.offer("b")

        assertEquals("b", slot.finish())
        assertFalse(slot.offer("c").first)
        assertEquals("c", slot.finish())
        assertNull(slot.finish())
    }

    @Test
    fun slotsAreIndependentSoOneKindCannotStarveAnother() {
        val reels = ScanSlot<String>()
        val browser = ScanSlot<String>()
        reels.offer("com.instagram.android")
        reels.offer("com.instagram.android")

        assertTrue(browser.offer("com.android.chrome").first)
    }

    @Test
    fun rateLimitAllowsOneScanPerIntervalPerPackageAndSaysWhenTheNextIsDue() {
        val limit = PerKeyRateLimit(500)

        assertEquals(0, limit.acquire("com.reddit.frontpage", 1_000))
        assertEquals(400, limit.acquire("com.reddit.frontpage", 1_100))
        assertEquals(1, limit.acquire("com.reddit.frontpage", 1_499))
        assertEquals(0, limit.acquire("com.reddit.frontpage", 1_500))
    }

    @Test
    fun rateLimitIsPerPackage() {
        val limit = PerKeyRateLimit(500)

        assertEquals(0, limit.acquire("com.reddit.frontpage", 1_000))
        assertEquals(0, limit.acquire("com.twitter.android", 1_100))
    }

    @Test
    fun rejectedAttemptsDoNotExtendTheWindow() {
        // A steady stream of events must still get a scan every interval, and
        // the trailing scan scheduled at now + wait must be the one that acquires.
        val limit = PerKeyRateLimit(500)
        limit.acquire("com.reddit.frontpage", 0)
        var wait = 0L
        for (t in 100L..400L step 100) wait = limit.acquire("com.reddit.frontpage", t)

        assertEquals(100, wait)
        assertEquals(0, limit.acquire("com.reddit.frontpage", 400 + wait))
    }
}
