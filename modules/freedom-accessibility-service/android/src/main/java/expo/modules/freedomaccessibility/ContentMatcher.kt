package expo.modules.freedomaccessibility

import android.content.Context
import android.util.Log
import org.json.JSONArray
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Content matching engine for URL-level blocking.
 *
 * Checks URLs against:
 * 1. Domain blocklist (same domains as VPN, but checked at URL level)
 * 2. Keyword list (searched in URL path and query string)
 * 3. Whitelist (excluded domains override everything)
 *
 * This provides a second layer of protection on top of DNS blocking
 * for cases where:
 * - A domain's path contains adult content but the domain itself is not blocked
 * - URL contains blocked keywords
 * - User navigates to a page already loaded (cached/no DNS)
 */
class ContentMatcher {

    data class AppConfig(
        val packageName: String,
        val appName: String,
        val surveillanceType: String,
        val surveillanceValue: Int,
        val startTime: String? = null, // HH:mm
        val endTime: String? = null    // HH:mm
    )

    @Volatile private var blockedDomains = ConcurrentHashMap.newKeySet<String>()
    @Volatile private var blockedKeywords = ConcurrentHashMap.newKeySet<String>()
    @Volatile private var blockedApps = ConcurrentHashMap<String, AppConfig>()
    @Volatile private var whitelist = ConcurrentHashMap.newKeySet<String>()

    @Volatile private var adultBlockingEnabled = true

    // Per-category domain storage for instant category toggling
    private val categoryDomains = ConcurrentHashMap<String, Set<String>>()
    private val enabledCategories = ConcurrentHashMap.newKeySet<String>()
    private val includedDomains = ConcurrentHashMap.newKeySet<String>()
    @Volatile private var usingPerCategoryMode = false

    // Store package names and their expiry timestamp in milliseconds
    private val temporaryAppAllowlist = ConcurrentHashMap<String, Long>()

    private val searchEngineDomains = setOf(
        "google.com", "bing.com", "duckduckgo.com", "yahoo.com", 
        "baidu.com", "yandex.com", "ecosia.org", "startpage.com"
    )

    /**
     * Check if a URL or extracted text should be blocked.
     * @param contextDomain Optional: the primary domain of the page being viewed.
     *   When set, keyword blocking is skipped if this domain is whitelisted.
     */
    fun isUrlBlocked(url: String, contextDomain: String? = null): MatchResult {
        if (url.isEmpty()) return MatchResult.ALLOWED

        // If caller told us the page domain is whitelisted, skip all keyword blocking
        val contextWhitelisted = contextDomain != null && isDomainWhitelisted(contextDomain)

        // Samsung/Chrome often hide URLs in titles like "porntrex.tv | Best Videos"
        // or "Best Videos - porntrex.tv". We split and check ALL parts.
        val delimiters = Regex("\\s*[|·»]\\s*|\\s+[-:]\\s+")
        val parts = url.split(delimiters)

        for (rawPart in parts) {
            val normalized = normalizeUrl(rawPart)
            if (normalized.isEmpty()) continue

            Log.d("ContentMatcher", "Checking candidate: '$normalized' (adultBlockingEnabled=$adultBlockingEnabled)")

            if (looksLikeUrl(normalized)) {
                if (!adultBlockingEnabled) {
                    continue
                }
                val domain = extractDomain(normalized)

                // Whitelist check first
                if (domain.isNotEmpty() && isDomainWhitelisted(domain)) {
                    Log.d("ContentMatcher", "Candidate '$normalized' is whitelisted (domain=$domain)")
                    continue
                }

                // Domain check — primary domain (direct visit)
                if (domain.isNotEmpty() && isDomainBlocked(domain)) {
                    Log.w("ContentMatcher", "URL domain blocked: $domain (from $normalized)")
                    return MatchResult(true, MatchType.DOMAIN, domain)
                }

                // Domain check — scan full URL for embedded blocked domains
                val embeddedDomain = findEmbeddedBlockedDomain(normalized)
                if (embeddedDomain != null) {
                    Log.w("ContentMatcher", "URL embedded domain blocked: $embeddedDomain (from $normalized)")
                    return MatchResult(true, MatchType.DOMAIN, embeddedDomain)
                }

                // Keyword check — skip if context, domain, or any embedded domain is whitelisted
                if (contextWhitelisted || (domain.isNotEmpty() && isDomainWhitelisted(domain)) || containsWhitelistedDomain(normalized)) {
                    continue
                }
                val t = normalized.lowercase()
                val isSearchEngine = searchEngineDomains.any { domain.endsWith(it) } ||
                                   t.contains("google search") ||
                                   t.contains("bing search") ||
                                   t.contains("duckduckgo") ||
                                   t.contains("yahoo search")
                if (!isSearchEngine) {
                    val matchedKeyword = findMatchingKeyword(normalized)
                    if (matchedKeyword != null) {
                        Log.w("ContentMatcher", "URL keyword blocked: $matchedKeyword (from $normalized)")
                        return MatchResult(true, MatchType.KEYWORD, matchedKeyword)
                    }
                }
            }
            else {
                // Plain text (e.g. "Title - Browser") — skip keyword check if whitelisted
                if (contextWhitelisted || containsWhitelistedDomain(normalized)) continue

                val matchedKeyword = findMatchingKeyword(normalized)
                val t = normalized.lowercase()
                val isSearchEngine = t.contains("google search") || t.contains("bing search") || t.contains("duckduckgo") || t.contains("yahoo search")

                if (matchedKeyword != null && !isSearchEngine && adultBlockingEnabled) {
                    return MatchResult(true, MatchType.KEYWORD, matchedKeyword)
                }
            }
        }

        return MatchResult.ALLOWED
    }

