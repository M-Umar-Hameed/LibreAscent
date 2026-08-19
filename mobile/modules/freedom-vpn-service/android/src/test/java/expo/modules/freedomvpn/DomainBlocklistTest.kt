package expo.modules.freedomvpn

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DomainBlocklistTest {

    /** Reference implementation of the matching rules this class must preserve. */
    private fun referenceBlocked(
        domain: String,
        blocked: Set<String>,
        categories: List<Set<String>>,
        whitelisted: Set<String>
    ): Boolean {
        fun matches(set: Set<String>): Boolean {
            if (set.contains(domain)) return true
            var current = domain
            while (true) {
                val dotIndex = current.indexOf('.')
                if (dotIndex < 0 || dotIndex == current.length - 1) break
                current = current.substring(dotIndex + 1)
                if (set.contains(current)) return true
            }
            return false
        }
        if (matches(whitelisted)) return false
        if (matches(blocked)) return true
        return categories.any { matches(it) }
    }

    @Test
    fun matchingAgreesWithReferenceImplementation() {
        val blocked = setOf("example.com")
        val adult = setOf("bad.org", "deep.nested.tracker.net")
        val whitelisted = setOf("ok.example.com")

        val list = DomainBlocklist()
        list.setDomains(blocked)
        list.addCategory("adult", adult, replace = true)
        list.setWhitelist(whitelisted)

        val probes = listOf(
            "example.com",              // exact
            "sub.example.com",          // subdomain
            "a.b.c.example.com",        // deep subdomain
            "notexample.com",           // suffix string, not a subdomain
            "myexample.com",
            "example.com.evil.net",     // blocked string as a prefix label
            "ok.example.com",           // whitelisted exactly
            "deeper.ok.example.com",    // whitelisted parent wins over blocklist
            "bad.org",                  // category exact
            "x.bad.org",                // category subdomain
            "notbad.org",
            "deep.nested.tracker.net",
            "tracker.net",              // parent of a category entry, not blocked
            "unrelated.io"
        )

        for (probe in probes) {
            assertEquals(
                referenceBlocked(probe, blocked, listOf(adult), whitelisted),
                list.isBlocked(probe),
                "mismatch for $probe"
            )
        }
    }

    @Test
    fun suffixBoundariesAreRespected() {
        val list = DomainBlocklist()
        list.setDomains(listOf("example.com"))

        assertTrue(list.isBlocked("example.com"))
        assertTrue(list.isBlocked("sub.example.com"))
        assertTrue(list.isBlocked("a.b.example.com"))
        assertFalse(list.isBlocked("notexample.com"))
        assertFalse(list.isBlocked("example.com.evil.net"))
        assertFalse(list.isBlocked("com"))
    }

    @Test
    fun replacingACategoryDropsItsOldEntries() {
        val list = DomainBlocklist()
        list.addCategory("adult", listOf("old.com"), replace = true)
        assertTrue(list.isBlocked("sub.old.com"))

        list.addCategory("adult", listOf("new.com"), replace = true)
        assertFalse(list.isBlocked("old.com"))
        assertFalse(list.isBlocked("sub.old.com"))
        assertTrue(list.isBlocked("sub.new.com"))
    }

    @Test
    fun batchedAppendKeepsEveryBatch() {
        val list = DomainBlocklist()
        list.addCategory("adult", listOf("first.com"), replace = true)
        list.addCategory("adult", listOf("second.com"), replace = false)
        list.addCategory("adult", listOf("third.com"), replace = false)

        assertTrue(list.isBlocked("first.com"))
        assertTrue(list.isBlocked("a.second.com"))
        assertTrue(list.isBlocked("third.com"))
    }

    @Test
    fun repeatedSyncsDoNotGrowTheResidentSet() {
        val list = DomainBlocklist()
        repeat(5) {
            list.addCategory("adult", listOf("a.com", "b.com"), replace = true)
            list.addCategory("adult", listOf("c.com"), replace = false)
        }
        assertEquals(3, list.size())
    }

    @Test
    fun sizeTracksReplacementAndClearing() {
        val list = DomainBlocklist()
        list.setDomains(listOf("one.com", "two.com"))
        list.addCategory("adult", listOf("three.com"), replace = true)
        assertEquals(3, list.size())

        list.removeCategory("adult")
        assertEquals(2, list.size())

        list.clear()
        assertEquals(0, list.size())
        assertFalse(list.isBlocked("one.com"))
    }

    @Test
    fun normalizationIsUnchanged() {
        val list = DomainBlocklist()
        list.setDomains(listOf("# comment", "0.0.0.0 hosts.com", "HTTPS://WWW.Mixed.COM/path", "nodot"))

        assertTrue(list.isBlocked("hosts.com"))
        assertTrue(list.isBlocked("mixed.com"))
        assertTrue(list.isBlocked("www.mixed.com."))
        assertEquals(2, list.size())
    }
}
