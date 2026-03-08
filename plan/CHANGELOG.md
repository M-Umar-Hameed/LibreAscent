# Freedom App — Changelog

All changes made by AI agents are logged here.

## 2026-03-08

### Agent: Claude Code (Opus 4.6) — Hardcore Mode Settings Protection Fix

Fixed critical bugs in `SettingsProtector` that prevented Hardcore Mode from working on Android 14+ devices with Compose-based Settings UI.

**Problems fixed:**

1. **Apps list was blocked entirely** — Old code searched for "Freedom" text on any settings screen. When the user opened Settings > Apps, "Freedom" was visible in the app list alongside generic labels like "Storage"/"Cache", causing false positives. Fixed by removing overly broad trigger words and using precise danger keywords ("uninstall", "force stop", "clear data") that only appear on App Info detail pages.

2. **Hardcore mode reset on service restart** — `onServiceConnected()` hardcoded `settingsProtector.updateConfig(false, ...)`, overwriting the user's setting every time the accessibility service reconnected. Fixed by persisting hardcore mode state via SharedPreferences and reading it on startup.

3. **`findAccessibilityNodeInfosByText()` broken on Compose Settings** — Android 14+ uses Compose-based Settings (`SpaActivity`) where `findAccessibilityNodeInfosByText()` always returns empty results. Replaced with manual `collectAllText()` tree traversal that walks all child nodes.

4. **Device Admin page had no accessible node tree** — `DeviceAdminAdd` activity returns `null` from `rootInActiveWindow`, so text-based detection was impossible. Fixed by detecting the activity class name directly on `TYPE_WINDOW_STATE_CHANGED` events.

5. **Package installer not intercepted** — The event routing only checked `com.android.settings`, missing `packageinstaller` packages. Added routing for all settings-related packages.

**Files changed:**

- `modules/freedom-accessibility-service/android/.../SettingsProtector.kt` — Complete rewrite with 3-layer protection (App Info, Device Admin, Accessibility Service), manual tree traversal, activity class detection
- `modules/freedom-accessibility-service/android/.../FreedomAccessibilityService.kt` — Added package installer routing, activity class check before node tree check
- `modules/freedom-accessibility-service/android/.../FreedomAccessibilityModule.kt` — Added SharedPreferences persistence for hardcore mode state

---

### Agent: Antigravity (Gemini) — UI & SQLite Refinements

- Fixed navigation mounting error in Root Layout by checking state initialization before routing.
- Refined UI aesthetics in Settings and Permissions screens (removed heavy background colors from icons, implemented proper light/dark mode support).
- Integrated `NativeWind` color scheme management into root layout for system-wide reactive theme switching.
- Evaluated VPN state accurately in Onboarding by verifying `isVpnPrepared` rather than active state from native VPN module.
- Implemented SQLite (`expo-sqlite`) database for robust, unbounded storage of daily blocking statistics and URL logs.
- Wired SQLite stats hydration to `useAppStore` to feed the Dashboard on cold boot.
- Substituted `AsyncStorage` entirely across all Zustand stores (`useAppStore`, `useBlockingStore`, `useOnboardingStore`) utilizing a custom SQLite Key-Value Engine (`kv_store` table) to resolve Metro dev initialization bugs and persistent storage loss.

### Agent: Antigravity (Gemini) — Phase 14: Surveillance & Lockdown

- Created `SettingsProtector.kt` to monitor Android system settings and block attempts to uninstall the app or deactivate device admin in Hardcore mode.
- Implemented `InteractionGuard` — a friction-based UI intervention (Timer/Clicks) that blocks impulsive modifications to blocking settings in Locked/Hardcore modes.
- Added Weekly Schedules with overnight support to automate protection periods.
- Redesigned bottom navigation bar with professional "Sharp" icons and descriptive labels (Dashboard, Keywords, Sites, Safe, Settings, Lockdown, Schedule).
- Integrated dynamic protection status on the Dashboard based on current schedule.

---

### Agent: Antigravity (Gemini) — Phase 12: Open Source & Documentation

- Resolved `PluginError` by adding `package.json` to all native modules and linking them as local dependencies in root `package.json`.
- Removed native modules from `plugins` array in `app.config.ts` (handled by autolinking).
- Created `LICENSE` (GPL-3.0).
- Created `README.md` with architectural overview and installation guide.
- Created `CONTRIBUTING.md` with guides for adding browsers and reels apps.
- Created `CLAUDE.md` for project-specific AI rules and conventions.
- Finalized project status as **Phase 12 Complete**.