    private fun normalizeUrl(url: String): String {
        // Strip Unicode formatting characters
        val stripped = url.replace(Regex("[\\u200E\\u200F\\u200B\\u200C\\u200D\\uFEFF]"), "")

        return stripped.lowercase()
            .removePrefix("https://")
            .removePrefix("http://")
            .removePrefix("www.")
            .trimEnd('/')
    }


    /**
     * Scan text for any embedded whitelisted domain (e.g. "manga catalog: www.mangaread.org").
     * Used to skip keyword blocking when the candidate text references a whitelisted site.
     */
    private val embeddedDomainPattern = Regex("[a-z0-9]([a-z0-9-]*[a-z0-9])?\\.([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)*[a-z]{2,}")

    private fun containsWhitelistedDomain(text: String): Boolean {
        for (match in embeddedDomainPattern.findAll(text.lowercase())) {
            if (isDomainWhitelisted(match.value.removePrefix("www."))) return true
        }
        return false
    }

    fun containsWhitelistedDomainPublic(text: String): Boolean = containsWhitelistedDomain(text)

    private fun isDomainBlocked(domain: String): Boolean {
        val normalizedDomain = domain.removePrefix("www.")

        // In per-category mode: check each enabled category set directly
        // This avoids maintaining a combined 900k+ domain set in memory
        if (usingPerCategoryMode) {
            if (matchesDomainInSet(normalizedDomain, includedDomains)) return true
            for (catId in enabledCategories) {
                val catDomains = categoryDomains[catId]
                if (catDomains != null && matchesDomainInSet(normalizedDomain, catDomains)) return true
            }
            return false
        }

        // Legacy mode: use combined blockedDomains set
        return matchesDomainInSet(normalizedDomain, blockedDomains)
    }

    /**
     * Check exact + suffix match against a domain set.
     */
    private fun matchesDomainInSet(domain: String, domainSet: Set<String>): Boolean {
        if (domainSet.contains(domain)) return true
        var current = domain
        while (true) {
            val dotIndex = current.indexOf('.')
            if (dotIndex < 0 || dotIndex == current.length - 1) break
            current = current.substring(dotIndex + 1)
            if (domainSet.contains(current)) return true
        }
        return false
    }

