# Audit follow-ups: protection status, keywords, SafeSearch, performance, desktop keyword blocking

Spec: the verified audit at
`C:\Users\Admin\AppData\Local\Temp\claude\f--Github-LibreAscent\efbf0cf0-c1fc-42a9-814e-cc993d7e708f\scratchpad\audit-result.json`.
Finding ids: `B<n>` = `result.bypass[n]`, `P<n>` = `result.perf[n]`, `C<a>_<b>` = `result.critics[a].missing[b]`,
`DESIGN` = `result.design.final`. Read a finding with
`node -e "const r=require('<path>');console.log(JSON.stringify(r.bypass[11],null,1))"`.
Prefer a verifier's `corrected_fixes` / `verdict.corrected_fix` over the finder's suggested fix.

Branch: `fix/audit-followups` (base commit `b54055a`).

## Global Constraints

- Match surrounding style. Comments only where they explain why. No emojis. No speculative abstractions.
- Preserve the base commit's behaviour: launch re-push skip (`mobile/services/BlocklistService.ts`), sticky browser-block
  overlay (`applyBlock` in `FreedomAccessibilityService.kt`), banking pause (`BankingModeManager.kt`,
  `FreedomVpnService.pause/resume/isPaused`, `VpnWatchdog` pause check), desktop DNS tiers/breaker/fail-open.
- Every non-trivial logic change gets a focused unit test in the module's existing test style: Kotlin JUnit under
  `src/test`, Rust `#[cfg(test)]`, or a node check script under `mobile/scripts/` wired into `npm run check`.
- Commands:
  - Kotlin: `cd mobile/android && ANDROID_HOME="$LOCALAPPDATA/Android/Sdk" ./gradlew -q :<module>:testReleaseUnitTest`
    and `./gradlew -q :app:compileReleaseKotlin`.
  - TS: `cd mobile && npx tsc --noEmit && npx eslint <files> --max-warnings 0 && npm run check`.
  - Rust: `cargo test --manifest-path desktop/Cargo.toml`.
- Do not touch the attached phone beyond read-only `adb` commands. The controller does device testing.
- Commit messages: plain prose, no co-author or AI attribution trailers.

## Task 1: Foreground service reports protection loss honestly

Findings: B0, P28. Files: `mobile/modules/freedom-foreground-service/**` only.

Requirements:
1. On every `VpnWatchdog` tick, compute the active problem set from these inputs:
   - DNS tunnel not running while `vpn_wanted` is true and no banking pause is active
     (`freedom_vpn_state` prefs `vpn_paused_until` > now means paused).
   - `Settings.Secure` `always_on_vpn_app` names a package other than LibreAscent.
   - LibreAscent's accessibility service component is missing from `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES`
     while no banking window is active (`freedom_settings` prefs `banking_until` > now means active).
2. While any problem is active, the ongoing foreground notification must name it plainly, for example
   "DNS protection is off: <app label> is set as the always-on VPN" or
   "Content protection is off: accessibility service is disabled", on a high-importance channel, with a tap
   action opening the matching Settings screen. Restore the normal text when no problem remains. The notification
   must never read "protecting you" while a layer is down.
3. Expose `getProtectionProblems(): string[]` (stable codes: `vpn_down`, `vpn_taken:<package>`,
   `accessibility_off`) from the foreground module's JS API (`src/index.ts`).
4. If `WRITE_SECURE_SETTINGS` is granted and the accessibility service is missing outside a banking window,
   re-add LibreAscent's component to the enabled list (keep every other entry, set `accessibility_enabled` to 1)
   and log it once per occurrence.
