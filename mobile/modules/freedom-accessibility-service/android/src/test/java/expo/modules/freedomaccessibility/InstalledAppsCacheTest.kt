package expo.modules.freedomaccessibility

import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

class InstalledAppsCacheTest {

    private var loads = 0

    private fun load(): List<Map<String, String>> {
        loads++
        return listOf(mapOf("name" to "App $loads", "packageName" to "pkg.$loads"))
    }

    @BeforeTest
    fun reset() {
        loads = 0
        InstalledAppsCache.invalidate()
    }

    @Test
    fun cachesWithinTtlAndRequeriesAfterExpiry() {
        val start = 1_000_000L

        assertEquals("pkg.1", InstalledAppsCache.get(start) { load() }.first()["packageName"])
        assertEquals(1, loads)

        // Within the TTL — reuses the cached list, no second query.
        assertEquals(
            "pkg.1",
            InstalledAppsCache.get(start + InstalledAppsCache.TTL_MS - 1) { load() }
                .first()["packageName"]
        )
        assertEquals(1, loads)

        // TTL elapsed — re-queries.
        assertEquals(
            "pkg.2",
            InstalledAppsCache.get(start + InstalledAppsCache.TTL_MS) { load() }
                .first()["packageName"]
        )
        assertEquals(2, loads)
    }

    @Test
    fun invalidationForcesRequeryWithinTtl() {
        val start = 2_000_000L

        InstalledAppsCache.get(start) { load() }
        assertEquals(1, loads)

        InstalledAppsCache.invalidate()

        assertEquals(
            "pkg.2",
            InstalledAppsCache.get(start + 1) { load() }.first()["packageName"]
        )
        assertEquals(2, loads)
    }
}
