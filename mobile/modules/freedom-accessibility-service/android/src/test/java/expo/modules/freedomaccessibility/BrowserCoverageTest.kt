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

        assertEquals(listOf("com.facebook.katana"), ReelsDetector.shortVideoPackages("m.facebook.com/reel/123"))
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
        assertTrue(ReelsDetector.shortVideoPackages("facebook.com/someone/videos/1").isEmpty())
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

    @Test
    fun youtubeShortsFeedIsATallRecyclerUnderAnExactShortsLabel() {
        val yt = "com.google.android.youtube"
        assertTrue(ReelsDetector.isReelsFeedContainer("androidx.recyclerview.widget.RecyclerView", yt, "Shorts", 1800, 2400))
        // A filter chip bar is a short horizontal list.
        assertFalse(ReelsDetector.isReelsFeedContainer("androidx.recyclerview.widget.RecyclerView", yt, "Shorts", 120, 2400))
        // Video titles and "Watch later" match the keyword search, not the label.
        assertFalse(ReelsDetector.isReelsFeedContainer("androidx.recyclerview.widget.RecyclerView", yt, "Basketball shorts review", 1800, 2400))
        assertFalse(ReelsDetector.isReelsFeedContainer("androidx.recyclerview.widget.RecyclerView", yt, "Watch later", 1800, 2400))
        assertFalse(ReelsDetector.isReelsFeedContainer("android.widget.LinearLayout", yt, "Shorts", 1800, 2400))
    }

    @Test
    fun otherAppsKeepTheirReelsContainerRules() {
        assertTrue(ReelsDetector.isReelsFeedContainer("androidx.viewpager.widget.ViewPager", "com.instagram.android", "Reels", 100, 2400))
        assertTrue(ReelsDetector.isReelsFeedContainer("androidx.recyclerview.widget.RecyclerView", "com.facebook.katana", "Reel", 100, 2400))
        assertFalse(ReelsDetector.isReelsFeedContainer("androidx.recyclerview.widget.RecyclerView", "com.instagram.android", "Reels", 1800, 2400))
    }
}