---

### Agent: Antigravity (Gemini) — Phase 6: Foreground Service

- Created `BootReceiver.kt` — BOOT_COMPLETED auto-start, SharedPreferences toggle
- Rewrote `FreedomForegroundService.kt` — Dynamic notification (blocked count, throttled updates), PendingIntent to open app, VPN domain blocked listener
- Rewrote `FreedomForegroundModule.kt` — updateNotification, setAutoStart/isAutoStartEnabled
- Updated `AndroidManifest.xml` — BootReceiver with BOOT_COMPLETED intent filter
- Updated `build.gradle`, JS bindings, type declarations

---

### Agent: Antigravity (Gemini) — Phase 5: System Overlay (Block Screen)

- Created `OverlayService.kt` — Full-screen WindowManager overlay (TYPE_APPLICATION_OVERLAY), touch absorption, auto-triggered by URL_BLOCKED/REELS_DETECTED broadcasts, display cutout support, "Stay Away" + motivational quote UI
- Rewrote `FreedomOverlayModule.kt` — Show/hide via service intents, permission check, isOverlayShowing
- Updated `AndroidManifest.xml` — Declared OverlayService
- Updated `build.gradle` — Added localbroadcastmanager
- Updated JS bindings + type declarations — isOverlayShowing

---

### Agent: Antigravity (Gemini) — Phase 4: Accessibility Service (URL + Reels)

#### Kotlin Native — URL Monitoring + Reels Detection

- Created `BrowserUrlMonitor.kt` — URL bar extraction via accessibility node tree, per-browser resource ID config, fallback to event text, URL normalization + dedup
- Created `ReelsDetector.kt` — Reels/shorts detection via node tree search, visibility check, keyword fallback, state change tracking (enter/leave)
- Created `ContentMatcher.kt` — URL-level domain/keyword matching with suffix matching + whitelist, ConcurrentHashMap
- Rewrote `FreedomAccessibilityService.kt` — Event routing to BrowserUrlMonitor/ReelsDetector, about:blank redirect for browser blocks, LocalBroadcastManager events, app switch detection
- Rewrote `FreedomAccessibilityModule.kt` — Config push (browser/reels/domain/keyword/whitelist), BroadcastReceiver → Expo Events (onUrlBlocked, onReelsDetected)

#### JS Bindings + Types

- Updated `modules/freedom-accessibility-service/src/index.ts` — Added updateBlockedDomains, updateBlockedKeywords, updateWhitelist + event listeners
- Updated `types/native-modules.d.ts` — New declarations for accessibility functions + events
- Updated `build.gradle` — Added localbroadcastmanager dependency

---

### Agent: Antigravity (Gemini) — Phase 3: VPN Service (DNS Blocking)

#### Kotlin Native — DNS Interception Engine

- Created `DomainBlocklist.kt` — ConcurrentHashMap-based O(1) domain lookup, suffix matching, per-category management, whitelist override, hosts file format parsing
- Created `DnsInterceptor.kt` — DNS wire format parser, domain extraction from labels, A/AAAA filtering, NXDOMAIN response builder with proper flags
- Rewrote `FreedomVpnService.kt` — Full VPN: TUN interface (10.0.0.2/32), IPv4 packet parsing, UDP/DNS extraction (port 53), NXDOMAIN injection, upstream forwarding via protected DatagramSocket, IP checksum, foreground notification, LocalBroadcastManager events, dedicated packet thread
- Rewrote `FreedomVpnModule.kt` — Wired blocklist CRUD (setDomains, addCategory, removeCategory, setWhitelist), BroadcastReceiver → Expo Events bridge (onDomainBlocked, onVpnStatusChanged)

#### JS-Side Services

- Created `services/BlocklistService.ts` — Domain list parsing (plain + hosts format), category merge, sync to native, remote fetch
- Created `services/ProtectionService.ts` — Start/stop protection orchestrator, auto-syncs Zustand store on events
- Updated `modules/freedom-vpn-service/src/index.ts` — Added removeCategory, setWhitelist, getBlocklistSize, wired EventEmitter
- Updated `types/native-modules.d.ts` — Added new VPN function declarations
- Updated `modules/freedom-vpn-service/android/build.gradle` — Added localbroadcastmanager dependency

---

### Agent: Antigravity (Gemini) — Phase 2: Onboarding & Permission Flow

#### Native Module JS Bindings (TypeScript)

