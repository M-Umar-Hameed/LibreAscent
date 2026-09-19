package expo.modules.freedomvpn

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HashedDomainSetTest {

    @Test
    fun everyAddedDomainIsFound() {
        // The failure that matters is a false negative: a blocked domain that
        // stops being blocked. Load enough to force several grows.
        val set = HashedDomainSet()
        val domains = (0 until 50_000).map { "domain$it.example.com" }
        set.addAll(domains)

        assertEquals(50_000, set.size)
        domains.forEach { assertTrue(set.contains(it), "missing $it") }
    }

    @Test
    fun unrelatedDomainsAreNotFound() {
        val set = HashedDomainSet()
        set.addAll((0 until 20_000).map { "blocked$it.com" })

        for (i in 0 until 20_000) {
            assertFalse(set.contains("allowed$i.com"), "false positive on allowed$i.com")
        }
    }

    @Test
    fun duplicatesAreCountedOnce() {
        val set = HashedDomainSet()
        set.addAll(listOf("example.com", "example.com", "other.com"))

        assertEquals(2, set.size)
        assertTrue(set.contains("example.com"))
    }

    @Test
    fun emptyStringsAreIgnored() {
        // normalize() returns "" for entries it rejects, and those must not
        // occupy a slot or ever match.
        val set = HashedDomainSet()
        set.add("")

        assertEquals(0, set.size)
        assertFalse(set.contains(""))
    }

    @Test
    fun survivesManyGrowsFromATinyStart() {
        // Growth rehashes from stored hashes rather than the original strings,
        // so a bug there silently drops domains.
        val set = HashedDomainSet(initialCapacity = 1)
        val domains = (0 until 5_000).map { "grow$it.net" }
        set.addAll(domains)

        assertEquals(5_000, set.size)
        domains.forEach { assertTrue(set.contains(it), "lost $it across grow") }
    }

    @Test
    fun hashIsNeverTheEmptySentinel() {
        // A domain hashing to 0 would read as an empty slot and end every probe
        // that walks over it, hiding whatever sits past it.
        assertTrue(HashedDomainSet.hash("example.com") != 0L)
        assertTrue(HashedDomainSet.hash("") != 0L)
    }
}
