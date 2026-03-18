package expo.modules.freedomvpn

import java.util.concurrent.ConcurrentHashMap

/**
 * Domain blocklist with O(1) lookup via HashSet.
 * Supports exact match and suffix matching (blocks subdomains).
 *
 * Thread-safe: uses ConcurrentHashMap for concurrent reads/writes
 * from the VPN packet processing thread and the JS config thread.
 */
class DomainBlocklist {

    // Main blocklist — stores normalized domains
    private val blockedDomains = ConcurrentHashMap.newKeySet<String>()

    // Per-category domain sets — for enabling/disabling categories at runtime
    private val categories = ConcurrentHashMap<String, MutableSet<String>>()

    // Whitelist — domains explicitly allowed (takes precedence over blocklist)
    private val whitelist = ConcurrentHashMap.newKeySet<String>()

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

        // Check whitelist first (exact + suffix)
        if (matchesList(normalized, whitelist)) return false

        // Check blocklist (exact + suffix)
        return matchesList(normalized, blockedDomains)
    }

    /**
     * Check if the domain or any of its parent domains match the given set.
     * Example: for "sub.example.com", checks:
     *   "sub.example.com" → "example.com" → "com"
     */
    private fun matchesList(domain: String, domainSet: Set<String>): Boolean {
        // Exact match
        if (domainSet.contains(domain)) return true

        // Suffix/parent match
        var current = domain
        while (true) {
            val dotIndex = current.indexOf('.')
            if (dotIndex < 0 || dotIndex == current.length - 1) break
            current = current.substring(dotIndex + 1)
            if (domainSet.contains(current)) return true
        }

        return false
    }

    /**
     * Replace the entire blocklist with a new set of domains.
     */
    fun setDomains(domains: Collection<String>) {
        blockedDomains.clear()
        domains.forEach { domain ->
            val normalized = normalize(domain)
            if (normalized.isNotEmpty()) {
                blockedDomains.add(normalized)
            }
        }
    }

    /**
     * Add domains to the blocklist.
     */
    fun addDomains(domains: Collection<String>) {
        domains.forEach { domain ->
            val normalized = normalize(domain)
            if (normalized.isNotEmpty()) {
                blockedDomains.add(normalized)
            }
        }
    }

    /**
     * Add/append domains to a category.
     * Domains are also added to the main blocklist.
     * If the category already exists, domains are appended (not replaced).
     */
    fun addCategory(name: String, domains: Collection<String>) {
        val normalizedDomains = domains
            .map { normalize(it) }
            .filter { it.isNotEmpty() }

        val existing = categories.getOrPut(name) { ConcurrentHashMap.newKeySet() }
        existing.addAll(normalizedDomains)
        blockedDomains.addAll(normalizedDomains)
    }

    /**
     * Remove a category and its domains from the blocklist.
     * Only removes domains that aren't in other active categories.
     */
    fun removeCategory(name: String) {
        val categoryDomains = categories.remove(name) ?: return

        // Collect all domains from remaining categories
        val remainingDomains = HashSet<String>()
        categories.values.forEach { remainingDomains.addAll(it) }

        // Remove only domains that aren't in other categories
        categoryDomains.forEach { domain ->
            if (!remainingDomains.contains(domain)) {
                blockedDomains.remove(domain)
            }
        }
    }

    /**
     * Set the whitelist (excluded domains).
     */
    fun setWhitelist(domains: Collection<String>) {
        whitelist.clear()
        domains.forEach { domain ->
            val normalized = normalize(domain)
            if (normalized.isNotEmpty()) {
                whitelist.add(normalized)
            }
        }
    }

    /**
     * Get the total number of blocked domains.
     */
    fun size(): Int = blockedDomains.size

    /**
     * Clear everything.
     */
    fun clear() {
        blockedDomains.clear()
        categories.clear()
        whitelist.clear()
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