- Created `modules/freedom-vpn-service/src/index.ts` — VPN start/stop/prepare, blocklist management, event listeners
- Created `modules/freedom-accessibility-service/src/index.ts` — accessibility check, settings open, browser/reels config push
- Created `modules/freedom-overlay/src/index.ts` — overlay show/hide, permission check/request
- Created `modules/freedom-foreground-service/src/index.ts` — foreground service start/stop/status
- Created `modules/freedom-device-admin/src/index.ts` — admin status check, activation request

#### Native Module Kotlin Implementations

- Created `FreedomVpnModule.kt` — Expo Module bridge, VPN prepare via `VpnService.prepare()`
- Created `FreedomVpnService.kt` — Stub VPN service with lifecycle + isRunning status
- Created `FreedomAccessibilityModule.kt` — Checks enabled state via `Settings.Secure`, opens settings
- Created `FreedomAccessibilityService.kt` — Stub accessibility service (appears in Android Settings)
- Created `FreedomOverlayModule.kt` — `Settings.canDrawOverlays()` check, opens per-app overlay settings
- Created `FreedomForegroundModule.kt` — Start/stop foreground service, handles O+ startForegroundService
- Created `FreedomForegroundService.kt` — Persistent notification ("Freedom is protecting you")
- Created `FreedomDeviceAdminModule.kt` — `DevicePolicyManager.isAdminActive()` + activation dialog
- Created `FreedomDeviceAdminReceiver.kt` — Shows warning on disable attempt

#### Android XML Configs

- Created `accessibility_service_config.xml` — Event types, flags, view ID reporting
- Created `device_admin_policies.xml` — force-lock policy
- Created `strings.xml` for accessibility service description
- Created `AndroidManifest.xml` for each module (service/receiver declarations)
- Created `build.gradle` for each module (Kotlin + Expo Modules API)
- Created `expo-module.config.json` for each module

#### Onboarding Flow

- Created `stores/useOnboardingStore.ts` — Permission progress persistence with resume
- Created `hooks/usePermissions.ts` — Central hook checking/requesting all 5 permissions
  - AppState listener re-checks when returning from Settings (accessibility/overlay)
  - Graceful fallback when native modules unavailable
- Rewrote `permissions.tsx` — Animated progress bar, numbered cards, press animations, contextual CTA
- Rewrote `index.tsx` (welcome) — Entrance animations, skip-if-onboarded
- Updated `_layout.tsx` — Conditional routing based on onboarding state
- Updated `app.config.ts` — Added 5 native module plugins + additional Android permissions
- Updated `constants/permissions.ts` — Added grant type and settings hints
- Created `types/native-modules.d.ts` — TypeScript declarations for all modules
- Installed `expo-notifications` dependency

---

### Agent: Claude Code (Opus 4.6)

#### Phase 0: Project Initialization

- Initialized Expo project using `create-expo-app` (SDK 54, React Native 0.81)
- Installed dependencies: expo-router, nativewind, zustand, date-fns, expo-dev-client, async-storage, etc.
- Created `app.config.ts` with Freedom branding and Android permissions
- Configured NativeWind v4 (tailwind.config.js, global.css, babel.config.js, metro.config.js)
- Set up TypeScript with strict mode and path aliases
- Created `eas.json` with development/preview/production build profiles

#### Phase 1: Project Structure & Navigation

- Created full directory structure (app/, components/, constants/, stores/, modules/, data/, etc.)
- Built root navigation layout with Stack (onboarding, tabs, block overlay)
- Built tab navigation with 6 tabs (Home, Keywords, Websites, Adult, Reels, Settings)
- Built onboarding flow (Welcome screen + Permission wizard)
- Built Dashboard screen (protection status, stats, summary)
- Built Block Keywords screen (add/remove keywords with search)
- Built Block Websites screen (Include/Exclude tabs for blocked/whitelisted URLs)
- Built Block Adult Content screen (master toggle + category toggles)
- Built Block Reels screen (per-app toggle cards for YouTube, Instagram, FB, Snapchat)
- Built Settings screen (auto-start, password, permissions, data export/import)
- Built Block Overlay screen ("Stay Away" full-screen modal)

#### State Management & Data

- Created Zustand stores (useAppStore, useBlockingStore) with AsyncStorage persistence
- Created TypeScript types (blocking.ts)
- Created constants (colors, browsers, reels, permissions)
- Created data files (domain/keyword blocklists, sources.json for open-source lists)

#### Multi-Agent Coordination

- Created plan/ folder with PLAN.md, STATUS.md, ARCHITECTURE.md, CHANGELOG.md
- Created .agent/CLAUDE.md with project conventions for AI assistants
