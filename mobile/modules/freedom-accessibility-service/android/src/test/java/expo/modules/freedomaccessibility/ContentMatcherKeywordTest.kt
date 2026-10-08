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

    @Test
    fun leetspeakAndCyrillicLookalikesMatch() {
        val matcher = ContentMatcher()
        matcher.setKeywordsForTest(listOf("porn", "hentai"))

        assertEquals("porn", matcher.findMatchingKeywordForTest("example.com/p0rn/1"))
        assertEquals("porn", matcher.findMatchingKeywordForTest("example.com/роrN"))
        assertEquals("hentai", matcher.findMatchingKeywordForTest("example.com/h3nt@1"))
    }

    @Test
    fun foldingLeavesShortKeywordsToExactTokens() {
        val matcher = ContentMatcher()
        matcher.setKeywordsForTest(listOf("sex", "ass"))

        assertNull(matcher.findMatchingKeywordForTest("example.com/5ex"))
        assertNull(matcher.findMatchingKeywordForTest("example.com/a55"))
    }

    @Test
    fun foldingKeepsFalsePositiveProtections() {
        val matcher = ContentMatcher()
        matcher.setKeywordsForTest(listOf("desi", "dick", "porn"))

        // Known false-positive words still win after folding.
        assertNull(matcher.findMatchingKeywordForTest("example.com/des1gn"))
        assertNull(matcher.findMatchingKeywordForTest("example.com/d1ckens"))
        // A long folded token is still treated as a hash, not a word.
        assertNull(matcher.findMatchingKeywordForTest("example.com/a8f3p0rn1234567890"))
    }

    @Test
    fun compactPassFoldsSpacedLeetspeak() {
        val matcher = ContentMatcher()
        matcher.setKeywordsForTest(listOf("porn"))

        assertEquals("porn", matcher.findMatchingKeywordDirectly("watch p 0 r n now"))
    }

    @Test
    fun foldingNeverTurnsPureDigitsIntoAKeyword() {
        val matcher = ContentMatcher()
        matcher.setKeywordsForTest(listOf("tits"))

        assertNull(matcher.findMatchingKeywordForTest("shop.com/item/27175"))
        assertNull(matcher.findMatchingKeywordDirectly("Price: \$71.75"))
        assertEquals("tits", matcher.findMatchingKeywordForTest("example.com/t1ts"))
        assertEquals("tits", matcher.findMatchingKeywordDirectly("see t 1 t s"))
    }
}
