# Native Config Durability Design

## Goal

Make three pieces of native protection state survive a service restart and an
app update: the VPN's category blocklist, the reels detector's app configs, and
the accessibility matcher's NSFW app list. All three are lost or skipped today,
each in a different way, and every one of them fails silently — protection
reports healthy while a layer does nothing.

## Scope

In scope:

- `FreedomVpnService` loading its blocklist from disk when a tunnel starts.
- `ReelsDetector` config persistence and restore.
- `ContentMatcher` NSFW monitored-app persistence and restore.

Out of scope, deliberately:

- The process split investigated alongside this work (see Background). Not
  worth its risk at the measured memory level.
- The `LocalBroadcastManager` → JS event paths, the `sharedContentMatcher`
  family of statics, and the cross-component `SharedPreferences` coupling.
  All are single-process assumptions that only matter if the split happens.
- `updateBrowserConfigs`, which already persists through
  `BrowserUrlMonitor.persistConfigs`.

## Background

This came out of a memory investigation. The app was holding two copies of the
same ~526k-domain category — one for the DNS tunnel, one for the accessibility
matcher — as `HashSet<String>`, which was most of a 138 MB Java heap and was
getting Play Services and TalkBack killed by the low-memory killer while
Firefox was open.

That is fixed: domains are now 64-bit hashes in a memory-mapped file
(`HashedDomainSet`, `MappedDomainIndex`). Measured on a Pixel 9a:

| Metric | Before | After |
| --- | --- | --- |
| Dalvik heap alloc | 96.4 MB | 22.8 MB |
| Total PSS | 305 MB | 86 MB |
| Rank among device processes | — | 24th, below Settings |

A process split was planned to cut the remaining resident memory. A subagent
confirmed a `:protect` process would not start Hermes, so the premise held —
but at 86 MB, against Instagram's 495 MB on the same device, the saving no
longer justifies rewriting six service↔module channels that all assume one
process. The split is documented and shelved.

The same investigation turned up the three durability defects below, which are
live bugs today and independent of any split.

## Defects

### D1 — VPN skips its disk load whenever JS pushed anything first

`FreedomVpnService.onStartCommand`:

```kotlin
if (blocklist.size() == 0) {
    BlocklistPersistence.load(this, blocklist)
}
```

`size()` sums the user domains and every category. A JS push of a handful of
user URLs is enough to make it non-zero, so a tunnel starting after that push
skips the disk load and runs with only those URLs — the ~500k category domains
never arrive. Blocking looks enabled and the notification counts up while the
category layer is absent.

The gate was there to stop the disk copy clobbering a live JS push. That job now
belongs to `setDomainsIfAbsent`, `setWhitelistIfAbsent` and
`putCategoryIfAbsent`, which `BlocklistPersistence.load` already calls. The gate
is redundant and harmful.

### D2 — Reels configs are memory-only

`ReelsDetector.updateConfigs` writes `reelsApps`, a `ConcurrentHashMap`, and
nothing else. There is no write to disk and no read at
`onServiceConnected`. Android destroys the accessibility service on every app
update and whenever the user toggles it, so the reels app list is empty from
then until JS happens to push it again. Reels blocking silently stops.

### D3 — NSFW monitored apps are memory-only

`ContentMatcher.setNsfwMonitoredApps` takes no `Context` and persists nothing,
unlike its siblings (`setKeywords`, `setBlockedApps`, `setWhitelist`) which all
write through `persistData`. `loadPersistedData` never restores it. Same failure
shape as D2: NSFW in-app scanning stops after a service restart.

## Design

### D1

Delete the `size()` gate and call `BlocklistPersistence.load` unconditionally.
The `*IfAbsent` installers already arbitrate: anything JS pushed before the
tunnel started wins, anything absent is filled from disk.

### D2

Persist through the existing `freedom_settings` prefs file, key `reels_configs`,
holding a JSON array of `{name, packageName, detectionNodes[]}`.

`updateConfigs` gains an optional `Context?` parameter, matching every other
config setter in this codebase (`ContentMatcher.setKeywords`,
`BrowserUrlMonitor.updateConfigs`). When present, it writes; when absent,
behaviour is exactly as today.

Serialization lives in two pure functions on the companion —
`serializeConfigs(List<ReelsAppConfig>): String` and
`parseConfigs(String?): List<ReelsAppConfig>` — so the encoding is unit-testable
without an Android `Context`. Only the thin prefs read/write touches `Context`.

`FreedomAccessibilityService.onServiceConnected` restores via
`reelsDetector.loadPersistedConfigs(this)`, alongside the existing
`browserMonitor.loadPersistedConfigs(this)` call it already makes.

### D3

`setNsfwMonitoredApps` gains an optional `Context?` and calls the existing
`persistData(context, KEY_NSFW_APPS, nsfwMonitoredApps)`. `loadPersistedData`
restores it with the existing `loadSet(context, KEY_NSFW_APPS, ...)`. New key
`nsfw_monitored_apps` in the existing `freedom_matcher_data` file.

The module passes `appContext.reactContext` at the one call site, and its
else-branch stops building a throwaway `ContentMatcher` whose state was
discarded, using `getOrCreateFallbackMatcher` like its siblings.

## Data flow

D2, after the change:

```
JS updateReelsConfigs
  -> FreedomAccessibilityModule
  -> ReelsDetector.updateConfigs(configs, context)
       -> reelsApps (memory)
       -> freedom_settings/reels_configs (JSON)

service restart
  -> onServiceConnected
  -> ReelsDetector.loadPersistedConfigs(context)
  -> reelsApps
```

## Error handling

Malformed or absent JSON yields an empty list and leaves the in-memory map
untouched; a parse failure must never take down `onServiceConnected`, which
would leave the whole accessibility layer dead. Prefs writes are best-effort and
already wrapped by `persistData`.

## Testing

Unit tests, in the modules' existing JVM test dirs:

- `DomainBlocklistTest` / `FreedomVpnServiceTest` — a category present on disk
  must reach the blocklist even when user domains were pushed first.
- `ReelsDetectorTest` (new) — round trip through `serializeConfigs` /
  `parseConfigs`, including detection-node lists, empty input, and malformed
  JSON.
- `ContentMatcherNsfwTest` (new) — `setNsfwMonitoredApps` normalizes and
  `isNsfwMonitoredApp` matches case-insensitively after a round trip.

On-device verification, since none of the above exercises a real service
restart: install, confirm DNS and URL blocking, then toggle the accessibility
service off and on and confirm reels and NSFW config survive.

## Files touched

- `mobile/modules/freedom-vpn-service/android/src/main/java/expo/modules/freedomvpn/FreedomVpnService.kt`
- `mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/ReelsDetector.kt`
- `mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/ContentMatcher.kt`
- `mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/FreedomAccessibilityService.kt`
- `mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/FreedomAccessibilityModule.kt`
- Tests alongside each.

## Future work (not in scope)

- The process split: `:protect` for the three always-on services. Confirmed to
  avoid Hermes; blocked on building an IPC layer for ~20 call surfaces, 4 event
  channels and 5 prefs files. Revisit only if the app's resident memory grows
  back toward 300 MB.
- `InstalledAppsCache` invalidation, `getProtectionSnapshot` and the other
  static reads — harmless in one process, broken in two.
