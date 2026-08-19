package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Verifies findMatchingKeyword's behaviour is unchanged after hoisting the
 * per-keyword text-block split (Regex("[^a-z0-9]")) out of the loop so it
 * runs once instead of once per keyword.
 */
class ContentMatcherKeywordTest {

    @Test
    fun exactKeywordMatch() {
        val matcher = ContentMatcher()
        matcher.setKeywordsForTest(listOf("video"))

        assertEquals("video", matcher.findMatchingKeywordForTest("example.com/video/123"))
    }

    @Test
    fun keywordAsSeparateToken() {
        val matcher = ContentMatcher()
        // Short keywords (<=3 chars) require the block to equal the keyword exactly.
        matcher.setKeywordsForTest(listOf("ass"))

        assertEquals("ass", matcher.findMatchingKeywordForTest("example.com/ass"))
    }

    @Test
    fun keywordAsSubstringInsideLongerWordDoesNotMatch() {
        val matcher = ContentMatcher()
        // "sex" inside "unisex" is not an exact block match and "unisex" is not
        // in the false-positive list either, so heuristic 3 rejects it.
        matcher.setKeywordsForTest(listOf("sex"))

        assertNull(matcher.findMatchingKeywordForTest("example.com/unisex/1"))
    }

    @Test
    fun caseDifferencesInInputTextStillMatch() {
        val matcher = ContentMatcher()
        matcher.setKeywordsForTest(listOf("porn"))

        assertEquals("porn", matcher.findMatchingKeywordForTest("Example.COM/Porn/1"))
    }

    @Test
    fun multipleKeywordsWhereALaterOneMatches() {
        val matcher = ContentMatcher()
        matcher.setKeywordsForTest(listOf("nomatch1", "nomatch2", "video"))

        assertEquals("video", matcher.findMatchingKeywordForTest("example.com/video/1"))
    }

    @Test
    fun emptyKeywordListReturnsNull() {
        val matcher = ContentMatcher()
        matcher.setKeywordsForTest(emptyList())

        assertNull(matcher.findMatchingKeywordForTest("example.com/anything"))
    }
}