    private fun isDomainWhitelisted(domain: String): Boolean {
        if (domain.isEmpty()) return false
        val normalizedDomain = domain.removePrefix("www.")
        
        if (whitelist.contains(normalizedDomain)) {
            Log.v("ContentMatcher", "WHITELIST MATCH: $normalizedDomain")
            return true
        }

        var current = normalizedDomain
        while (true) {
            val dotIndex = current.indexOf('.')
            if (dotIndex < 0 || dotIndex == current.length - 1) break
            current = current.substring(dotIndex + 1)
            if (whitelist.contains(current)) {
                Log.v("ContentMatcher", "WHITELIST SUFFIX MATCH: $current (for $normalizedDomain)")
                return true
            }
        }

        return false
    }

    /**
     * Scan the full URL for blocked domains embedded in the path or query.
     * Uses O(1) HashSet lookups by extracting domain-like candidates from the URL.
     *
     * Catches: Google AMP, caches, redirects, URL-encoded paths.
     */
    private fun findEmbeddedBlockedDomain(normalizedUrl: String): String? {
        val decoded = try {
            java.net.URLDecoder.decode(normalizedUrl, "UTF-8")
        } catch (_: Exception) {
            normalizedUrl
        }

        val primaryDomain = extractDomain(normalizedUrl)

        // Extract domain-like candidates from the URL path/query
        // Split by common separators: / . = & ?
        val candidates = decoded.split('/', '.', '=', '&', '?', '#')

        // Reassemble potential domains: look for "name.tld" patterns in the decoded URL
        val domainPattern = Regex("[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\\.[a-z0-9]{2,}")
        for (match in domainPattern.findAll(decoded)) {
            val candidate = match.value
            if (candidate == primaryDomain) continue
            // Skip common search/analytics domains to avoid false positives
            if (candidate.startsWith("google.") || candidate.startsWith("bing.") || candidate.contains("analytics") || candidate.contains("doubleclick")) continue
            if (isDomainBlocked(candidate) && !isDomainWhitelisted(candidate)) {
                return candidate
            }
        }
        return null
    }

    // Common false positive words for aggressive keyword blocking
    private val falsePositivesMap = mapOf(
        "desi" to setOf("design", "desire", "desiccant", "desiccated", "desiderata"),
        "ass" to setOf("class", "glass", "pass", "grass", "mass", "bass", "cass", "sass", "brass", "compass", "harass", "embarrass", "assassin", "assemble", "assert", "assess", "asset", "assign", "assist", "associate", "assume", "assure", "embassy", "passion", "passport"),
        "cum" to setOf("document", "circum", "cucumber", "accumulate", "encumber"),
        "sex" to setOf("essex", "sussex", "middlesex"),
        "tit" to setOf("title", "entity", "attitude", "institute", "substitute", "petition", "competitor"),
        "dick" to setOf("dickens", "dickson", "moby-dick", "ridiculous")
    )

    fun findMatchingKeywordDirectly(text: String): String? {
        val direct = findMatchingKeyword(text)
        if (direct != null) return direct
        
        // Compact matching pass: handles "p o r n" or "p-o-r-n" or "p\u200Eo\u200Er\u200En"
        // We strip whitespace, common separators, and Unicode directional/invisible separators
        val compactText = text.lowercase().replace(Regex("[\\s\\-_\\.\\u200E\\u200F\\u200B\\u200C\\u200D\\uFEFF]+"), "")
        for (keyword in blockedKeywords) {
            val lowerKeyword = keyword.lowercase()
            if (lowerKeyword.length > 3 && compactText.contains(lowerKeyword)) {
                // Verify it's not a false positive in the original text (to be safe)
                return lowerKeyword
            }
        }
        return null
    }

    private fun findMatchingKeyword(url: String): String? {
        val lowerUrl = url.lowercase()
        
        for (keyword in blockedKeywords) {
            val lowerKeyword = keyword.lowercase()
            
            if (lowerUrl.contains(lowerKeyword)) {
                var hasValidBlock = false
                // Look for surrounding context (alphanumeric block)
                val textBlocks = lowerUrl.split(Regex("[^a-z0-9]"))
                for (block in textBlocks) {
                    if (block.contains(lowerKeyword)) {
                        // Heuristic 1: If the block is extremely long (>15 chars), it's probably a base64 token or hash.
                        if (lowerKeyword.length <= 4 && block.length > 15) {
                            continue
                        }

                        // Heuristic 2: Known false positives
                        val falsePositives = falsePositivesMap[lowerKeyword]
                        if (falsePositives != null) {
                            if (falsePositives.any { block.contains(it) }) continue
                        }

                        // Heuristic 3: For very short keywords (<= 3), prevent matching inside regular words or IDs.
                        // Require an EXACT match inside the block to avoid "sex" triggering on "sexiest", "sussex", "youtubeIdSex".
                        if (lowerKeyword.length <= 3) {
                            if (block != lowerKeyword) {
                                continue
                            }
                        }

                        hasValidBlock = true
                        break
                    }
                }
                
                if (hasValidBlock) {
                    return keyword
                }
            }
        }
        return null
    }