5. P28: stop calling `startForegroundService` every 30 s when the tunnel is already up. Use a liveness check that
   cannot go stale after a hard kill (for example `ConnectivityManager` reporting an active VPN network owned by
   this app's uid).
6. Unit-test the pure decision function (inputs to problem codes).

## Task 2: Dashboard banner for protection problems

Findings: B0 (UI side). Files: `mobile/services/ProtectionService.ts`, `mobile/stores/useAppStore.ts`,
`mobile/app/(tabs)/index.tsx`, `mobile/modules/freedom-foreground-service/src/index.ts` (type only, if Task 1 did not
already add it).

Requirements:
1. `ProtectionService.refreshProtectionStatus` also reads `getProtectionProblems()` and stores the list in the app
   store. Tolerate the native function being absent (older native build) by treating it as an empty list.
2. The store setter must be a no-op when the list is unchanged (no new array identity).
3. The dashboard shows a prominent banner while the list is non-empty, one line per problem, each with a button
   that opens the matching Settings screen (accessibility settings, VPN settings).
4. Typecheck and eslint pass.

## Task 3: Default keyword list and first-run blocklist fetch

Findings: B43, B1. Files: `mobile/stores/useBlockingStore.ts`, `mobile/services/BlocklistService.ts`,
`mobile/services/LaunchRecoveryService.ts`, `mobile/app/_layout.tsx`, `mobile/data/**`, `mobile/scripts/**`,
`mobile/package.json` (check script entry only).

Requirements:
1. Ship a default adult keyword list in `mobile/data/keywords/` (inspect what is already there first). Every entry
   must survive the ContentMatcher false-positive heuristics: no entries that are substrings of common words.
2. Merge defaults into the store on first run and on upgrade only when the user's keyword list is empty. Never
   overwrite or re-add a keyword the user removed: record that defaults were applied once.
3. Fresh install: once onboarding is complete and the adult or hentai category has zero cached domains, fetch the
   enabled sources automatically once per launch, at most once per 6 hours after a failure.
4. Node check script covering the merge rule and the retry gate.

## Task 4: SafeSearch and a family upstream in the mobile DNS tunnel

Findings: B44, B6. Files: `mobile/modules/freedom-vpn-service/**`.

Requirements:
1. In the DNS interceptor, answer A/AAAA queries for Google search hosts (`google.<tld>`, `www.google.<tld>`) with
   the addresses of `forcesafesearch.google.com`; `www.bing.com` with `strict.bing.com`; `duckduckgo.com` and
   `www.duckduckgo.com` with `safe.duckduckgo.com`; `www.youtube.com`, `m.youtube.com`, `youtubei.googleapis.com`,
   `youtube.googleapis.com`, `www.youtube-nocookie.com` with `restrictmoderate.youtube.com`. Resolve the target
   upstream, return its records under the original query name, cache by target with the upstream TTL.
2. On by default whenever adult blocking is on; expose `setSafeSearch(enabled: boolean)` on the VPN module and
   persist it next to the other tunnel settings.
3. Switch the upstream to Cloudflare for Families adult-blocking resolvers (`1.1.1.3`, `1.0.0.3`,
   `2606:4700:4700::1113`, `2606:4700:4700::1003`), and correct the constants' comment.
4. Unit tests for the host-to-target mapping (including non-matching look-alikes such as `google.com.evil.net`)
   and the response rewrite.

## Task 5: ContentMatcher URL and keyword fixes

Findings: B11, B12, B47, B48 (URL layer), B50, P31. Files: `ContentMatcher.kt` and its tests under
`mobile/modules/freedom-accessibility-service/android/src/{main,test}/java/expo/modules/freedomaccessibility/`.

Requirements:
1. B11: decide "search engine" from the parsed host only (exact or subdomain match of `google.<tld>`, `bing.com`,
   `duckduckgo.com`, `yahoo.com`, `yandex.*`, `ecosia.org`, `startpage.com`, `baidu.com`), never from a substring
   anywhere in the text. On search URLs, still keyword-check the query parameter (`q`, `p`, `text`).
2. B12/B48: before domain checks, unwrap proxy front-ends: `*.translate.goog` hosts back to the original domain
   (Google encodes `.` as `-` and a literal `-` as `--`), Wayback `web.archive.org/web/<timestamp>/<url>`, and a
   target URL carried in a `u` / `url` / `q` parameter of known web-proxy hosts. Check the unwrapped domain.
3. B47: the embedded-domain scan must match a bare two-label `site.tld`.
4. B50: keyword matching also runs on a normalised copy (`0→o`, `1→i`, `3→e`, `4→a`, `5→s`, `7→t`, `@→a`, `$→s`,
   common Cyrillic look-alikes to Latin). Tests must prove existing false-positive protections still hold.
5. P31: `getAppConfig` must not run a regex per call; precompute cleaned keys when apps are set.
6. Public API used by `FreedomAccessibilityService` unchanged. A test per rule.

## Task 6: Accessibility work off the main thread

Findings: P0, P3, P5, P27, P2. Files: `FreedomAccessibilityService.kt`, `ReelsDetector.kt`, `BrowserUrlMonitor.kt`
and their tests.

Requirements:
1. Run Reels detection and the NSFW keyword scan on the existing scan `HandlerThread`, with the same coalescing as
   `postBrowserScan` (one in flight, newest pending event wins) and a per-event time budget.
2. Rate-limit the NSFW scan before doing work, not only after a block.
3. Fetch `rootInActiveWindow` only on branches that use it.
4. P27: broadcast the reels "left" event only when reels state actually changed.
5. P2: the full-screen fallback scan must not reset the 800 ms budget mid-event.
6. Keep the sticky overlay behaviour in `applyBlock` intact. Tests for the coalescing and rate-limit logic.

## Task 7: Ship arm64 only

Finding: C1_5. Files: `mobile/plugins/withArm64Only.js`, `mobile/android/gradle.properties`.

Requirements:
1. Fix the plugin so it sets `reactNativeArchitectures=arm64-v8a` (it currently edits a comment line).
2. Set the same value in the committed `mobile/android/gradle.properties`.
3. Verify with `./gradlew :app:assembleRelease` that the APK contains only `lib/arm64-v8a` (`unzip -l`), and report
   the APK size before and after.

## Task 8: JS-side performance

Findings: P16, P17, P18, P19, P24, P20, P21. Files: `mobile/services/**`, `mobile/db/**`, `mobile/stores/**`,
`mobile/app/(tabs)/block-adult.tsx`, `mobile/app/settings/permissions.tsx`, `mobile/app/(tabs)/settings.tsx`,
`mobile/scripts/**`.

Requirements:
1. P16: `refreshIfStale`/`updateBlocklists` parse and insert in chunks with a yield between chunks (one transaction
   per chunk).
2. P17: aggregate blocked-DNS events into the store at most once per second.
3. P18: cache `COUNT(DISTINCT)` per category; recompute only after that category is re-synced.
4. P19: launch recovery calls `syncAllConfigs` once where it currently calls it three times, without losing the
   ordering guarantees the comments describe.
5. P24: `onRehydrateStorage` writes back only when a migration actually changed state.
6. P20: toggling adult blocking off then on uses the flag-only path when native already holds the category.
7. P21: permission/settings polling runs only while the screen is focused.
8. Node check scripts for the chunking and the event aggregation.

## Task 9: Mobile DNS tunnel startup off the main thread

Findings: P11, B10. Files: `mobile/modules/freedom-vpn-service/**`.

Requirements:
1. `onStartCommand` calls `startForeground` first and loads persisted categories on a background thread; the packet
   loop may start before the load finishes, relying on the existing `*IfAbsent` installers so a concurrent JS push
   still wins.
2. Category files are written to a temporary file and renamed into place, so a kill mid-sync never leaves a
   partial file that looks complete.
3. Keep the banking `isPaused` branch at the top of `onStartCommand`. Tests for the atomic write.

## Task 10: Browser coverage gaps

Findings: B16, B17, B15, B19, B20. Files: `FreedomAccessibilityService.kt`, `BrowserUrlMonitor.kt`,
`ReelsDetector.kt`, their tests, `mobile/constants/browsers.ts`, `mobile/constants/reels.ts`.

Requirements:
1. B16: when the user enabled Reels blocking for an app, also block its short-video URLs in browsers
   (`youtube.com/shorts/`, `m.youtube.com/shorts/`, `instagram.com/reel/`, `instagram.com/reels/`,
   `facebook.com/reel/`, `tiktok.com`).
2. B17: add widely used browsers missing from `BROWSERS` (check the device's installed list read-only with
   `adb shell pm list packages`; Pi Browser is installed) using known URL-bar ids, and route unknown packages whose
   window has a WebView through the universal fallback.
3. B15: on a search engine's images or videos vertical, run the page-text keyword fallback regardless of the other
   candidates.
4. B19: only the URL-bar domain decides page whitelisting, not domains mentioned in page text.
5. B20: YouTube Shorts detection fallback by content description or class when the known view ids are absent.
6. Tests for the URL predicates.

## Task 11: Desktop keyword blocking in the tray app

Finding: DESIGN (PR1 only). Files: `desktop/shared/src/**`, `desktop/ui/src-tauri/src/main.rs`,
`desktop/ui/src-tauri/Cargo.toml`, `desktop/ui/src/**`, `desktop/service/src/dns.rs`.

Requirements:
1. Port `ContentMatcher.findMatchingKeyword` semantics (after Task 5) to a shared Rust function with tests mirroring
   the Kotlin keyword tests.
2. In the tray process, poll the foreground window every 300 ms; for browser windows (by process exe:
   chrome, msedge, brave, firefox, opera, vivaldi), match the window title against `config.keywords`. On a match:
   send Ctrl+W to that window, show the existing overlay window with the matched keyword, debounce 3 s per window.
   Only active when control mode is Locked or Hardcore, or when the keyword list is non-empty in Flexible.
3. Fix the proxy not seeing keyword/whitelist edits: the DNS proxy reloads when `config.json` changes, not only
   `blocklist.txt`.
4. Follow DESIGN for crate choices (windows-sys already in the tree, no new crates). Tests for the matcher and the
   debounce.

## Task 12: Desktop SafeSearch

Findings: B44 (desktop), DESIGN (PR2). Files: `desktop/service/src/dns.rs`, `desktop/service/src/browser_policy.rs`,
`desktop/shared/src/config.rs`.

Requirements:
1. Same host-to-target SafeSearch mapping as Task 4 in the desktop DNS proxy, enforced whenever DNS is enforced.
2. Chromium policies `ForceGoogleSafeSearch=1` and `ForceYouTubeRestrict=1` for Chrome, Edge, Brave; removed by
   `reset_browser_policy`.
3. Tests for the mapping and the policy values.
