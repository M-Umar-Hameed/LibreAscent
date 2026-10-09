package expo.modules.freedomvpn

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DomainKeywordTest {

    private val keywords = DomainBlocklist.normalizeKeywords(listOf(" Porn ", "sex", "", "only fans"))

    @Test
    fun aLongKeywordMatchesInsideAnyLabelPart() {
        assertTrue(DomainBlocklist.keywordInDomain("freepornsite.net", keywords))
        assertTrue(DomainBlocklist.keywordInDomain("cdn.porn-tube.example", keywords))
        assertTrue(DomainBlocklist.keywordInDomain("onlyfans.com", keywords))
    }

    @Test
    fun aShortKeywordMustBeAWholeLabelPart() {
        assertTrue(DomainBlocklist.keywordInDomain("sex.com", keywords))
        assertTrue(DomainBlocklist.keywordInDomain("free-sex.example", keywords))
        assertFalse(DomainBlocklist.keywordInDomain("essex.ac.uk", keywords))
        assertFalse(DomainBlocklist.keywordInDomain("sussex.gov", keywords))
    }

    @Test
    fun theWhitelistStillWins() {
        val blocklist = DomainBlocklist()
        blocklist.setKeywords(listOf("porn"))
        blocklist.setWhitelist(listOf("pornhub-research.org"))
        assertTrue(blocklist.isBlocked("pornsite.com"))
        assertFalse(blocklist.isBlocked("pornhub-research.org"))
        assertFalse(blocklist.isBlocked("example.com"))
    }
}
