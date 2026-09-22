# Native Config Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the VPN category blocklist, the reels detector configs, and the NSFW monitored-app list survive a service restart or app update, instead of being silently skipped or dropped.

**Architecture:** Three independent defects, each fixed where its data is owned. The VPN stops gating its disk load on an unrelated counter. The reels detector and the NSFW app list gain the same optional-`Context` persistence every sibling setter in this codebase already uses, backed by the existing SharedPreferences files, and are restored in `onServiceConnected`.

**Tech Stack:** Kotlin, Android, Expo native modules, JUnit + kotlin-test on the JVM (no Robolectric), Gradle.

**Spec:** `docs/superpowers/specs/2026-09-20-native-config-durability-design.md`

## Global Constraints

- Module under test runs via `cd mobile/android && ./gradlew :<module>:testDebugUnitTest`.
- No new third-party runtime dependencies. `org.json` is already available at runtime on Android; on the JVM test classpath it needs an explicit `testImplementation` (see Task 2 Step 1).
- Never use emojis anywhere, including code, comments, and commit messages.
- No co-author trailers or AI attribution in commit messages.
- Keep comments minimal: explain why, never what.
- Match the surrounding code style. Optional-`Context` config setters in this codebase take `context: Context? = null` as the LAST parameter and persist only when it is non-null.
- Do not reformat or "improve" adjacent code. Every changed line must trace to this plan.
- Do not push. Commit locally only.

---

### Task 1: VPN loads its blocklist from disk unconditionally

**Files:**
- Modify: `mobile/modules/freedom-vpn-service/android/src/main/java/expo/modules/freedomvpn/FreedomVpnService.kt:526-530`
- Test: `mobile/modules/freedom-vpn-service/android/src/test/java/expo/modules/freedomvpn/BlocklistPersistenceTest.kt`

**Interfaces:**
- Consumes: `BlocklistPersistence.load(root: File, blocklist: DomainBlocklist)` (internal, already used by this test file), `DomainBlocklist.setDomains`, `DomainBlocklist.isBlocked`.
- Produces: nothing new. Behaviour change only.

**Context for the implementer:** `FreedomVpnService.onStartCommand` currently calls `BlocklistPersistence.load` only when `blocklist.size() == 0`. `size()` sums user domains AND every category, so a JS push of a few user URLs makes it non-zero and the categories never load into that tunnel. The gate existed to stop the disk copy overwriting a live JS push; that is now handled inside `load` by `setDomainsIfAbsent`, `setWhitelistIfAbsent` and `putCategoryIfAbsent`. The test below pins the property that makes removing the gate safe.

- [ ] **Step 1: Write the failing test**

Add to `BlocklistPersistenceTest.kt`:

```kotlin
    @Test
    fun categoriesStillLoadWhenUserDomainsWerePushedFirst() {
        // The service used to skip the disk load whenever the blocklist was
        // non-empty, so a JS push of a handful of user URLs cost it every
        // category domain. Loading must be safe to call unconditionally.
        val dir = tempDir("gate")
        BlocklistPersistence.saveCategory(dir, "adult", listOf("category-domain.com"), replace = true)

        val blocklist = DomainBlocklist()
        blocklist.setDomains(listOf("user-added.com"))

        BlocklistPersistence.load(dir, blocklist)

        assertTrue(blocklist.isBlocked("category-domain.com"), "category must load")
        assertTrue(blocklist.isBlocked("user-added.com"), "JS push must survive")
    }
```

If `BlocklistPersistenceTest.kt` has no `tempDir` helper, use whatever temp-directory pattern the existing tests in that file already use, and follow their cleanup.

- [ ] **Step 2: Run the test to confirm it passes against current `load`**

Run: `cd mobile/android && ./gradlew :freedom-vpn-service:testDebugUnitTest --tests '*BlocklistPersistenceTest*'`
Expected: PASS. This test documents why the gate can go; it is green before and after. If it FAILS, stop and report — the premise for Step 3 is wrong.

- [ ] **Step 3: Remove the gate**

In `FreedomVpnService.kt`, replace:

```kotlin
        // Before the tunnel exists: a watchdog or boot start has no JS behind it
        // to fill the list.
        if (blocklist.size() == 0) {
            BlocklistPersistence.load(this, blocklist)
        }
```

with:

```kotlin
        // Before the tunnel exists: a watchdog or boot start has no JS behind it
        // to fill the list. Unconditional because size() counts user domains too,
        // so gating on it cost this tunnel every category whenever JS had pushed
        // a single URL first. The *IfAbsent installers inside load() are what
        // keep a live JS push from being overwritten.
        BlocklistPersistence.load(this, blocklist)
```

