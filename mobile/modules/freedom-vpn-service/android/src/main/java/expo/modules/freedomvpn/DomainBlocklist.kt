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
        val normalized = normalize(domain)
        if (normalized.isEmpty()) return false

        val candidates = parentChain(normalized)

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
