package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BrowserCoverageTest {

    @Test
    fun shortVideoUrlsMapToTheirApps() {
        val youtube = listOf("com.google.android.youtube")
        assertEquals(youtube, ReelsDetector.shortVideoPackages("youtube.com/shorts/abc123"))
        assertEquals(youtube, ReelsDetector.shortVideoPackages("m.youtube.com/shorts/abc123?feature=share"))
        assertEquals(youtube, ReelsDetector.shortVideoPackages("https://www.youtube.com/shorts"))

        val instagram = listOf("com.instagram.android")
        assertEquals(instagram, ReelsDetector.shortVideoPackages("instagram.com/reel/Cx1/"))
        assertEquals(instagram, ReelsDetector.shortVideoPackages("instagram.com/reels/Cx1"))
        assertEquals(instagram, ReelsDetector.shortVideoPackages("www.instagram.com/reels"))
        assertEquals(instagram, ReelsDetector.shortVideoPackages("instagram.com/someone/reel/Cx1/"))
        assertEquals(instagram, ReelsDetector.shortVideoPackages("instagram.com/someone/reels/"))

        assertEquals(listOf("com.facebook.katana"), ReelsDetector.shortVideoPackages("m.facebook.com/reel/123"))
        assertEquals(listOf("com.facebook.katana"), ReelsDetector.shortVideoPackages("www.facebook.com/reels/"))
        val snapchat = listOf("com.snapchat.android")
        assertEquals(snapchat, ReelsDetector.shortVideoPackages("www.snapchat.com/spotlight/abc"))
        assertEquals(snapchat, ReelsDetector.shortVideoPackages("snapchat.com/discover"))
        assertEquals(snapchat, ReelsDetector.shortVideoPackages("story.snapchat.com/p/abc"))
        assertEquals(
            listOf("com.zhiliaoapp.musically", "com.ss.android.ugc.trill"),
            ReelsDetector.shortVideoPackages("tiktok.com/@someone/video/1")
        )
    }

    @Test
    fun ordinaryPagesOfTheSameSitesAreNotShortVideo() {
        // Blocking reels must not take the rest of the site with it.
        assertTrue(ReelsDetector.shortVideoPackages("youtube.com/watch?v=abc").isEmpty())
        assertTrue(ReelsDetector.shortVideoPackages("youtube.com/results?search_query=shorts").isEmpty())
        assertTrue(ReelsDetector.shortVideoPackages("youtube.com").isEmpty())
        assertTrue(ReelsDetector.shortVideoPackages("instagram.com/someone").isEmpty())
        assertTrue(ReelsDetector.shortVideoPackages("instagram.com/p/Cx1").isEmpty())
        assertTrue(ReelsDetector.shortVideoPackages("instagram.com/someone/p/Cx1").isEmpty())
        assertTrue(ReelsDetector.shortVideoPackages("facebook.com/someone/videos/1").isEmpty())
        assertTrue(ReelsDetector.shortVideoPackages("web.snapchat.com").isEmpty())
        assertTrue(ReelsDetector.shortVideoPackages("snapchat.com/add/someone").isEmpty())
    }

    @Test
    fun lookalikeHostsAreNotShortVideo() {
        assertTrue(ReelsDetector.shortVideoPackages("notyoutube.com/shorts/abc").isEmpty())
        assertTrue(ReelsDetector.shortVideoPackages("youtube.com.example.org/shorts/abc").isEmpty())
        assertTrue(ReelsDetector.shortVideoPackages("example.com/youtube.com/shorts/abc").isEmpty())
    }

    @Test
    fun webShortsAreBlockedOnlyForAppsWhoseReelsAreEnabled() {
        val detector = ReelsDetector()
        assertEquals(null, detector.enabledAppForUrl("youtube.com/shorts/abc"))

        detector.updateConfigs(listOf(ReelsDetector.ReelsAppConfig("YouTube", "com.google.android.youtube", emptyList())))

        assertEquals("YouTube", detector.enabledAppForUrl("m.youtube.com/shorts/abc")?.name)
        assertEquals(null, detector.enabledAppForUrl("instagram.com/reel/abc"))
    }

    @Test
    fun searchImageAndVideoVerticalsAreRecognised() {
        assertTrue(BrowserUrlMonitor.isSearchMediaVertical("google.com/search?q=x&tbm=isch"))
        assertTrue(BrowserUrlMonitor.isSearchMediaVertical("https://www.google.co.uk/search?tbm=vid&q=x"))
        assertTrue(BrowserUrlMonitor.isSearchMediaVertical("google.com/search?q=x&udm=2"))
        assertTrue(BrowserUrlMonitor.isSearchMediaVertical("google.de/search?udm=7&q=x"))
        assertTrue(BrowserUrlMonitor.isSearchMediaVertical("bing.com/images/search?q=x"))
        assertTrue(BrowserUrlMonitor.isSearchMediaVertical("www.bing.com/videos/search?q=x"))
        assertTrue(BrowserUrlMonitor.isSearchMediaVertical("duckduckgo.com/?q=x&ia=images"))
        assertTrue(BrowserUrlMonitor.isSearchMediaVertical("duckduckgo.com/?q=x&iax=videos&ia=videos"))
    }

    @Test
    fun webSearchAndOtherSitesAreNotMediaVerticals() {
        assertFalse(BrowserUrlMonitor.isSearchMediaVertical("google.com/search?q=x"))
        assertFalse(BrowserUrlMonitor.isSearchMediaVertical("google.com/search?q=x&udm=14"))
        assertFalse(BrowserUrlMonitor.isSearchMediaVertical("bing.com/search?q=images"))
        assertFalse(BrowserUrlMonitor.isSearchMediaVertical("duckduckgo.com/?q=x&ia=web"))
        // The parameter on another site, or as a query value, is not a vertical.
        assertFalse(BrowserUrlMonitor.isSearchMediaVertical("example.com/search?tbm=isch"))
        assertFalse(BrowserUrlMonitor.isSearchMediaVertical("google.com/search?q=tbm=isch"))
        assertFalse(BrowserUrlMonitor.isSearchMediaVertical("example.com/images/x"))
    }

    private val recycler = "androidx.recyclerview.widget.RecyclerView"

    /** The ancestor walk in hasScrollableReelsAncestor, nearest ancestor first. */
    private fun inReelsFeed(pkg: String, label: String?, vararg ancestors: Triple<String, Boolean, Int>): Boolean =
        ancestors.firstNotNullOfOrNull { (cls, scrollable, height) ->
            ReelsDetector.reelsAncestorVerdict(cls, scrollable, pkg, label, height, 2400)
        } ?: false

    @Test
    fun youtubeShortsFeedIsATallRecyclerUnderAnExactShortsLabel() {
        val yt = "com.google.android.youtube"
        val tallFeed = Triple(recycler, true, 1800)
        val chipBar = Triple(recycler, true, 120)
        assertTrue(inReelsFeed(yt, "Shorts", tallFeed))
        assertFalse(inReelsFeed(yt, "Shorts", chipBar))
        // Video titles and "Watch later" match the keyword search, not the label.
        assertFalse(inReelsFeed(yt, "Basketball shorts review", tallFeed))
        assertFalse(inReelsFeed(yt, "Watch later", tallFeed))
        assertFalse(inReelsFeed(yt, "Shorts", Triple("android.widget.LinearLayout", true, 1800)))
        assertFalse(inReelsFeed(yt, "Shorts", Triple(recycler, false, 1800)))
    }

    @Test
    fun theNearestYoutubeListDecidesNotAnOuterOne() {
        val yt = "com.google.android.youtube"
        val layout = Triple("android.widget.FrameLayout", false, 300)
        // A "Shorts" chip in a horizontal list nested in the tall home feed.
        assertFalse(inReelsFeed(yt, "Shorts", layout, Triple(recycler, true, 120), layout, Triple(recycler, true, 1800)))
        // The shelf header's nearest list is the tall feed itself.
        assertTrue(inReelsFeed(yt, "Shorts", layout, Triple(recycler, false, 400), Triple(recycler, true, 1800)))
    }

    @Test
    fun otherAppsKeepTheirReelsContainerRules() {
        val pager = Triple("androidx.viewpager.widget.ViewPager", true, 100)
        assertTrue(inReelsFeed("com.instagram.android", "Reels", pager))
        assertTrue(ReelsDetector.isFacebookReelViewerLabel("Reels tab details"))
        assertTrue(ReelsDetector.isFacebookReelViewerLabel("Navigate to your Reels profile"))
        assertTrue(ReelsDetector.isFacebookReelViewerLabel("View Riya Verma's reels"))
        assertFalse(ReelsDetector.isFacebookReelViewerLabel("Reels tab"))
        assertFalse(ReelsDetector.isFacebookReelViewerLabel("Selected Reels tab"))
        assertFalse(ReelsDetector.isFacebookReelViewerLabel("See more reels"))
        assertFalse(ReelsDetector.isFacebookReelViewerLabel("TOK Videos's story, Unseen"))
        // Facebook's home feed holds Reels/Stories labels in lists and pagers.
        assertFalse(inReelsFeed("com.facebook.katana", "Reels", Triple(recycler, true, 100)))
        assertFalse(inReelsFeed("com.facebook.katana", "Reels", pager))
        assertFalse(inReelsFeed("com.instagram.android", "Reels", Triple(recycler, true, 1800)))
        // Instagram still climbs past a list to the pager around it.
        assertTrue(inReelsFeed("com.instagram.android", "Reels", Triple(recycler, true, 1800), pager))
    }

    private val wiki: (String) -> Boolean = { it == "wikipedia.org" }

    @Test
    fun aWhitelistedUrlBarSetsThePageContextAndIsRemembered() {
        val (context, memory) = PageWhitelist.resolve("org.mozilla.firefox", "wikipedia.org/wiki/x", wiki, null, 1_000)

        assertEquals("wikipedia.org", context)
        assertEquals(PageWhitelist.Memory("org.mozilla.firefox", "wikipedia.org", 1_000), memory)
    }

    @Test
    fun anUnreadableUrlBarInheritsTheRememberedDomainWithinTheTtl() {
        // Chrome hides its toolbar while scrolling; page text must not clear this.
        val remembered = PageWhitelist.Memory("com.android.chrome", "wikipedia.org", 1_000)

        val (context, memory) = PageWhitelist.resolve("com.android.chrome", null, { false }, remembered, 20_000)
        assertEquals("wikipedia.org", context)
        assertEquals(PageWhitelist.Memory("com.android.chrome", "wikipedia.org", 20_000), memory)
    }

    @Test
    fun continuousUnreadableEventsKeepInheritingPastTheTtl() {
        // A long read of a whitelisted page with the toolbar hidden must not lose it.
        var memory: PageWhitelist.Memory? = PageWhitelist.Memory("com.android.chrome", "wikipedia.org", 0)
        for (now in 10_000L..120_000L step 10_000L) {
            val (context, next) = PageWhitelist.resolve("com.android.chrome", null, { false }, memory, now)
            assertEquals("wikipedia.org", context)
            memory = next
        }
    }

    @Test
    fun aGapLongerThanTheTtlWithNoEventsStopsInheriting() {
        val remembered = PageWhitelist.Memory("com.android.chrome", "wikipedia.org", 1_000)

        val expired = PageWhitelist.resolve("com.android.chrome", null, { false }, remembered, 1_000 + PageWhitelist.TTL_MS)
        assertEquals(null to null, expired)
    }

    @Test
    fun anotherPackagesEventDropsTheMemory() {
        val remembered = PageWhitelist.Memory("com.android.chrome", "wikipedia.org", 1_000)

        assertEquals(null to null, PageWhitelist.resolve("org.mozilla.firefox", null, { false }, remembered, 2_000))
    }

    @Test
    fun aNonWhitelistedUrlBarValueClearsTheMemory() {
        val remembered = PageWhitelist.Memory("com.android.chrome", "wikipedia.org", 1_000)

        assertEquals(null to null, PageWhitelist.resolve("com.android.chrome", "example.com/x", wiki, remembered, 2_000))
        // A typed search term or omnibox edit is a value without a site, not an unreadable bar.
        assertEquals(null to null, PageWhitelist.resolve("com.android.chrome", "some search", wiki, remembered, 2_000))
        assertEquals(null to null, PageWhitelist.resolve("com.android.chrome", "wikipedia", wiki, remembered, 2_000))
    }
}