    /**
     * Get the set of blocked keywords for WebView text search.
     */
    fun getKeywords(): Set<String> = blockedKeywords.toSet()

    /**
     * Check if a domain is whitelisted (public accessor for callers that need
     * to pass whitelist context to keyword checks).
     */
    fun isWhitelisted(domain: String): Boolean = isDomainWhitelisted(domain)

    /**
     * Update the blocked domains list and persist to SharedPreferences.
     */
    fun setDomains(domains: Collection<String>, context: Context? = null) {
        val newSet = ConcurrentHashMap.newKeySet<String>()
        domains.forEach { d ->
            val normalized = extractDomain(normalizeUrl(d))
            if (normalized.isNotEmpty() && !normalized.startsWith("#")) {
                val domainWithoutWww = normalized.removePrefix("www.")
                newSet.add(domainWithoutWww)
            }
        }
        blockedDomains = newSet
        Log.i("ContentMatcher", "Updated blocked domains: ${blockedDomains.size} domains set")
        context?.let { persistData(it, KEY_DOMAINS, blockedDomains) }
    }

    /**
     * Update the blocked keywords list and persist to SharedPreferences.
     */
    fun setKeywords(keywords: Collection<String>, context: Context? = null) {
        val newSet = ConcurrentHashMap.newKeySet<String>()
        keywords.forEach { k ->
            val normalized = k.trim().lowercase()
            if (normalized.isNotEmpty() && !normalized.startsWith("#")) {
                newSet.add(normalized)
            }
        }
        blockedKeywords = newSet
        Log.i("ContentMatcher", "Updated blocked keywords: ${blockedKeywords.size} keywords set")
        context?.let { persistData(it, KEY_KEYWORDS, blockedKeywords) }
    }

    /**
     * Update the blocked apps list and persist to SharedPreferences.
     */
    fun setBlockedApps(configs: Collection<AppConfig>, context: Context? = null) {
        val newMap = ConcurrentHashMap<String, AppConfig>()
        configs.forEach { config ->
            val pkg = cleanPkg(config.packageName)
            if (pkg.isNotEmpty()) {
                newMap[pkg] = config
            }
        }
        blockedApps = newMap
        Log.i("ContentMatcher", "Updated blocked apps: ${blockedApps.size} apps set")
        context?.let { persistApps(it, blockedApps.values) }
    }

