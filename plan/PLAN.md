# Freedom App — Implementation Plan

## Context

**Problem**: Pornography addiction is a widespread issue. Users need a tool that enforces content blocking at the device level — not just a filter they can easily bypass, but a persistent system-level guard.

**Solution**: "Freedom" — an open-source React Native (Expo) Android app that:

1. Intercepts all DNS traffic via a local VPN to block adult domains
2. Monitors browser URL bars via Android Accessibility Service as a secondary check
3. Blocks reels/shorts sections in YouTube, Instagram, Facebook, Snapchat (not the entire apps)
4. Draws a full-screen "Stay Away" overlay when adult content is detected
5. Opens a new blank tab in the browser (no redirection to any page)
6. Persists across app kills, swipes, and device reboots
7. Uses Device Admin to resist uninstallation
8. Fully offline/local — blocklist updates fetched from public GitHub repos
9. Extensible — easy to add new browsers, new blocking datasets/categories

**Platform priority**: Android first (iOS has severe restrictions for this type of app)

---

## Phase 0: Project Initialization

### Steps

1. Initialize Expo project in the existing `Freedom` repo:
   ```bash
   cd d:/Software-Dev/GitHub/Freedom
   npx create-expo-app@latest . --template default
   ```
2. Create `.agent/` folder with AI/agent configs (CLAUDE.md, coding guidelines)
3. Create `plan/` folder with plan docs and work status for multi-agent coordination:
   - `plan/PLAN.md` — full implementation plan
   - `plan/STATUS.md` — current work status tracker (what's done, in-progress, pending)
   - `plan/ARCHITECTURE.md` — architecture decisions and technical notes
   - `plan/CHANGELOG.md` — log of changes made by any AI agent
4. Install core dependencies:

   ```bash
   # Navigation
   npx expo install expo-router expo-linking expo-constants expo-status-bar

   # Styling
   npx expo install nativewind tailwindcss react-native-reanimated react-native-safe-area-context

   # State + persistence
   npm install zustand
   npx expo install @react-native-async-storage/async-storage

   # Dev client (required for custom native modules)
   npx expo install expo-dev-client

   # UI
   npx expo install @expo/vector-icons expo-splash-screen expo-font

   # Date utilities
   npm install date-fns
   ```

5. Configure NativeWind/Tailwind (tailwind.config.js, global.css, babel/metro config)
6. Configure `app.config.ts` with Android permissions and native module plugins
7. Set up strict TypeScript config with path aliases
8. Create `eas.json` for build profiles

### Key Config — `app.config.ts`

- `name`: "Freedom"
- `slug`: "freedom"
- `scheme`: "freedom"
- `android.package`: "com.freedom.app"
- Android permissions: INTERNET, FOREGROUND_SERVICE, FOREGROUND_SERVICE_SPECIAL_USE, SYSTEM_ALERT_WINDOW, RECEIVE_BOOT_COMPLETED, POST_NOTIFICATIONS, BIND_ACCESSIBILITY_SERVICE, BIND_DEVICE_ADMIN, BIND_VPN_SERVICE
- Plugins: expo-router + all 5 custom native modules

---

## Phase 1: Project Structure & Navigation Shell

### Directory Structure

```
Freedom/
  .agent/                         # AI/Agent configurations
    CLAUDE.md                     # Project conventions for AI assistants
    guidelines.md                 # Coding standards & contribution guide

  plan/                           # Plan & work status (shared across AI agents)
    PLAN.md                       # Full implementation plan (copy of this document)
    STATUS.md                     # Current work status, completed/in-progress/pending
    ARCHITECTURE.md               # Architecture decisions & technical notes
    CHANGELOG.md                  # Log of changes made by any agent

  app.config.ts
  babel.config.js
  metro.config.js
  tailwind.config.js
  global.css
  tsconfig.json
  package.json
  eas.json
  LICENSE                         # Open source license

  src/
    app/                          # Expo Router file-based routes
      _layout.tsx                 # Root layout (Stack)
      (onboarding)/
        _layout.tsx
        index.tsx                 # Welcome screen
        permissions.tsx           # Permission wizard
      (tabs)/
        _layout.tsx               # Tab navigator
        index.tsx                 # Dashboard (Home)
        block-keywords.tsx        # Block by keywords screen
        block-websites.tsx        # Block websites (include/exclude URLs)
        block-adult.tsx           # Block adult content toggle + categories
        block-reels.tsx           # Block reels (YT, IG, FB, Snapchat)
        settings.tsx              # Settings
        about.tsx                 # About/Support

    components/
      ui/                        # Reusable UI components
        Button.tsx
        Card.tsx
        PermissionCard.tsx
        StatCard.tsx
        SearchInput.tsx
        ToggleCard.tsx
        ListItem.tsx
      overlay/
        BlockScreen.tsx           # "Stay Away" overlay content
      blocking/
        KeywordList.tsx           # Keyword list with add/remove
        WebsiteList.tsx           # Website list with include/exclude
        CategoryToggle.tsx        # Blocking category toggle card
        ReelsAppCard.tsx          # Per-app reels blocking card

    hooks/
      useProtectionStatus.ts
      useBlockingStats.ts
      usePermissions.ts

    stores/
      useAppStore.ts             # Main app state (Zustand + AsyncStorage)
      useOnboardingStore.ts      # Onboarding progress
      useBlockingStore.ts        # Blocking rules: keywords, websites, categories, reels

    services/
      BlocklistService.ts        # Domain blocklist CRUD + fetch from GitHub
      ProtectionService.ts       # Bridge to native modules
      BlocklistUpdater.ts        # Fetch updated lists from open-source repos

    constants/
      blocklist.ts               # Default adult domain list
      keywords.ts                # Default adult keyword list
      browsers.ts                # Browser package → URL bar ID mapping
      reels.ts                   # Reels/shorts detection config per app
      colors.ts
      permissions.ts

    types/
      index.ts
      native-modules.d.ts
      blocking.ts                # Types for keywords, websites, categories

    utils/
      url.ts                     # URL parsing utilities
      keyword-matcher.ts         # Keyword matching logic

  modules/                       # Custom Expo native modules (Kotlin)
    freedom-vpn-service/         # Local VPN for DNS blocking
    freedom-accessibility-service/ # Browser URL + Reels monitoring
    freedom-overlay/             # Full-screen overlay
    freedom-foreground-service/  # Persistent background service
    freedom-device-admin/        # Uninstall protection

  data/                          # Extensible blocking datasets
    domains/
      adult.txt                  # Adult domain list
      hentai.txt                 # Hentai-specific domains
      custom/                    # User-added category files
    keywords/
      adult.txt                  # Adult content keywords
      custom/                    # User-added keyword files
    sources.json                 # URLs to open-source blocklist repos for updates

  assets/
    images/
    fonts/
```

### Navigation — Tab Structure

- **Home** — Dashboard with protection status & stats
- **Keywords** — Block by keyword (manage keyword blocklist)
- **Websites** — Block/allow websites (included + excluded URLs)
- **Adult** — Adult content blocking with categories (adult, hentai, etc.)
- **Reels** — Per-app reels/shorts blocking
- **Settings** — App settings
- **About** — App info & support

---

## Phase 2: Onboarding & Permission Flow

### Permission Steps (in order)

1. **Notifications** — for persistent foreground service
2. **VPN** — system dialog for local VPN
3. **Accessibility Service** — deep-link to Settings > Accessibility
4. **Overlay Permission** — Settings > Special Access > Draw Over Other Apps
5. **Device Admin** — system dialog to activate

Each step: explain why → button to grant → check if granted → next step

### Files

- `src/app/(onboarding)/permissions.tsx`
- `src/hooks/usePermissions.ts`

---

## Phase 3: Native Module — VPN Service (DNS Blocking)

**Most critical module.** Implements a local VPN that intercepts DNS traffic.

### Architecture

```
App Traffic → TUN Interface → FreedomVpnService → DnsInterceptor
                                                      ↓
                                              DomainBlocklist.contains()?
                                              YES → Return NXDOMAIN + emit event
                                              NO  → Forward to real DNS
```

### Kotlin Files (`modules/freedom-vpn-service/android/`)

- `FreedomVpnModule.kt` — Expo Module: startVpn, stopVpn, isVpnActive, updateBlocklist, getBlockedCount
- `FreedomVpnService.kt` — Android VpnService subclass, TUN interface, packet routing
- `DnsInterceptor.kt` — DNS packet parser, domain extraction, NXDOMAIN response builder
- `DomainBlocklist.kt` — HashSet<String> blocklist, wildcard/suffix matching, runtime updates from multiple category files

### JS API: `modules/freedom-vpn-service/src/index.ts`

- `startVpn()`, `stopVpn()`, `isVpnActive()`
- `updateBlocklist(domains: string[])`, `addCategory(name, domains[])`
- Events: `onDomainBlocked`, `onVpnStatusChanged`

### Blocklist Sources (open-source)

- Default embedded: top adult domains from open-source lists
- `data/sources.json` — URLs to community-maintained blocklists on GitHub
- `BlocklistUpdater.ts` — fetches updates from these repos periodically
- Categories: adult, hentai, gambling (extensible — users can add custom category files)

---

## Phase 4: Native Module — Accessibility Service (URL + Reels Monitoring)

**Dual purpose:** (1) Monitor browser URL bars, (2) Detect reels/shorts sections in social apps.

### Kotlin Files (`modules/freedom-accessibility-service/android/`)

- `FreedomAccessibilityModule.kt` — Expo Module: isEnabled, openSettings, addBrowser, addReelsApp
- `FreedomAccessibilityService.kt` — AccessibilityService subclass, event handler
- `BrowserUrlMonitor.kt` — Extract URL from browser address bars
- `BrowserDetector.kt` — Extensible browser package → URL bar ID mapping
- `ReelsDetector.kt` — Detect reels/shorts UI sections in social media apps
- `AppMonitor.kt` — Monitor foreground app and route to appropriate detector
- `SettingsProtector.kt` — **NEW**: Monitor system settings to prevent uninstallation or admin deactivation (Hardcore Mode)

### Extensible Browser Support

Browser definitions stored in `src/constants/browsers.ts` as a config:

```typescript
export const BROWSERS: BrowserConfig[] = [
  { name: "Chrome", package: "com.android.chrome", urlBarId: "url_bar" },
  {
    name: "Firefox",
    package: "org.mozilla.firefox",
    urlBarId: "url_bar_title",
  },
  {
    name: "Samsung Internet",
    package: "com.sec.android.app.sbrowser",
    urlBarId: "location_bar_edit_text",
  },
  { name: "Brave", package: "com.brave.browser", urlBarId: "url_bar" },
  { name: "Edge", package: "com.microsoft.emmx", urlBarId: "url_bar" },
  { name: "Opera", package: "com.opera.browser", urlBarId: "url_field" },
  // Easy to add: LibreWolf, Vivaldi, etc.
];
```

Passed to native side at startup. Community can contribute new browser configs.

### Reels/Shorts Detection

Detect when user enters reels/shorts sections (NOT blocking entire apps):

| App                | Package                      | Detection Strategy                                                     |
| ------------------ | ---------------------------- | ---------------------------------------------------------------------- |
| YouTube Shorts     | `com.google.android.youtube` | Detect "Shorts" tab/section in node tree, or Shorts player UI elements |
| Instagram Reels    | `com.instagram.android`      | Detect Reels tab, reel player view IDs                                 |
| Facebook Reels     | `com.facebook.katana`        | Detect Reels section node IDs                                          |
| Snapchat Spotlight | `com.snapchat.android`       | Detect Spotlight/Discover section                                      |

Config stored in `src/constants/reels.ts`:

```typescript
export const REELS_APPS: ReelsAppConfig[] = [
  {
    name: "YouTube Shorts",
    package: "com.google.android.youtube",
    detectionNodes: ["shorts_pivot_bar", "reel_player_page_container"],
  },
  {
    name: "Instagram Reels",
    package: "com.instagram.android",
    detectionNodes: ["clips_tab", "reel_viewer_container"],
  },
  // ...
];
```

When reels detected → trigger overlay (same "Stay Away" screen).

---

## Phase 5: Native Module — System Overlay (Block Screen)

### Kotlin Files (`modules/freedom-overlay/android/`)

- `FreedomOverlayModule.kt` — Expo Module: showOverlay, hideOverlay, hasOverlayPermission
- `OverlayService.kt` — WindowManager overlay with TYPE_APPLICATION_OVERLAY, full-screen coverage
- `OverlayView.kt` — Custom View: "Stay Away" message, dark background, motivational text

### Behavior

- Covers entire screen (including status bar and nav bar)
- Cannot be dismissed by Back/Home buttons
- Removed only when Accessibility Service confirms user navigated away from blocked content

### New Tab Trigger (browser blocking only)

When overlay shows due to browser content, open `about:blank` as a new tab:

```kotlin
val intent = Intent(Intent.ACTION_VIEW, Uri.parse("about:blank"))
intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
startActivity(intent)
```

No redirection — just a blank new tab.

---

## Phase 6: Native Module — Foreground Service

### Kotlin Files (`modules/freedom-foreground-service/android/`)

- `FreedomForegroundModule.kt` — Expo Module: startService, stopService, isServiceRunning
- `FreedomForegroundService.kt` — Persistent notification ("Freedom is protecting you"), BOOT_COMPLETED receiver for auto-start

---

## Phase 7: Native Module — Device Admin

### Kotlin Files (`modules/freedom-device-admin/android/`)

- `FreedomDeviceAdminModule.kt` — Expo Module: isAdminActive, requestAdminActivation
- `FreedomDeviceAdminReceiver.kt` — DeviceAdminReceiver: onDisableRequested shows warning
- `device_admin_policies.xml` — force-lock policy

---

## Phase 8: Blocking Screens UI

### Block Keywords (`src/app/(tabs)/block-keywords.tsx`)

- Add/remove keywords that trigger blocking
- Default keywords pre-loaded from `data/keywords/adult.txt`
- Search/filter through keyword list
- Import keywords from file

### Block Websites (`src/app/(tabs)/block-websites.tsx`)

- **Included URLs** — websites that ARE blocked (user can add custom domains)
- **Excluded URLs** — websites that are WHITELISTED (user can exclude false positives)
- Toggle between Include/Exclude tabs
- Search through both lists
- Import/export lists

### Block Adult Content (`src/app/(tabs)/block-adult.tsx`)

- Master toggle for adult content blocking
- **Category toggles**: Adult, Hentai, and extensible custom categories
- Each category loads from its corresponding file in `data/domains/`
- Users can add custom categories (creates new file in `data/domains/custom/`)
- "Update blocklists" button — fetches latest from open-source GitHub repos

### Block Reels (`src/app/(tabs)/block-reels.tsx`)

- Per-app toggle cards:
  - YouTube Shorts: ON/OFF
  - Instagram Reels: ON/OFF
  - Facebook Reels: ON/OFF
  - Snapchat Spotlight: ON/OFF
- Each card shows app icon, name, and toggle
- Note: Only blocks the reels/shorts section, not the entire app

---

## Phase 9: Dashboard & Settings UI

### Dashboard (`src/app/(tabs)/index.tsx`)

- Protection status (shield icon, green/red)
- Days clean counter
- Blocked attempts today / total
- Quick stats: keywords active, domains blocked, reels apps monitored
- Quick actions

### Settings (`src/app/(tabs)/settings.tsx`)

- Password protection for disabling protection
- Auto-start on boot toggle
- Notification preferences
- Export/import all settings
- Blocklist update sources (manage GitHub repo URLs in `data/sources.json`)

### About (`src/app/(tabs)/about.tsx`)

- App info, version, open-source license
- Link to GitHub repository
- Support resources (recovery programs, hotlines)
- Contribute: how to add browsers, datasets

---

## Phase 10: State Management (Zustand)

### `src/stores/useAppStore.ts`

- Protection status flags (vpn, accessibility, overlay, deviceAdmin)
- Blocking stats (blockedToday, totalBlocked, daysClean)
- App settings (password, autoStart)
- Persisted via zustand/persist + AsyncStorage

### `src/stores/useBlockingStore.ts` (**NEW**)

- `keywords: string[]` — active blocking keywords
- `includedUrls: string[]` — blocked websites
- `excludedUrls: string[]` — whitelisted websites
- `categories: { [name: string]: { enabled: boolean, domains: string[] } }` — blocking categories
- `reelsApps: { [package: string]: boolean }` — per-app reels blocking toggles
- CRUD actions for all of the above
- Persisted via zustand/persist + AsyncStorage

### `src/stores/useOnboardingStore.ts`

- Onboarding step progress, completion state

---

## Phase 11: Integration & Event Flow

### End-to-End Blocking Flow (Browser)

1. User opens browser → navigates to adult site
2. DNS request intercepted by VPN → domain in blocklist → returns NXDOMAIN
3. VPN emits `onDomainBlocked` event
4. Overlay service draws full-screen "Stay Away" screen
5. New blank tab opens (`about:blank`)
6. Overlay remains until safe URL detected
7. Stats updated in Zustand store

### End-to-End Blocking Flow (Reels)

1. User opens YouTube → navigates to Shorts tab
2. Accessibility Service detects Shorts UI elements via `ReelsDetector`
3. Overlay service draws full-screen "Stay Away" screen
4. Overlay remains until user navigates away from Shorts section
5. Stats updated

### Native-to-Native Communication

- VPN ↔ Overlay: direct via LocalBroadcastManager (low latency)
- Accessibility ↔ Overlay: direct via LocalBroadcastManager
- Native → JS: Expo Module events (for stats/UI)
- JS → Native: Expo Module functions

---

## Phase 12: Open Source & Extensibility

### `.agent/CLAUDE.md` — Project Conventions

- TypeScript strict mode, Expo Router for navigation
- Zustand for state, NativeWind for styling
- Native modules in `modules/` using Expo Modules API
- Blocking data in `data/` as plain text files
- Browser configs in `src/constants/browsers.ts`
- Reels configs in `src/constants/reels.ts`

### Contributing New Browsers

1. Find the browser's package name and URL bar resource ID (using Layout Inspector)
2. Add entry to `src/constants/browsers.ts`
3. Submit PR

### Contributing New Datasets

1. Add a `.txt` file to `data/domains/` or `data/keywords/`
2. Register it as a category in the app
3. Submit PR

### Contributing New Reels App Support

1. Find app package name and reels UI node IDs
2. Add entry to `src/constants/reels.ts`
3. Submit PR

---

## Verification & Testing

### Dev Build

```bash
npx expo prebuild
npx expo run:android
```

### Manual Testing (physical Android device required)

- [ ] Navigate to known adult domains → verify DNS block + overlay
- [ ] Verify new blank tab opens (no redirection)
- [ ] Add custom keyword → visit page with keyword → verify blocking
- [ ] Add URL to excluded list → verify it's NOT blocked
- [ ] Open YouTube → go to Shorts → verify overlay triggers
- [ ] Open Instagram → go to Reels → verify overlay triggers
- [ ] Kill app from recents → re-navigate to adult site → verify re-blocking
- [ ] Test with Chrome, Firefox, Samsung Internet, Brave
- [ ] Reboot device → verify auto-start
- [ ] Try to uninstall → verify Device Admin warning
- [ ] Add new blocking category → verify domains are blocked
- [ ] Fetch blocklist updates → verify new domains added

### Unit Tests

- Zustand stores: state transitions, persistence, CRUD for keywords/URLs
- URL parsing, keyword matching utilities
- Kotlin: DNS packet parsing, blocklist lookup, browser detection, reels detection

---

## Key Risks & Mitigations

| Risk                              | Mitigation                                    |
| --------------------------------- | --------------------------------------------- |
| Google Play rejection             | Distribute via direct APK / F-Droid initially |
| Battery drain from always-on VPN  | Lightweight DNS-only interception             |
| False positives                   | Exclude (whitelist) feature for URLs          |
| Browser diversity                 | Extensible config-driven browser support      |
| Reels UI changes with app updates | Config-driven detection nodes, easy to update |
| Android version differences       | Target API 29+ (Android 10+)                  |

---

## Implementation Order

| #   | Phase         | Description                                            |
| --- | ------------- | ------------------------------------------------------ |
| 0   | Init          | Create Expo project, install deps, configure           |
| 1   | Structure     | Directory structure, navigation shell, `.agent/` setup |
| 2   | Onboarding    | Permission wizard flow                                 |
| 3   | VPN           | DNS-based domain blocking (core blocking engine)       |
| 4   | Accessibility | Browser URL monitoring + Reels detection               |
| 5   | Overlay       | Full-screen "Stay Away" block screen                   |
| 6   | Foreground    | Persistent background service                          |
| 7   | Device Admin  | Uninstall protection                                   |
| 8   | Blocking UI   | Keywords, Websites, Adult, Reels screens               |
| 9   | Dashboard     | Home screen + Settings + About                         |
| 10  | State         | Zustand stores for all blocking rules                  |
| 11  | Integration   | Wire everything together, event flows                  |
| 12  | Open Source   | Docs, contribution guides, LICENSE                     |
| 13  | Post-Launch   | SQLite persistence, UI themes, stats                   |
| 14  | Surveillance  | Control modes, schedules, lockdown protection          |

---

## Phase 14: Surveillance & Lockdown

### Control Modes

- **Flexible**: Standard app behavior.
- **Locked**: Settings changes require a "Friction" intervention (timer/clicks).
- **Hardcore**: Blocks uninstallation and deactivating admin access via `SettingsProtector`.

### Weekly Schedules

- Support for time-based blocking periods per day.
- Overnight schedule support (e.g., 10 PM to 6 AM).
- Dashboard indicator for "Protection Active" vs "Protection Paused" based on clock.

### Friction Interventions (`InteractionGuard`)

- **Timer**: User must wait for a configurable duration (30s+) before action succeeds.
- **Clicks**: User must tap a button a configurable number of times (50+) to proceed.
