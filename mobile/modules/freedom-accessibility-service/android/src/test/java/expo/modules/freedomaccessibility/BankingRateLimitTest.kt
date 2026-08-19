package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertEquals

class BankingRateLimitTest {
    private val window = BankingModeManager.ATTEMPT_WINDOW_MS

    @Test
    fun allowsUpToLimitThenBlocks() {
        val now = 1_000_000L
        assertEquals(3, BankingModeManager.attemptsRemainingFor(emptyList(), now))
        assertEquals(0L, BankingModeManager.cooldownRemainingMsFor(emptyList(), now))

        val two = listOf(now, now)
        assertEquals(1, BankingModeManager.attemptsRemainingFor(two, now))
        assertEquals(0L, BankingModeManager.cooldownRemainingMsFor(two, now))

        val three = listOf(now, now, now)
        assertEquals(0, BankingModeManager.attemptsRemainingFor(three, now))
        assertEquals(window, BankingModeManager.cooldownRemainingMsFor(three, now))
    }

    @Test
    fun attemptsAgeOutOfWindow() {
        val now = 5_000_000L
        val old = listOf(now - window - 1, now - window - 1, now - window - 1)
        assertEquals(3, BankingModeManager.attemptsRemainingFor(old, now))
        assertEquals(0L, BankingModeManager.cooldownRemainingMsFor(old, now))
    }

    @Test
    fun cooldownCountsFromOldestAttempt() {
        val now = 5_000_000L
        val times = listOf(now - 600_000L, now - 300_000L, now) // 3 in-window, oldest 10 min ago
        assertEquals(window - 600_000L, BankingModeManager.cooldownRemainingMsFor(times, now))
    }
}
