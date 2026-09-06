package expo.modules.freedomvpn

import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BlocklistPersistenceTest {

    private val dir: File = Files.createTempDirectory("vpn-blocklist").toFile()

    @AfterTest
    fun cleanUp() {
        dir.deleteRecursively()
    }

    @Test
    fun aTunnelStartedWithNoJsBehindItStillBlocks() {
        // The failure this exists for: VpnWatchdog restarted the service after
        // an app update and the tunnel came up resolving every blocked domain,
        // because only JS ever filled the in-memory list.
        BlocklistPersistence.saveCategory(dir, "ads", listOf("doubleclick.net", "google-analytics.com"), true)

        val restarted = DomainBlocklist()
        BlocklistPersistence.load(dir, restarted)

        assertTrue(restarted.isBlocked("google-analytics.com"))
        assertTrue(restarted.isBlocked("ads.doubleclick.net"), "suffix matching survives the round trip")
        assertFalse(restarted.isBlocked("example.com"))
    }

    @Test
    fun everyBatchOfAStreamedCategorySurvives() {
        // Categories arrive in 10k batches with replace=true on the first only.
        // Truncating on the later ones would leave all but the last batch
        // unblocked, which looks identical to working.
        BlocklistPersistence.saveCategory(dir, "ads", listOf("first.example"), true)
        BlocklistPersistence.saveCategory(dir, "ads", listOf("second.example"), false)
        BlocklistPersistence.saveCategory(dir, "ads", listOf("third.example"), false)

        val restarted = DomainBlocklist()
        BlocklistPersistence.load(dir, restarted)

        assertTrue(restarted.isBlocked("first.example"), "the first batch must not be dropped")
        assertTrue(restarted.isBlocked("second.example"))
        assertTrue(restarted.isBlocked("third.example"))
        assertEquals(3, restarted.size())
    }

    @Test
    fun aResyncReplacesTheCategoryRatherThanGrowingIt() {
        BlocklistPersistence.saveCategory(dir, "ads", listOf("stale.example"), true)
        BlocklistPersistence.saveCategory(dir, "ads", listOf("fresh.example"), true)

        val restarted = DomainBlocklist()
        BlocklistPersistence.load(dir, restarted)

        assertFalse(restarted.isBlocked("stale.example"), "replace=true starts the file over")
        assertTrue(restarted.isBlocked("fresh.example"))
    }

    @Test
    fun theWhitelistIsRestoredAlongsideTheBlocklist() {
        // Restoring blocked domains without the whitelist would start blocking
        // sites the user had explicitly allowed.
        BlocklistPersistence.saveCategory(dir, "adult", listOf("example.com"), true)
        File(dir, "whitelist.txt").writeText("example.com\n")

        val restarted = DomainBlocklist()
        BlocklistPersistence.load(dir, restarted)

        assertFalse(restarted.isBlocked("example.com"), "whitelist wins, as it does in isBlocked")
    }

    @Test
    fun anEmptyStoreLoadsToAnEmptyList() {
        val restarted = DomainBlocklist()
        BlocklistPersistence.load(dir, restarted)
        assertEquals(0, restarted.size())
    }
}