- [ ] **Step 4: Run the whole module's tests**

Run: `cd mobile/android && ./gradlew :freedom-vpn-service:testDebugUnitTest`
Expected: PASS, no failures.

- [ ] **Step 5: Commit**

```bash
git add mobile/modules/freedom-vpn-service/android/src/main/java/expo/modules/freedomvpn/FreedomVpnService.kt mobile/modules/freedom-vpn-service/android/src/test/java/expo/modules/freedomvpn/BlocklistPersistenceTest.kt
git commit -m "Load the VPN blocklist from disk even when JS pushed first

size() counts user domains as well as categories, so a tunnel starting
after any JS push skipped its disk load and ran without the ~500k
category domains. The IfAbsent installers already stop the disk copy
overwriting a live push, so the gate only cost coverage."
```

---

### Task 2: Reels configs survive a service restart

**Files:**
- Modify: `mobile/modules/freedom-accessibility-service/android/build.gradle`
- Modify: `mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/ReelsDetector.kt`
- Modify: `mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/FreedomAccessibilityService.kt` (in `onServiceConnected`, next to the existing `browserMonitor.loadPersistedConfigs(this)` call)
- Modify: `mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/FreedomAccessibilityModule.kt` (the `updateReelsConfigs` AsyncFunction)
- Create: `mobile/modules/freedom-accessibility-service/android/src/test/java/expo/modules/freedomaccessibility/ReelsDetectorTest.kt`

**Interfaces:**
- Produces, on `ReelsDetector`:
  - `fun updateConfigs(configs: List<ReelsAppConfig>, context: Context? = null)` — existing function, gains the trailing parameter.
  - `fun loadPersistedConfigs(context: Context)`
  - `companion object { fun serializeConfigs(configs: List<ReelsAppConfig>): String; fun parseConfigs(json: String?): List<ReelsAppConfig> }`
- `ReelsAppConfig` is the existing nested data class: `ReelsDetector.ReelsAppConfig(name: String, packageName: String, detectionNodes: List<String>)`.
- Prefs file `freedom_settings` (same file `BankingModeManager` and the overlay theme use), new key `reels_configs`.

- [ ] **Step 1: Give the module's JVM tests org.json and Android stubs**

`ReelsDetector` calls `android.util.Log` and the new code uses `org.json`. The sibling module already does this; mirror it. In `mobile/modules/freedom-accessibility-service/android/build.gradle`, inside the existing `android { }` block add:

```groovy
    testOptions {
        unitTests.returnDefaultValues = true
    }
```

and inside the existing `dependencies { }` block add:

```groovy
    testImplementation "org.json:json:20240303"
```

Reference: `mobile/modules/freedom-foreground-service/android/build.gradle:13-14` and `:40`.

- [ ] **Step 2: Write the failing test**

Create `ReelsDetectorTest.kt`:

```kotlin
package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReelsDetectorTest {

    private fun config(pkg: String, vararg nodes: String) =
        ReelsDetector.ReelsAppConfig(name = pkg, packageName = pkg, detectionNodes = nodes.toList())

    @Test
    fun configsSurviveASerializeParseRoundTrip() {
        // Android destroys the accessibility service on every app update, so a
        // memory-only config list means reels blocking silently stops until JS
        // happens to push again.
        val configs = listOf(
            config("com.instagram.android", "clips_viewer_view_pager", "reels_tray"),
            config("com.google.android.youtube", "reel_recycler"),
        )

        val restored = ReelsDetector.parseConfigs(ReelsDetector.serializeConfigs(configs))

        assertEquals(2, restored.size)
        assertEquals("com.instagram.android", restored[0].packageName)
        assertEquals(listOf("clips_viewer_view_pager", "reels_tray"), restored[0].detectionNodes)
        assertEquals(listOf("reel_recycler"), restored[1].detectionNodes)
    }

    @Test
    fun configsWithNoDetectionNodesRoundTrip() {
        val restored = ReelsDetector.parseConfigs(ReelsDetector.serializeConfigs(listOf(config("com.x.app"))))

        assertEquals(1, restored.size)
        assertTrue(restored[0].detectionNodes.isEmpty())
    }

    @Test
    fun malformedStoredDataYieldsNothingInsteadOfThrowing() {
        // This parse runs inside onServiceConnected; throwing there would take
        // down the whole accessibility layer, not just reels detection.
        assertTrue(ReelsDetector.parseConfigs(null).isEmpty())
        assertTrue(ReelsDetector.parseConfigs("").isEmpty())
        assertTrue(ReelsDetector.parseConfigs("not json").isEmpty())
        assertTrue(ReelsDetector.parseConfigs("[{}]").isEmpty())
    }
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd mobile/android && ./gradlew :freedom-accessibility-service:testDebugUnitTest --tests '*ReelsDetectorTest*'`
Expected: FAIL — `serializeConfigs` / `parseConfigs` unresolved.

