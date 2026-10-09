package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AppScanRulesTest {

    @Test
    fun builtinLabelsMatchAnywhereInScreenTextIgnoringCase() {
        assertEquals("NSFW", FreedomAccessibilityService.builtinNsfwLabel("Post\nnsfw, wataa, Posted in r/x"))
        assertEquals("18+", FreedomAccessibilityService.builtinNsfwLabel("Only 18+ here"))
        assertEquals("🔞", FreedomAccessibilityService.builtinNsfwLabel("clip 🔞"))
        assertNull(FreedomAccessibilityService.builtinNsfwLabel("Home\nFollowing\nFor you"))
    }

    @Test
    fun redditAllowsTheOpenedVideoAndBlocksTheNextOne() {
        val detector = ReelsDetector()
        assertFalse(detector.redditSwipedOn(true, "a, post creator Post title, wataa"))
        // Labels can lag a frame; a missing post keeps the opened one.
        assertFalse(detector.redditSwipedOn(true, null))
        assertFalse(detector.redditSwipedOn(true, "a, post creator Post title, wataa"))
        assertTrue(detector.redditSwipedOn(true, "b, post creator Post title, Wataa"))
        // Closing the player starts over.
        assertFalse(detector.redditSwipedOn(false, null))
        assertFalse(detector.redditSwipedOn(true, "b, post creator Post title, Wataa"))
    }

    @Test
    fun threadsSitesMapToTheThreadsApp() {
        assertEquals(listOf("com.instagram.barcelona"), NsfwWeb.packagesFor("www.threads.net/@someone"))
        assertEquals(listOf("com.instagram.barcelona"), NsfwWeb.packagesFor("threads.com/@someone/post/1"))
        assertEquals(listOf("org.telegram.messenger"), NsfwWeb.packagesFor("web.telegram.org/k/"))
        assertEquals(listOf("org.telegram.messenger"), NsfwWeb.packagesFor("t.me/somechannel"))
    }

    @Test
    fun explicitAppsAndTachiyomiReadersAreBlocked() {
        assertTrue(ExplicitApps.matches("eu.kanade.tachiyomi.extension.all.hentaifox"))
        assertTrue(ExplicitApps.matches("eu.kanade.tachiyomi.sy"))
        assertTrue(ExplicitApps.matches("app.mihon"))
        assertTrue(ExplicitApps.matches("com.example.PornHub"))
        assertFalse(ExplicitApps.matches("com.reddit.frontpage"))
        assertFalse(ExplicitApps.matches("app.mihonfake"))
        assertFalse(ExplicitApps.matches("com.android.chrome"))
    }

    @Test
    fun contentSettingsHaveASafeState() {
        val reddit = ContentSettingGuard.RULES.getValue("com.reddit.frontpage")
        assertEquals(false, ContentSettingGuard.ruleFor(reddit, "Show mature content (I'm over 18)")?.safeChecked)
        assertEquals(true, ContentSettingGuard.ruleFor(reddit, "Blur mature (18+) images and media")?.safeChecked)
        assertNull(ContentSettingGuard.ruleFor(reddit, "Low data mode"))
        val telegram = ContentSettingGuard.RULES.getValue("org.telegram.messenger")
        assertEquals(false, ContentSettingGuard.ruleFor(telegram, "Show 18+ Content")?.safeChecked)
    }

    @Test
    fun anAgeGateBlocksOnlyBesideExplicitTerms() {
        assertEquals(
            "I am 18 or older",
            FreedomAccessibilityService.ageGateLabel("Free porn videos\nHot nude cams\nI AM 18 OR OLDER - ENTER")
        )
        // Alcohol, vape and game sites gate too.
        assertNull(FreedomAccessibilityService.ageGateLabel("Craft beer shop\nI am 18 or older - Enter"))
        assertNull(FreedomAccessibilityService.ageGateLabel("Cocktails and market analysis\nI am 18 or older"))
        assertNull(FreedomAccessibilityService.ageGateLabel("Naked Grouse whisky\nI am 18 or older"))
        assertNull(FreedomAccessibilityService.ageGateLabel("This site contains adult content: blood, gore, sexual themes."))
        assertNull(FreedomAccessibilityService.ageGateLabel(
            "Pornography (colloquially called porn) is sexually suggestive material intended for adults."))
    }

    @Test
    fun mangaPagesAreJudgedByTheirGenreTags() {
        assertTrue(MangaPages.isMangaSite("www.nelomanga.net/manga/some-title"))
        assertTrue(MangaPages.isMangaSite("asuracomic.net/series/x"))
        assertFalse(MangaPages.isMangaSite("en.wikipedia.org/wiki/Manga"))

        assertEquals("smut", MangaPages.adultGenre("Genres :\nAction\nSmut\nRomance"))
        assertEquals("adult", MangaPages.adultGenre("Genres: Action - Adult - Drama"))
        assertEquals("18+", MangaPages.adultGenre("Comedy, 18+, Slice of life"))
        assertNull(MangaPages.adultGenre("Genres: Action - Adventure - Fantasy"))
        // A word in a synopsis is not a tag.
        assertNull(MangaPages.adultGenre("A young adult hero discovers smut is not his calling."))
    }
}
