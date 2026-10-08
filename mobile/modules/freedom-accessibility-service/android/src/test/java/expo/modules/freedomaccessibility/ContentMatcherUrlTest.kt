package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * Covers isUrlBlocked's search-engine exemption, proxy unwrapping and
 * embedded-domain scan, plus getAppConfig's package-name cleaning.
 */
class ContentMatcherUrlTest {

    private fun matcher(domains: List<String> = emptyList(), keywords: List<String> = emptyList()) =
        ContentMatcher().apply {
            setDomains(domains)
            setKeywordsForTest(keywords)
        }

    private fun ContentMatcher.assertBlocked(url: String, type: ContentMatcher.MatchType, value: String) {
        assertEquals(ContentMatcher.MatchResult(true, type, value), isUrlBlocked(url), url)
    }

    @Test
    fun searchEngineTokenInPathOrFragmentDoesNotExemptKeywords() {
        val m = matcher(keywords = listOf("porn"))

        m.assertBlocked("reddit.com/r/porn/#duckduckgo", ContentMatcher.MatchType.KEYWORD, "porn")
        m.assertBlocked("reddit.com/r/porn/?ref=duckduckgo", ContentMatcher.MatchType.KEYWORD, "porn")
        m.assertBlocked("google.evil.com/porn", ContentMatcher.MatchType.KEYWORD, "porn")
        m.assertBlocked("notgoogle.com/porn", ContentMatcher.MatchType.KEYWORD, "porn")
        m.assertBlocked("porn videos google search", ContentMatcher.MatchType.KEYWORD, "porn")
    }

    @Test
    fun searchEngineQueryIsKeywordCheckedButRestOfUrlIsNot() {
        val m = matcher(keywords = listOf("porn"))

        m.assertBlocked("google.co.uk/search?q=free+porn&hl=en", ContentMatcher.MatchType.KEYWORD, "porn")
        m.assertBlocked("duckduckgo.com/?q=porn%20videos", ContentMatcher.MatchType.KEYWORD, "porn")
        m.assertBlocked("search.yahoo.com/search?p=porn", ContentMatcher.MatchType.KEYWORD, "porn")
        m.assertBlocked("yandex.ru/search/?text=porn", ContentMatcher.MatchType.KEYWORD, "porn")
        assertFalse(m.isUrlBlocked("google.com/search?q=cats&client=pornview").blocked)
        assertFalse(m.isUrlBlocked("bing.com/porn/images?q=cats").blocked)
    }

    @Test
    fun translateProxyIsUnwrappedToTheOriginalDomain() {
        val m = matcher(domains = listOf("blocked.com", "my-site.com"))

        m.assertBlocked("www-blocked-com.translate.goog/x?_x_tr_sl=auto", ContentMatcher.MatchType.DOMAIN, "blocked.com")
        m.assertBlocked("my--site-com.translate.goog", ContentMatcher.MatchType.DOMAIN, "my-site.com")
        assertFalse(m.isUrlBlocked("www-allowed-com.translate.goog/x").blocked)
    }

    @Test
    fun waybackSnapshotIsUnwrappedToTheArchivedDomain() {
        val m = matcher(domains = listOf("blocked.com"))

        m.assertBlocked("https://web.archive.org/web/20240101000000/https://blocked.com/x", ContentMatcher.MatchType.DOMAIN, "blocked.com")
        m.assertBlocked("web.archive.org/web/2024if_/http://www.blocked.com/", ContentMatcher.MatchType.DOMAIN, "blocked.com")
        assertFalse(m.isUrlBlocked("web.archive.org/web/2024/https://allowed.com/").blocked)
    }

    @Test
    fun webProxyTargetParameterIsUnwrapped() {
        val m = matcher(domains = listOf("blocked.com"))

        m.assertBlocked("croxyproxy.com/?url=https%3A%2F%2Fblocked.com%2Fx", ContentMatcher.MatchType.DOMAIN, "blocked.com")
        m.assertBlocked("hide.me/en/proxy?u=blocked.com", ContentMatcher.MatchType.DOMAIN, "blocked.com")
        // A proxy wrapped in a proxy.
        m.assertBlocked("kproxy.com/?q=www-blocked-com.translate.goog", ContentMatcher.MatchType.DOMAIN, "blocked.com")
    }

    @Test
    fun embeddedScanMatchesBareTwoLabelDomain() {
        val m = matcher(domains = listOf("blocked.com"))

        m.assertBlocked("example.org/redirect?to=blocked.com", ContentMatcher.MatchType.DOMAIN, "blocked.com")
        m.assertBlocked("google.com/amp/s/blocked.com/foo", ContentMatcher.MatchType.DOMAIN, "blocked.com")
    }

    @Test
    fun appConfigLookupCleansInputAndStoredNames() {
        val m = ContentMatcher()
        m.setBlockedApps(listOf(ContentMatcher.AppConfig(" Com.Example.App​ ", "Example", "none", 0)))

        assertNotNull(m.getAppConfig("com.example.app"))
        assertNotNull(m.getAppConfig("COM.EXAMPLE.APP‎"))
        assertNull(m.getAppConfig("com.other.app"))
    }
}