- [ ] **Step 4: Implement persistence in ReelsDetector**

Add the imports `android.content.Context`, `org.json.JSONArray`, `org.json.JSONObject`.

Change `updateConfigs` to take the context and persist:

```kotlin
    fun updateConfigs(configs: List<ReelsAppConfig>, context: Context? = null) {
        // Drop-then-add would leave a window where a reader sees no reels apps at all.
        reelsApps.keys.retainAll(configs.map { it.packageName }.toSet())
        configs.forEach { config ->
            reelsApps[config.packageName] = config
        }
        Log.i(TAG, "Updated reels configs: ${reelsApps.keys}")
        context?.let { persistConfigs(it, configs) }
    }

    /** Restore after a service restart; Android destroys this service on app update. */
    fun loadPersistedConfigs(context: Context) {
        val stored = try {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_REELS_CONFIGS, null)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read reels configs: ${e.message}")
            null
        }
        val configs = parseConfigs(stored)
        if (configs.isEmpty()) return
        configs.forEach { config -> reelsApps[config.packageName] = config }
        Log.i(TAG, "Restored reels configs: ${reelsApps.keys}")
    }

    private fun persistConfigs(context: Context, configs: List<ReelsAppConfig>) {
        try {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_REELS_CONFIGS, serializeConfigs(configs))
                .apply()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to persist reels configs: ${e.message}")
        }
    }
```

Add to the existing `companion object` (which already holds `TAG`):

```kotlin
        private const val PREFS_NAME = "freedom_settings"
        private const val KEY_REELS_CONFIGS = "reels_configs"

        fun serializeConfigs(configs: List<ReelsAppConfig>): String {
            val array = JSONArray()
            configs.forEach { config ->
                array.put(
                    JSONObject().apply {
                        put("name", config.name)
                        put("packageName", config.packageName)
                        put("detectionNodes", JSONArray(config.detectionNodes))
                    }
                )
            }
            return array.toString()
        }

        fun parseConfigs(json: String?): List<ReelsAppConfig> {
            if (json.isNullOrBlank()) return emptyList()
            return try {
                val array = JSONArray(json)
                val out = ArrayList<ReelsAppConfig>(array.length())
                for (i in 0 until array.length()) {
                    val obj = array.optJSONObject(i) ?: continue
                    val packageName = obj.optString("packageName")
                    if (packageName.isNullOrBlank()) continue
                    val nodes = obj.optJSONArray("detectionNodes")
                    val detectionNodes = if (nodes == null) {
                        emptyList()
                    } else {
                        (0 until nodes.length()).mapNotNull { nodes.optString(it).takeIf { s -> s.isNotBlank() } }
                    }
                    out.add(
                        ReelsAppConfig(
                            name = obj.optString("name"),
                            packageName = packageName,
                            detectionNodes = detectionNodes,
                        )
                    )
                }
                out
            } catch (e: Exception) {
                Log.w(TAG, "Failed to parse reels configs: ${e.message}")
                emptyList()
            }
        }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mobile/android && ./gradlew :freedom-accessibility-service:testDebugUnitTest --tests '*ReelsDetectorTest*'`
Expected: PASS, 3 tests.

- [ ] **Step 6: Restore on service connect**

In `FreedomAccessibilityService.onServiceConnected`, find the existing call that restores the browser configs — it reads `browserMonitor.loadPersistedConfigs(this)`. Immediately after it, add:

```kotlin
        reelsDetector.loadPersistedConfigs(this)
```

Use whatever the local property for the detector is actually named in that file (it is the instance published to `sharedReelsDetector`). Do not rename anything.

- [ ] **Step 7: Pass the context from the module**

In `FreedomAccessibilityModule.kt`, the `updateReelsConfigs` AsyncFunction calls `FreedomAccessibilityService.sharedReelsDetector?.updateConfigs(reelsConfigs)`. Change that call to pass the context so the write happens:

```kotlin
                FreedomAccessibilityService.sharedReelsDetector?.updateConfigs(
                    reelsConfigs,
                    appContext.reactContext,
                )
```

If that block has an else-branch that builds a throwaway `ReelsDetector`, make it persist too by passing the context, so a push that arrives while the service is down is not lost:

