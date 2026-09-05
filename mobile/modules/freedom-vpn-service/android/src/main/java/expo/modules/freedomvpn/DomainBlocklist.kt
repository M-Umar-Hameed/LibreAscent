package expo.modules.freedomvpn

import java.util.concurrent.ConcurrentHashMap

/**
 * Domain blocklist with O(1) lookup via HashSet.
 * Supports exact match and suffix matching (blocks subdomains).
 *
 * Thread-safe: the main blocklist and whitelist are immutable sets swapped
 * behind volatile references, and category sets are concurrent sets replaced
 * atomically in the map. Readers on the VPN packet processing thread always
 * observe either the previous or the next complete set.
 */
class DomainBlocklist {
    companion object {
        /**
         * Hostnames browsers use to reach a DoH resolver. The tunnel only routes
         * the plaintext resolver IPs, so a browser that upgrades to DoH escapes it
         * entirely: Chrome maps a 1.1.1.1 system resolver to
         * chrome.cloudflare-dns.com, which lives on a CDN range this tunnel never
         * sees. The upgrade needs that hostname resolved first, and that lookup
         * does come through here, so refusing it keeps the browser on plain DNS.
         * Browsers with hardcoded bootstrap IPs still escape; that is a known hole.
         * Mirrors DOH_BOOTSTRAP_HOSTS in desktop/shared/src/config.rs; keep in sync.
         */
        val DOH_BOOTSTRAP_HOSTS: Set<String> = setOf(
            "mozilla.cloudflare-dns.com",
            "chrome.cloudflare-dns.com",
            "cloudflare-dns.com",
            "one.one.one.one",
            "dns.google",
            "dns64.dns.google",
            "dns.quad9.net",
            "dns10.quad9.net",
            "dns11.quad9.net",
            "doh.opendns.com",
            "dns.adguard.com",
            "dns.adguard-dns.com",
            "doh.cleanbrowsing.org",
            "dns.nextdns.io",
            "doh.dns.sb",
            "doh.pub",
        )
    }


    // Main blocklist — stores normalized domains
    @Volatile
    private var blockedDomains: Set<String> = emptySet()

    // Per-category domain sets — for enabling/disabling categories at runtime
    private val categories = ConcurrentHashMap<String, MutableSet<String>>()

    // Whitelist — domains explicitly allowed (takes precedence over blocklist)
    @Volatile
    private var whitelist: Set<String> = emptySet()

    /**
     * Check if a domain should be blocked.
     *
     * Logic:
     * 1. If domain (or any parent) is in whitelist → NOT blocked
     * 2. If domain (or any parent) is in blocklist → BLOCKED
     * 3. Otherwise → NOT blocked
     *
     * Suffix matching: "sub.example.com" is blocked if "example.com" is in the list.
     */
    fun isBlocked(domain: String): Boolean {
        // ponytail: probes the per-category sets rather than one flat union. The
        // union would save ~20 cached-hash lookups per query but costs ~37 MB per
        // million domains and would have to be rebuilt on every removeCategory,
        // holding two full-size sets at once. Affordable once the module gains a
        // native end-of-sync signal (a finalizeCategorySync equivalent) so the
        // union can be built once per sync instead of once per batch.
        val normalized = normalize(domain)
        if (normalized.isEmpty()) return false

        val candidates = parentChain(normalized)

        // DoH bootstrap hostnames are blocked ahead of the whitelist on purpose:
        // a browser that can resolve its DoH endpoint resolves everything else
        // over HTTPS and never sends this proxy another query. Letting a user
        // whitelist one would reopen the bypass.
        if (matchesList(candidates, DOH_BOOTSTRAP_HOSTS)) return true

        // Check whitelist first (exact + suffix)
        if (matchesList(candidates, whitelist)) return false

        if (matchesList(candidates, blockedDomains)) return true

        for (categorySet in categories.values) {
            if (matchesList(candidates, categorySet)) return true
        }

        return false
    }