    /**
     * Update the master adult blocking toggle.
     */
    fun setAdultBlockingEnabled(enabled: Boolean, context: Context? = null) {
        adultBlockingEnabled = enabled
        Log.i("ContentMatcher", "Adult blocking ${if (enabled) "ENABLED" else "DISABLED"}")
        context?.let {
            it.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_ADULT_BLOCKING, enabled)
                .apply()
        }
    }

    private fun cleanPkg(pkg: String): String {
        return pkg.replace(Regex("[\\u200E\\u200F\\u200B\\u200C\\u200D\\uFEFF]"), "")
            .trim()
            .lowercase()
    }

    /**
     * Check if a package is blocked. Returns null if it's currently allowed (e.g., bypassed).
     */
    fun getAppConfig(packageName: String): AppConfig? {
        val clean = cleanPkg(packageName)
        val config = blockedApps[clean] ?: return null
        
        if (!isAppBlockedNow(config)) {
            return null // Outside of schedule
        }

        val allowedUntil = temporaryAppAllowlist[clean]
        if (allowedUntil != null) {
            if (System.currentTimeMillis() < allowedUntil) {
                return null // Bypassed!
            } else {
                temporaryAppAllowlist.remove(clean) // Expired
            }
        }
        
        return config
    }

    /**
     * Check if an app is blocked right now based on its schedule.
     */
    private fun isAppBlockedNow(config: AppConfig): Boolean {
        if (config.startTime.isNullOrEmpty() || config.endTime.isNullOrEmpty()) {
            return true // No schedule set = always blocked
        }

        try {
            val now = java.util.Calendar.getInstance()
            val currentHour = now.get(java.util.Calendar.HOUR_OF_DAY)
            val currentMinute = now.get(java.util.Calendar.MINUTE)
            val currentTimeInMinutes = currentHour * 60 + currentMinute

            val startParts = config.startTime.split(":")
            val startHour = startParts[0].toInt()
            val startMinute = if (startParts.size > 1) startParts[1].toInt() else 0
            val startTimeInMinutes = startHour * 60 + startMinute

            val endParts = config.endTime.split(":")
            val endHour = endParts[0].toInt()
            val endMinute = if (endParts.size > 1) endParts[1].toInt() else 0
            val endTimeInMinutes = endHour * 60 + endMinute

            return if (startTimeInMinutes <= endTimeInMinutes) {
                // Daytime schedule (e.g., 09:00 - 17:00)
                currentTimeInMinutes in startTimeInMinutes..endTimeInMinutes
            } else {
                // Overnight schedule (e.g., 22:00 - 06:00)
                currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes <= endTimeInMinutes
            }
        } catch (e: Exception) {
            Log.w("ContentMatcher", "Failed to parse schedule for ${config.packageName}: ${e.message}")
            return true // Fallback to blocked if schedule is malformed
        }
    }

    /**
     * Temporarily allow an app for a given duration in milliseconds.
     */
    fun allowAppTemporarily(packageName: String, durationMs: Long) {
        val clean = cleanPkg(packageName)
        temporaryAppAllowlist[clean] = System.currentTimeMillis() + durationMs
        Log.i("ContentMatcher", "App $clean temporarily allowed for ${durationMs / 1000} seconds")
    }

    /**
     * Get all blocked app configs.
     */
    fun getBlockedApps(): Collection<AppConfig> = blockedApps.values

    private fun persistApps(context: Context, apps: Collection<AppConfig>) {
        try {
            val array = JSONArray()
            apps.forEach { app ->
                val obj = org.json.JSONObject().apply {
                    put("packageName", app.packageName)
                    put("appName", app.appName)
                    put("surveillanceType", app.surveillanceType)
                    put("surveillanceValue", app.surveillanceValue)
                    put("startTime", app.startTime ?: "")
                    put("endTime", app.endTime ?: "")
                }
                array.put(obj)
            }
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_PACKAGES, array.toString())
                .apply()
        } catch (e: Exception) {
            Log.w("ContentMatcher", "Failed to persist apps: ${e.message}")
        }
    }

    private fun loadApps(context: Context) {
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val json = prefs.getString(KEY_PACKAGES, null) ?: return
            val array = JSONArray(json)
            blockedApps.clear()
            for (i in 0 until array.length()) {
                try {
                    val item = array.get(i)
                    if (item is org.json.JSONObject) {
                        val config = AppConfig(
                            packageName = item.getString("packageName"),
                            appName = item.getString("appName"),
                            surveillanceType = item.getString("surveillanceType"),
                            surveillanceValue = item.getInt("surveillanceValue"),
                            startTime = item.optString("startTime", ""),
                            endTime = item.optString("endTime", "")
                        )
                        blockedApps[cleanPkg(config.packageName)] = config
                    } else if (item is String) {
                        // Migration path: old data was just a package name
                        val config = AppConfig(
                            packageName = item,
                            appName = item.substringAfterLast('.'),
                            surveillanceType = "none",
                            surveillanceValue = 0
                        )
                        blockedApps[cleanPkg(config.packageName)] = config
                    }
                } catch (e: Exception) {
                    Log.w("ContentMatcher", "Failed to parse app config at index $i: ${e.message}")
                }
            }
        } catch (e: Exception) {
            Log.w("ContentMatcher", "Failed to load apps: ${e.message}")
        }
        Log.i("ContentMatcher", "Loaded persisted apps: ${blockedApps.size} apps found in storage")
    }

    /**
     * Set domains for a specific category and rebuild the active domain set.
     * This is called during full sync (e.g., after updateBlocklists).
     */
    fun setCategoryDomains(categoryId: String, domains: Collection<String>, context: Context? = null) {
        val newSet = HashSet<String>(domains.size)
        domains.forEach { d ->
            val normalized = extractDomain(normalizeUrl(d))
            if (normalized.isNotEmpty() && !normalized.startsWith("#")) {
                newSet.add(normalized.removePrefix("www."))
            }
        }
        categoryDomains[categoryId] = newSet
        usingPerCategoryMode = true
        Log.i("ContentMatcher", "Updated category '$categoryId': ${newSet.size} domains")
        context?.let {
            if (newSet.size > 5000) {
                persistCategoryToFile(it, categoryId, newSet)
            } else {
                persistData(it, "$KEY_CATEGORY_PREFIX$categoryId", newSet)
            }
        }
        rebuildActiveDomains()
    }

    /**
     * Clear all domains for a specific category. Call before re-populating
     * to prevent stale domains from persisting across updates.
     */
    fun clearCategoryDomains(categoryId: String, context: Context? = null) {
        categoryDomains.remove(categoryId)
        Log.i("ContentMatcher", "Cleared category '$categoryId'")
        context?.let {
            try { File(it.filesDir, "category_${categoryId}.txt").delete() } catch (_: Exception) {}
        }
    }

    /**
     * Get the actual unique domain count for a category.
     */
    fun getCategoryDomainCount(categoryId: String): Int {
        return categoryDomains[categoryId]?.size ?: 0
    }

    /**
     * Append domains to a category without rebuilding or persisting.
     * Call finalizeCategorySync() after all batches are done.
     */
    fun appendCategoryDomains(categoryId: String, domains: Collection<String>) {
        val existing = categoryDomains.getOrPut(categoryId) { HashSet() }
        val mutableExisting = if (existing is MutableSet) existing else HashSet(existing).also { categoryDomains[categoryId] = it }
        domains.forEach { d ->
            val normalized = extractDomain(normalizeUrl(d))
            if (normalized.isNotEmpty() && !normalized.startsWith("#")) {
                mutableExisting.add(normalized.removePrefix("www."))
            }
        }
        usingPerCategoryMode = true
    }

    /**
     * Finalize a batched category sync: persist to file and rebuild active domains.
     * Uses file-based persistence instead of SharedPreferences to avoid OOM on large sets.
     */
    fun finalizeCategorySync(categoryId: String, context: Context? = null) {
        val domains = categoryDomains[categoryId] ?: return
        Log.i("ContentMatcher", "Finalized category '$categoryId': ${domains.size} domains")
        context?.let { persistCategoryToFile(it, categoryId, domains) }
        rebuildActiveDomains()
    }

    /**
     * Persist category domains to a plain text file (one domain per line).
     * Much more memory-efficient than JSONArray for 100k+ domains.
     */
    private fun persistCategoryToFile(context: Context, categoryId: String, domains: Set<String>) {
        try {
            val file = File(context.filesDir, "category_${categoryId}.txt")
            file.bufferedWriter().use { writer ->
                domains.forEach { domain ->
                    writer.write(domain)
                    writer.newLine()
                }
            }
            Log.i("ContentMatcher", "Persisted category '$categoryId': ${domains.size} domains to file")
        } catch (e: Exception) {
            Log.w("ContentMatcher", "Failed to persist category $categoryId to file: ${e.message}")
        }
    }

    /**
     * Load category domains from a plain text file.
     */
    private fun loadCategoryFromFile(context: Context, categoryId: String): Set<String> {
        try {
            val file = File(context.filesDir, "category_${categoryId}.txt")
            if (!file.exists()) return emptySet()
            val domains = HashSet<String>()
            file.bufferedReader().useLines { lines ->
                lines.forEach { line ->
                    val trimmed = line.trim()
                    if (trimmed.isNotEmpty()) domains.add(trimmed)
                }
            }
            Log.i("ContentMatcher", "Loaded category '$categoryId': ${domains.size} domains from file")
            return domains
        } catch (e: Exception) {
            Log.w("ContentMatcher", "Failed to load category $categoryId from file: ${e.message}")
            return emptySet()
        }
    }

    /**
     * Enable or disable a category (instant, no domain transfer needed).
     * The native side rebuilds the active domain set from stored per-category data.
     */
    fun setCategoryEnabled(categoryId: String, enabled: Boolean, context: Context? = null) {
        if (enabled) {
            enabledCategories.add(categoryId)
        } else {
            enabledCategories.remove(categoryId)
        }
        Log.i("ContentMatcher", "Category '$categoryId' ${if (enabled) "ENABLED" else "DISABLED"}")
        context?.let { persistData(it, KEY_ENABLED_CATEGORIES, enabledCategories) }
        if (usingPerCategoryMode) {
            rebuildActiveDomains()
        }
    }

    /**
     * Set user-included domains (separate from categories).
     */
    fun setIncludedDomains(domains: Collection<String>, context: Context? = null) {
        includedDomains.clear()
        domains.forEach { d ->
            val normalized = extractDomain(normalizeUrl(d))
            if (normalized.isNotEmpty() && !normalized.startsWith("#")) {
                includedDomains.add(normalized.removePrefix("www."))
            }
        }
        Log.i("ContentMatcher", "Updated included domains: ${includedDomains.size}")
        context?.let { persistData(it, KEY_INCLUDED_DOMAINS, includedDomains) }
        if (usingPerCategoryMode) {
            rebuildActiveDomains()
        }
    }

    /**
     * Rebuild the combined blockedDomains set from enabled categories + included domains.
     */
    private fun rebuildActiveDomains() {
        // In per-category mode, isDomainBlocked checks category sets directly
        // No combined set needed — saves ~60MB of heap for 900k domains
        val totalDomains = enabledCategories.sumOf { catId ->
            categoryDomains[catId]?.size ?: 0
        } + includedDomains.size
        Log.i("ContentMatcher", "Active domains: $totalDomains (${enabledCategories.size} categories + ${includedDomains.size} included)")
    }

    /**
     * Update the whitelist and persist to SharedPreferences.
     */
    fun setWhitelist(domains: Collection<String>, context: Context? = null) {
        val newSet = ConcurrentHashMap.newKeySet<String>()
        domains.forEach { d ->
            val normalized = normalizeUrl(d)
            if (normalized.isNotEmpty() && !normalized.startsWith("#")) {
                newSet.add(extractDomain(normalized))
            }
        }
        whitelist = newSet
        context?.let { persistData(it, KEY_WHITELIST, whitelist) }
    }

    /**
     * Load all matcher data from SharedPreferences.
     */
    fun loadPersistedData(context: Context) {
        loadSet(context, KEY_KEYWORDS, blockedKeywords)
        loadApps(context)
        loadSet(context, KEY_WHITELIST, whitelist)

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        adultBlockingEnabled = prefs.getBoolean(KEY_ADULT_BLOCKING, true)

        // Try loading per-category data (new format)
        loadSet(context, KEY_ENABLED_CATEGORIES, enabledCategories)
        loadSet(context, KEY_INCLUDED_DOMAINS, includedDomains)

        // Load per-category domain sets — try file-based first, then SharedPreferences
        var foundCategories = false
        val knownCategories = listOf("adult", "hentai")

        for (catId in knownCategories) {
            val fileDomains = loadCategoryFromFile(context, catId)
            if (fileDomains.isNotEmpty()) {
                categoryDomains[catId] = HashSet(fileDomains)
                foundCategories = true
            }
        }

        // Fallback: try SharedPreferences (old format) for any categories not found in files
        if (!foundCategories) {
            for (key in prefs.all.keys) {
                if (key.startsWith(KEY_CATEGORY_PREFIX)) {
                    val catId = key.removePrefix(KEY_CATEGORY_PREFIX)
                    if (categoryDomains.containsKey(catId)) continue
                    val catSet = HashSet<String>()
                    val json = prefs.getString(key, null)
                    if (json != null) {
                        try {
                            val array = JSONArray(json)
                            for (i in 0 until array.length()) {
                                catSet.add(array.getString(i))
                            }
                        } catch (_: Exception) {}
                    }
                    if (catSet.isNotEmpty()) {
                        categoryDomains[catId] = catSet
                        foundCategories = true
                    }
                }
            }
        }

        if (foundCategories) {
            usingPerCategoryMode = true
            rebuildActiveDomains()
        } else {
            // Legacy mode: load combined domain set
            loadSet(context, KEY_DOMAINS, blockedDomains)
        }

        val totalDomains = if (usingPerCategoryMode) {
            categoryDomains.values.sumOf { it.size } + includedDomains.size
        } else blockedDomains.size
        Log.i("ContentMatcher", "Loaded persisted data: $totalDomains domains, ${blockedKeywords.size} keywords, ${blockedApps.size} apps, ${whitelist.size} whitelist items, filtering=${adultBlockingEnabled}, perCategory=${usingPerCategoryMode}")
    }

    private fun persistData(context: Context, key: String, data: Set<String>) {
        try {
            val json = JSONArray(data).toString()
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(key, json)
                .apply()
        } catch (e: Exception) {
            Log.w("ContentMatcher", "Failed to persist $key: ${e.message}")
        }
    }

    private fun loadSet(context: Context, key: String, target: MutableSet<String>) {
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val json = prefs.getString(key, null) ?: return
            val array = JSONArray(json)
            target.clear()
            for (i in 0 until array.length()) {
                target.add(array.getString(i))
            }
        } catch (e: Exception) {
            Log.w("ContentMatcher", "Failed to load $key: ${e.message}")
        }
    }

    private fun extractDomain(normalizedUrl: String): String {
        // Find the first occurrence of a separator (/ ? # : or space)
        val firstSep = normalizedUrl.indexOfAny(charArrayOf('/', '?', '#', ':', ' '))
        val rawDomain = if (firstSep > 0) {
            normalizedUrl.substring(0, firstSep)
        } else {
            normalizedUrl
        }
        return rawDomain.removePrefix("www.")
    }

    private fun looksLikeUrl(text: String): Boolean {
        val t = text.lowercase().trim()
        
        if (t.isEmpty() || t.length < 4 || t.startsWith(".") || t == ".com" || t == ".net") return false
        
        // Definite URLs
        if (t.startsWith("http://") || t.startsWith("https://") || t.startsWith("www.")) return true
        
        // If it contains Samsung/Common separators, treat the first block as text
        if (t.contains('|') || t.contains(" - ") || t.contains("·")) return true

        // Permissive Domain Pattern: has a dot, no spaces at beginning/end, no internal protocol
        val dotIndex = t.indexOf('.')
        if (dotIndex > 0 && dotIndex < t.length - 2) {
            // If it has spaces, ONLY accept it if it contains a known common TLD
            if (t.contains(' ')) {
                return t.contains(".com") || t.contains(".net") || t.contains(".tv") || 
                       t.contains(".xxx") || t.contains(".org") || t.contains(".site") || 
                       t.contains(".io") || t.contains(".me") || t.contains(".cc") || t.contains(".info")
            }
            return true
        }
        
        return false
    }

    data class MatchResult(
        val blocked: Boolean,
        val matchType: MatchType = MatchType.NONE,
        val matchedValue: String = ""
    ) {
        companion object {
            val ALLOWED = MatchResult(false)
        }
    }

    enum class MatchType {
        NONE,
        DOMAIN,
        KEYWORD
    }

    companion object {
        private const val PREFS_NAME = "freedom_matcher_data"
        private const val KEY_DOMAINS = "blocked_domains"
        private const val KEY_KEYWORDS = "blocked_keywords"
        private const val KEY_PACKAGES = "blocked_packages"
        private const val KEY_WHITELIST = "whitelist"
        private const val KEY_ADULT_BLOCKING = "adult_blocking_enabled"
        private const val KEY_CATEGORY_PREFIX = "cat_domains_"
        private const val KEY_ENABLED_CATEGORIES = "enabled_categories"
        private const val KEY_INCLUDED_DOMAINS = "included_domains"
    }
}