```kotlin
                    ?: appContext.reactContext?.let { context ->
                        ReelsDetector().updateConfigs(reelsConfigs, context)
                    }
```

Read the surrounding code and match its existing null-handling shape rather than pasting this verbatim if it does not fit.

- [ ] **Step 8: Run the whole module's tests**

Run: `cd mobile/android && ./gradlew :freedom-accessibility-service:testDebugUnitTest`
Expected: PASS, no failures. Confirms Step 1's gradle change did not break the existing tests.

- [ ] **Step 9: Commit**

```bash
git add mobile/modules/freedom-accessibility-service/android/build.gradle mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/ReelsDetector.kt mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/FreedomAccessibilityService.kt mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/FreedomAccessibilityModule.kt mobile/modules/freedom-accessibility-service/android/src/test/java/expo/modules/freedomaccessibility/ReelsDetectorTest.kt
git commit -m "Persist reels configs so they survive a service restart

updateConfigs only ever wrote a ConcurrentHashMap, and Android destroys
the accessibility service on every app update, so reels blocking stopped
until JS happened to push again."
```

---

### Task 3: NSFW monitored apps survive a service restart

**Files:**
- Modify: `mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/ContentMatcher.kt` (`setNsfwMonitoredApps`, `loadPersistedData`, the `companion object` keys)
- Modify: `mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/FreedomAccessibilityModule.kt` (the `updateNsfwMonitoredApps` AsyncFunction)
- Create: `mobile/modules/freedom-accessibility-service/android/src/test/java/expo/modules/freedomaccessibility/ContentMatcherNsfwTest.kt`

**Interfaces:**
- Consumes from Task 2: the `testOptions` / `org.json` test setup added to this module's `build.gradle`. If Task 2 has not run yet, add it first exactly as Task 2 Step 1 describes.
- Produces on `ContentMatcher`: `fun setNsfwMonitoredApps(packages: Collection<String>, context: Context? = null)`. Existing single-argument call sites keep compiling.
- Reuses the existing private helpers `persistData(context, key, set)` and `loadSet(context, key, set)` in the same class. Do not write new prefs plumbing.

- [ ] **Step 1: Write the failing test**

Create `ContentMatcherNsfwTest.kt`:

```kotlin
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
```

- [ ] **Step 2: Run it and confirm both tests pass**

Run: `cd mobile/android && ./gradlew :freedom-accessibility-service:testDebugUnitTest --tests '*ContentMatcherNsfwTest*'`
Expected: PASS, 2 tests.

These two are regression guards, not red tests. Normalization and replacement both work today: `setNsfwMonitoredApps` calls `retainAll(normalized)` FIRST, against the old contents, so `{com.first.app}.retainAll({com.second.app})` really does empty the set before `addAll` refills it. An earlier draft of this plan claimed removal was broken; that was wrong, and the tests exist to keep it working through Step 3's edit.

The defect this task actually fixes is the missing persistence, which no JVM test can cover (it needs an Android `Context`). Task 4 Step 5 is what verifies it.

If the run errors with "not mocked" or a missing `org.json` class, apply Task 2 Step 1 first, then re-run.

- [ ] **Step 3: Fix the setter and persist**

Replace `setNsfwMonitoredApps` with:

```kotlin
    fun setNsfwMonitoredApps(packages: Collection<String>, context: Context? = null) {
        // Add before retaining: retaining first empties the set for an instant,
        // which is the window the comment here used to claim it avoided.
        val normalized = packages.map { it.trim().lowercase() }.toSet()
        nsfwMonitoredApps.addAll(normalized)
        nsfwMonitoredApps.retainAll(normalized)
        Log.i("ContentMatcher", "Updated NSFW monitored apps: ${nsfwMonitoredApps.size}")
        context?.let { persistData(it, KEY_NSFW_APPS, nsfwMonitoredApps) }
    }
```

The persistence is the point of this change. The reordering is a small extra: swapping the two calls keeps a concurrent reader on the accessibility thread from ever observing an empty set, which the original comment claimed but the original order did not deliver. Both tests from Step 1 must still pass afterwards.

Add the key to the `companion object`, next to the existing keys:

```kotlin
        private const val KEY_NSFW_APPS = "nsfw_monitored_apps"
```

In `loadPersistedData`, next to the existing `loadSet(context, KEY_INCLUDED_DOMAINS, includedDomains)` call, add:

```kotlin
        loadSet(context, KEY_NSFW_APPS, nsfwMonitoredApps)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile/android && ./gradlew :freedom-accessibility-service:testDebugUnitTest --tests '*ContentMatcherNsfwTest*'`
