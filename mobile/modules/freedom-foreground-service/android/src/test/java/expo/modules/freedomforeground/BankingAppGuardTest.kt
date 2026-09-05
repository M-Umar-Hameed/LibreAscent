package expo.modules.freedomforeground

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BankingAppGuardTest {

    private fun app(pkg: String, surveillance: String) =
        """{"packageName":"$pkg","appName":"$pkg","surveillanceType":"$surveillance","surveillanceValue":0}"""

    @Test
    fun parsesOnlyOutrightBlockedPackages() {
        // Mirrors enforceForegroundIfBlocked: "none" is an outright block, while
        // timed and prompted types are the accessibility service's business.
        val json = "[${app("com.blocked.one", "none")}," +
            "${app("com.timed.app", "timer")}," +
            "${app("com.blocked.two", "none")}]"

        assertEquals(
            setOf("com.blocked.one", "com.blocked.two"),
            BankingAppGuard.parseBlockedPackages(json)
        )
    }

    @Test
    fun malformedStoreDoesNotThrow() {
        // A parse failure here must not take down the poll loop, which is the
        // only thing guarding the window.
        assertEquals(emptySet(), BankingAppGuard.parseBlockedPackages("not json"))
        assertEquals(emptySet(), BankingAppGuard.parseBlockedPackages(""))
        assertEquals(emptySet(), BankingAppGuard.parseBlockedPackages(null))
        assertEquals(emptySet(), BankingAppGuard.parseBlockedPackages("[{}]"))
    }

    @Test
    fun bankingWindowIsOpenOnlyUntilItsDeadline() {
        val now = 1_000_000L
        assertTrue(BankingAppGuard.isBankingActive(now + 1, now))
        assertFalse(BankingAppGuard.isBankingActive(now, now), "deadline itself is closed")
        assertFalse(BankingAppGuard.isBankingActive(now - 1, now))
        // 0 is the cleared/never-started state written by BankingModeManager.
        assertFalse(BankingAppGuard.isBankingActive(0L, now))
    }

    @Test
    fun pollsFasterWhileTheWindowIsOpen() {
        val active = BankingAppGuard.nextDelayMs(true)
        val idle = BankingAppGuard.nextDelayMs(false)
        assertTrue(active < idle, "an open window must be polled more often than idle")
        // Idle polling is a SharedPreferences read on a device that already
        // showed battery problems, so it must stay well clear of a busy loop.
        assertTrue(idle >= 5_000L, "idle polling must stay cheap")
    }
}