    /**
     * The domain followed by each of its parent domains.
     * Example: "sub.example.com" → ["sub.example.com", "example.com", "com"]
     */
    private fun parentChain(domain: String): List<String> {
        val chain = ArrayList<String>(4)
        chain.add(domain)

        var current = domain
        while (true) {
            val dotIndex = current.indexOf('.')
            if (dotIndex < 0 || dotIndex == current.length - 1) break
            current = current.substring(dotIndex + 1)
            chain.add(current)
        }

        return chain
    }

    /**
     * Check if the domain or any of its parent domains match the given set.
     */
    private fun matchesList(candidates: List<String>, domainSet: Set<String>): Boolean {
        for (candidate in candidates) {
            if (domainSet.contains(candidate)) return true
        }
        return false
    }

    /**
     * Replace the entire blocklist with a new set of domains.
     */
    fun setDomains(domains: Collection<String>) {
        blockedDomains = normalizedSet(domains)
    }

    /**
     * Add domains to the blocklist.
     */
    fun addDomains(domains: Collection<String>) {
        blockedDomains = blockedDomains + normalizedSet(domains)
    }

    /**
     * Add domains to a category.
     * When [replace] is true the category is reset to exactly these domains,
     * otherwise they are appended to whatever the category already holds.
     * Callers that stream a category in batches pass replace=true for the first
     * batch only.
     */
    fun addCategory(name: String, domains: Collection<String>, replace: Boolean) {
        val target = if (replace) {
            ConcurrentHashMap.newKeySet<String>()
        } else {
            categories.getOrPut(name) { ConcurrentHashMap.newKeySet() }
        }

        domains.forEach { domain ->
            val normalized = normalize(domain)
            if (normalized.isNotEmpty()) {
                target.add(normalized)
            }
        }

        if (replace) categories[name] = target
    }

    /**
     * Remove a category and its domains from the blocklist.
     * Only removes domains that aren't in other active categories.
     */
    fun removeCategory(name: String) {
        categories.remove(name)
    }

    /**
     * Set the whitelist (excluded domains).
     */
    fun setWhitelist(domains: Collection<String>) {
        whitelist = normalizedSet(domains)
    }

    /**
     * Get the total number of blocked domains.
     */
    fun size(): Int {
        // ponytail: sums per-set sizes, which are O(1); a domain listed in two
        // categories is counted twice. De-duplicating would need a flattened
        // union set, roughly +37 MB per million domains in the VPN process.
        var total = blockedDomains.size
        for (categorySet in categories.values) {
            total += categorySet.size
        }
        return total
    }

    /**
     * Clear everything.
     */
    fun clear() {
        blockedDomains = emptySet()
        categories.clear()
        whitelist = emptySet()
    }

    /**
     * Normalize a collection into an immutable set, dropping unusable entries.
     */
    private fun normalizedSet(domains: Collection<String>): Set<String> {
        val result = HashSet<String>(domains.size * 4 / 3 + 1)
        domains.forEach { domain ->
            val normalized = normalize(domain)
            if (normalized.isNotEmpty()) {
                result.add(normalized)
            }
        }
        return result
    }

    /**
     * Normalize a domain: lowercase, trim, remove trailing dot,
     * strip protocol prefixes, strip www.
     */
    private fun normalize(domain: String): String {
        var d = domain.trim().lowercase()

        // Skip comment lines and empty
        if (d.isEmpty() || d.startsWith("#")) return ""

        // Strip hosts file format (e.g., "0.0.0.0 domain.com" or "127.0.0.1 domain.com")
        if (d.startsWith("0.0.0.0 ") || d.startsWith("127.0.0.1 ")) {
            d = d.substringAfter(" ").trim()
        }

        // Remove protocol
        d = d.removePrefix("https://").removePrefix("http://")

        // Remove path
        val slashIndex = d.indexOf('/')
        if (slashIndex > 0) d = d.substring(0, slashIndex)

        // Remove port
        val colonIndex = d.indexOf(':')
        if (colonIndex > 0) d = d.substring(0, colonIndex)

        // Remove trailing dot (FQDN)
        d = d.trimEnd('.')

        // Remove www prefix
        d = d.removePrefix("www.")

        // Basic validation — must have at least one dot
        if (!d.contains('.')) return ""

        return d
    }
}
