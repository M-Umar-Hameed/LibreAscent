package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ContentMatcherNsfwTest {

    @Test
    fun monitoredAppsMatchRegardlessOfCase() {
        val matcher = ContentMatcher()
        matcher.setNsfwMonitoredApps(listOf("  COM.Example.App  ", "com.other.app"))

        assertTrue(matcher.isNsfwMonitoredApp("com.example.app"))
        assertTrue(matcher.isNsfwMonitoredApp("COM.OTHER.APP"))
        assertFalse(matcher.isNsfwMonitoredApp("com.unmonitored.app"))
    }

    @Test
    fun replacingTheListDropsAppsThatAreNoLongerMonitored() {
        val matcher = ContentMatcher()
        matcher.setNsfwMonitoredApps(listOf("com.first.app"))
        matcher.setNsfwMonitoredApps(listOf("com.second.app"))

        assertTrue(matcher.isNsfwMonitoredApp("com.second.app"))
        assertFalse(matcher.isNsfwMonitoredApp("com.first.app"), "stale app must not keep matching")
    }
}
