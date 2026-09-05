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
        val whitelisted = setOf("ok.example.com", "safe.bad.org")

        val list = DomainBlocklist()
        list.setDomains(blocked)
        list.addCategory("adult", adult, replace = true)
        list.setWhitelist(whitelisted)

        // (query as the caller passes it, same query as normalize() renders it).
        // normalize() is untouched by this change, so the oracle only has to model
        // the matching half; the pairs differ only where normalization does work.
        val probes = listOf(
            "example.com" to "example.com",                   // exact
            "sub.example.com" to "sub.example.com",           // subdomain
            "a.b.c.example.com" to "a.b.c.example.com",       // deep subdomain
            "notexample.com" to "notexample.com",             // suffix string, not a subdomain
            "myexample.com" to "myexample.com",
            "example.com.evil.net" to "example.com.evil.net", // blocked string as a prefix label
            "ok.example.com" to "ok.example.com",             // whitelisted exactly
            "deeper.ok.example.com" to "deeper.ok.example.com", // whitelisted parent beats blocklist
            "safe.bad.org" to "safe.bad.org",                 // whitelist beats a category entry
            "under.safe.bad.org" to "under.safe.bad.org",     // whitelisted parent beats a category
            "bad.org" to "bad.org",                           // category exact
            "x.bad.org" to "x.bad.org",                       // category subdomain
            "notbad.org" to "notbad.org",
            "deep.nested.tracker.net" to "deep.nested.tracker.net",
            "tracker.net" to "tracker.net",                   // parent of a category entry, not blocked
            "unrelated.io" to "unrelated.io",
            "" to "",                                         // empty query
            "   " to "",                                      // blank query
            ".example.com" to ".example.com",                 // leading dot
            "SUB.EXAMPLE.COM" to "sub.example.com",           // query-side case folding
            "WWW.Example.COM." to "example.com",              // www + trailing dot + case
            "sub.example.com:443" to "sub.example.com",       // port
            "https://x.bad.org/path" to "x.bad.org"           // scheme + path
        )

        for ((query, normalized) in probes) {
            assertEquals(
                referenceBlocked(normalized, blocked, listOf(adult), whitelisted),
                list.isBlocked(query),
                "mismatch for '$query'"
            )
        }
    }

    @Test
    fun dohBootstrapHostsAreBlockedEvenWhenWhitelisted() {
        val list = DomainBlocklist()
        for (host in DomainBlocklist.DOH_BOOTSTRAP_HOSTS) {
            assertTrue(list.isBlocked(host), "$host must be blocked out of the box")
            assertTrue(list.isBlocked("edge.$host"), "subdomains of $host must be blocked too")
        }
        // Firefox's default endpoint, the one that reopened the bypass on desktop.
        assertTrue(list.isBlocked("mozilla.cloudflare-dns.com"))
        // Whitelisting must not reopen the bypass.
        list.setWhitelist(setOf("cloudflare-dns.com", "dns.google"))
        assertTrue(list.isBlocked("chrome.cloudflare-dns.com"), "whitelist cannot override the DoH block")
        assertTrue(list.isBlocked("dns.google"), "whitelist cannot override the DoH block")
        // Unrelated names are untouched.
        assertFalse(list.isBlocked("example.com"))
        assertFalse(list.isBlocked("cloudflare.com"), "the CDN itself is not a DoH endpoint")
    }

    @Test
    fun bareTldEntriesCannotEnterAnyList() {
        // normalize() drops anything without a dot, so a bare TLD can never be
        // stored and the top-level probe in the parent chain can never match.
        val list = DomainBlocklist()
        list.setDomains(listOf("com"))
        list.addCategory("adult", listOf("org"), replace = true)

        assertEquals(0, list.size())
        assertFalse(list.isBlocked("anything.com"))
        assertFalse(list.isBlocked("anything.org"))
    }

    @Test
    fun appendingToAnUnknownCategoryCreatesIt() {
        val list = DomainBlocklist()
        list.addCategory("adult", listOf("late.com"), replace = false)

        assertTrue(list.isBlocked("sub.late.com"))
        assertEquals(1, list.size())
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
