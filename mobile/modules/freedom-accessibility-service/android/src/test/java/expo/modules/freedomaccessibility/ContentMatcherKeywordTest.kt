package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Covers ContentMatcher's private findMatchingKeyword: exact/substring/token
 * matching, case handling, false-positive heuristics, and empty input.
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
    fun shortKeywordAsSubstringInsideLongerWordDoesNotMatch() {
        val matcher = ContentMatcher()
        // "sex" inside "unisex" is not an exact block match and "unisex" is not
        // in the false-positive list either, so heuristic 3 rejects it.
        matcher.setKeywordsForTest(listOf("sex"))

        assertNull(matcher.findMatchingKeywordForTest("example.com/unisex/1"))
    }

    @Test
    fun keywordLongerThanThreeMatchesInsideLongerToken() {
        val matcher = ContentMatcher()
        // "porn" (4 chars) has no false-positive entry, so heuristic 3's exact-token
        // requirement (only for <=3 char keywords) does not apply here.
        matcher.setKeywordsForTest(listOf("porn"))

        assertEquals("porn", matcher.findMatchingKeywordForTest("pornhub.com"))
    }

    @Test
    fun caseDifferencesInInputTextStillMatch() {
        val matcher = ContentMatcher()
        matcher.setKeywordsForTest(listOf("porn"))

        assertEquals("porn", matcher.findMatchingKeywordForTest("Example.COM/Porn/1"))
    }

    @Test
    fun matchFoundAmongMultipleConfiguredKeywords() {
        val matcher = ContentMatcher()
        // blockedKeywords is a hash set, so iteration order is unspecified;
        // this only asserts the matching keyword is found despite non-matches
        // also being present in the set.
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
