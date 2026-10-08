package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NsfwWebTest {

    private val reddit = listOf("com.reddit.frontpage")
    private val tiktok = listOf("com.zhiliaoapp.musically", "com.ss.android.ugc.trill")

    @Test
    fun appSitesAndTheirSubdomainsMap() {
        for (url in listOf("reddit.com", "www.reddit.com/r/pics", "old.reddit.com", "new.reddit.com",
            "np.reddit.com/r/x", "m.reddit.com", "redd.it/abc", "https://www.reddit.com/", "Reddit.com:443/r")) {
            assertEquals(reddit, NsfwWeb.packagesFor(url), url)
        }
        for (url in listOf("x.com/home", "twitter.com", "mobile.twitter.com/user")) {
            assertEquals(listOf("com.twitter.android"), NsfwWeb.packagesFor(url), url)
        }
        assertEquals(tiktok, NsfwWeb.packagesFor("www.tiktok.com/@user/video/1"))
        for (url in listOf("facebook.com", "m.facebook.com/groups", "web.facebook.com", "mbasic.facebook.com")) {
            assertEquals(listOf("com.facebook.katana"), NsfwWeb.packagesFor(url), url)
        }
    }

    @Test
    fun lookalikeHostsDoNotMap() {
        for (url in listOf("notreddit.com", "reddit.com.evil.net", "xcom.com", "x.com.evil.net",
            "evil.net/reddit.com", "evil.net?u=x.com", "myfacebook.com", "tiktok.co", "reddit search terms")) {
            assertEquals(emptyList(), NsfwWeb.packagesFor(url), url)
        }
    }

    @Test
    fun scansOnlyEnabledAppSitesThatAreNotWhitelisted() {
        val enabled = { pkg: String -> pkg == "com.reddit.frontpage" }

        assertTrue(NsfwWeb.shouldScan("old.reddit.com/r/x", false, enabled))
        // The user left Twitter off, so its site is not scanned either.
        assertFalse(NsfwWeb.shouldScan("x.com/home", false, enabled))
        assertFalse(NsfwWeb.shouldScan("reddit.com", true, enabled), "a whitelisted page is never scanned")
        assertFalse(NsfwWeb.shouldScan(null, false, enabled), "an unreadable URL bar decides nothing")
        assertFalse(NsfwWeb.shouldScan("", false, enabled))
        assertFalse(NsfwWeb.shouldScan("example.com", false, enabled))
    }

    @Test
    fun eitherTikTokPackageEnablesTheSite() {
        assertTrue(NsfwWeb.shouldScan("tiktok.com", false) { it == "com.ss.android.ugc.trill" })
        assertTrue(NsfwWeb.shouldScan("tiktok.com", false) { it == "com.zhiliaoapp.musically" })
    }
}