Expected: PASS, 2 tests.

- [ ] **Step 5: Pass the context from the module**

In `FreedomAccessibilityModule.kt`, `updateNsfwMonitoredApps` currently calls the matcher without a context, and its else-branch mutates a throwaway `ContentMatcher()` whose state is discarded. Pass the context in the service branch:

```kotlin
                    matcher.setNsfwMonitoredApps(packages, appContext.reactContext)
```

and make the else-branch use the shared fallback matcher, matching how the sibling functions in this file already do it:

```kotlin
                    appContext.reactContext?.let { context ->
                        getOrCreateFallbackMatcher(context).setNsfwMonitoredApps(packages, context)
                    }
```

Read the surrounding functions and match their exact null-handling and promise-resolution shape.

- [ ] **Step 6: Run the whole module's tests**

Run: `cd mobile/android && ./gradlew :freedom-accessibility-service:testDebugUnitTest`
Expected: PASS, no failures.

- [ ] **Step 7: Commit**

```bash
git add mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/ContentMatcher.kt mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/FreedomAccessibilityModule.kt mobile/modules/freedom-accessibility-service/android/src/test/java/expo/modules/freedomaccessibility/ContentMatcherNsfwTest.kt
git commit -m "Persist NSFW monitored apps across service restarts

setNsfwMonitoredApps took no context and wrote nothing, so the list was
empty after every service restart. Also swapped retainAll and addAll so a
concurrent reader never observes the momentarily empty set."
```

---

### Task 4: On-device verification

**Files:** none. This task runs the app and reads logs.

**Interfaces:** Consumes the three fixes above.

**Context for the implementer:** a device is attached over adb. The installed app is NOT debuggable, so `run-as` will not work. Android disables an app's accessibility service when the package is replaced, so it must be re-enabled after every install.

- [ ] **Step 1: Build and install**

```bash
cd mobile/android && ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```
Expected: `BUILD SUCCESSFUL`, then `Success`.

- [ ] **Step 2: Re-enable the accessibility service**

```bash
adb shell settings put secure enabled_accessibility_services "com.libreascent.app/expo.modules.freedomaccessibility.FreedomAccessibilityService"
adb shell settings put secure accessibility_enabled 1
adb shell settings get secure enabled_accessibility_services
```
Expected: the component name is echoed back.

- [ ] **Step 3: Launch and confirm the blocklist still loads**

```bash
adb logcat -c
adb shell monkey -p com.libreascent.app -c android.intent.category.LAUNCHER 1
timeout 120 adb logcat -s ContentMatcher:I MappedDomainIndex:I | grep -m2 -E "Mapped category|Loaded persisted data"
```
Expected: a `Mapped category 'adult'` line with a domain count in the hundreds of thousands, and a `Loaded persisted data` line.

- [ ] **Step 4: Confirm both blocking layers still work**

```bash
adb shell ping -c 1 -W 2 pornhub.com
adb shell ping -c 1 -W 2 example.com
```
Expected: `unknown host pornhub.com`, and `example.com` resolving normally.

```bash
adb shell am force-stop org.mozilla.firefox
adb shell am start -a android.intent.action.VIEW -d "https://pornhub.com"
timeout 45 adb logcat -s ContentMatcher:W | grep -m1 -i blocked
```
Expected: `URL domain blocked: pornhub.com`.

- [ ] **Step 5: Confirm the reels config survives a service restart**

Toggle the accessibility service off and on, which is what an app update does to it:

```bash
adb logcat -c
adb shell settings put secure enabled_accessibility_services ""
adb shell settings put secure enabled_accessibility_services "com.libreascent.app/expo.modules.freedomaccessibility.FreedomAccessibilityService"
timeout 90 adb logcat -s ReelsDetector:I ContentMatcher:I | grep -m2 -E "Restored reels configs|Loaded persisted data"
```
Expected: a `Restored reels configs` line listing package names. If it is absent because JS never pushed reels configs on this device, open the app's reels blocking screen once, re-run this step, and say so in the report rather than claiming the step passed.

- [ ] **Step 6: Report the measured results**

Report what each step actually printed. If any expectation did not hold, report the discrepancy rather than moving on.

---

## Notes

- Task 1 is independent. Tasks 2 and 3 both touch `FreedomAccessibilityModule.kt` and this module's `build.gradle`, so run them in order, not in parallel.
- The blocklist on the attached device was truncated to roughly 506k-522k domains during earlier debugging (interrupted syncs). Running a blocklist update in the app restores it from the SQLite cache. That is unrelated to these fixes.
