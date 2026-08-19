package expo.modules.freedomaccessibility

import android.os.SystemClock

/**
 * Caches the installed-app list so repeated getInstalledApps() calls do not pay
 * one PackageManager IPC per launcher activity. Entries expire after TTL_MS and
 * are dropped outright when a package is installed or removed.
 */
object InstalledAppsCache {

    const val TTL_MS = 5 * 60 * 1000L

    @Volatile
    private var apps: List<Map<String, String>>? = null

    @Volatile
    private var loadedAt = 0L

    @Volatile
    private var generation = 0

    fun invalidate() {
        apps = null
        generation++
    }

    /**
     * Return the cached list if it is still within the TTL, otherwise call
     * [load] and cache the result. The elapsed-realtime clock is used so a
     * backward wall-clock jump cannot pin the cache.
     */
    fun get(
        now: Long = SystemClock.elapsedRealtime(),
        load: () -> List<Map<String, String>>
    ): List<Map<String, String>> {
        val cached = apps
        if (cached != null && now - loadedAt < TTL_MS) return cached
        // ponytail: concurrent misses can both load; the loser just overwrites
        // with an equally fresh list. Add a lock only if the IPC cost of a
        // double load ever shows up.
        val generationAtLoad = generation
        val fresh = load()
        // An invalidation that landed mid-load means this list predates it.
        if (generationAtLoad == generation) {
            apps = fresh
            loadedAt = now
        }
        return fresh
    }
}
