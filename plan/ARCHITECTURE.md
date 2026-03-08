# Freedom App — Architecture Decisions

## Tech Stack

| Layer          | Technology                   | Rationale                                    |
| -------------- | ---------------------------- | -------------------------------------------- |
| Framework      | React Native (Expo SDK 54)   | Cross-platform potential, JS ecosystem       |
| Navigation     | Expo Router v6               | File-based routing, deep linking             |
| Styling        | NativeWind v4 (Tailwind CSS) | Utility-first, consistent design             |
| State          | Zustand v5 + AsyncStorage    | Lightweight, persistent, simple API          |
| Native Modules | Expo Modules API (Kotlin)    | First-class Expo integration                 |
| Build          | Expo Dev Client + EAS        | Custom native code support                   |
| Notifications  | expo-notifications           | Permission request + foreground notification |

## Platform: Android First

iOS has severe restrictions for content filtering apps (requires MDM/supervised devices). Android provides:

- VpnService API for network-level filtering
- AccessibilityService for UI monitoring
- SYSTEM_ALERT_WINDOW for screen overlay
- DeviceAdminReceiver for uninstall protection
- Foreground Service for persistence

---

## Project Structure (Actual Paths)

```
Freedom/
  app/                              # Expo Router file-based routes
    _layout.tsx                     # Root layout (conditional onboarding/tabs routing)
    block-overlay.tsx               # "Stay Away" full-screen overlay
    (onboarding)/
      _layout.tsx                   # Stack navigator for onboarding
      index.tsx                     # Welcome screen (skip-if-onboarded)
      permissions.tsx               # Permission wizard (5-step, animated)
    (tabs)/
      _layout.tsx                   # Tab navigator
      index.tsx                     # Dashboard (Home)
      block-keywords.tsx
      block-websites.tsx
      block-adult.tsx
      block-reels.tsx
      settings.tsx

  stores/
    useAppStore.ts                  # Protection status, stats, settings (persisted)
    useBlockingStore.ts             # Keywords, URLs, categories, reels toggles (persisted)
    useOnboardingStore.ts           # Permission grant progress (persisted)

  hooks/
    usePermissions.ts               # Central hook: check/request all 5 Android permissions
    use-color-scheme.ts
    use-theme-color.ts

  constants/
    colors.ts                       # Freedom color palette
    theme.ts                        # Navigation theme
    browsers.ts                     # Browser package → URL bar ID mapping
    reels.ts                        # Reels detection config per app
    permissions.ts                  # Permission metadata (icon, grant type, hints)

  types/
    blocking.ts                     # BlockingCategory, BlockingStats, ProtectionStatus
    native-modules.d.ts             # TypeScript declarations for all 5 native modules

  data/
    domains/                        # One domain per line, by category
      adult.txt
      hentai.txt
      custom/
    keywords/
      adult.txt
      custom/
    sources.json                    # URLs to open-source blocklist repos

  modules/                          # 5 Custom Expo Native Modules
    freedom-vpn-service/
    freedom-accessibility-service/
    freedom-overlay/
    freedom-foreground-service/
    freedom-device-admin/
```

---

## Native Module Structure (Each Module)

Every native module follows this structure:

```
modules/<module-name>/
  expo-module.config.json           # Expo module registration (platform, class name)
  src/
    index.ts                        # JS bindings (TypeScript interfaces + fallback stubs)
  android/
    build.gradle                    # Kotlin + Expo Modules API dependencies
    src/main/
      AndroidManifest.xml           # Service/receiver declarations
      java/expo/modules/<pkg>/
        <Module>.kt                 # Expo Module definition (JS ↔ Native bridge)
        <Service|Receiver>.kt      # Android component (if applicable)
      res/
        xml/                        # Service configs (accessibility, device admin)
        values/                     # String resources
```

### Module Registry

| Module                        | Kotlin Package                      | Key Classes                                                                                                         | Android Component                      |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| freedom-vpn-service           | `expo.modules.freedomvpn`           | `FreedomVpnModule`, `FreedomVpnService`, `DnsInterceptor`, `DomainBlocklist`                                        | VpnService                             |
| freedom-accessibility-service | `expo.modules.freedomaccessibility` | `FreedomAccessibilityModule`, `FreedomAccessibilityService`, `BrowserUrlMonitor`, `ReelsDetector`, `ContentMatcher` | AccessibilityService                   |
| freedom-overlay               | `expo.modules.freedomoverlay`       | `FreedomOverlayModule`, `OverlayService`                                                                            | Service + WindowManager                |
| freedom-foreground-service    | `expo.modules.freedomforeground`    | `FreedomForegroundModule`, `FreedomForegroundService`, `BootReceiver`                                               | Foreground Service + BroadcastReceiver |
| freedom-device-admin          | `expo.modules.freedomdeviceadmin`   | `FreedomDeviceAdminModule`, `FreedomDeviceAdminReceiver`                                                            | DeviceAdminReceiver                    |

### JS ↔ Native API Summary

| Module        | JS Functions                                                                                                                                                                                                                                              | Status                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| VPN           | `startVpn()`, `stopVpn()`, `isVpnActive()`, `prepareVpn()`, `updateBlocklist()`, `addCategory()`, `removeCategory()`, `setWhitelist()`, `getBlockedCount()`, `getBlocklistSize()` + events: `onDomainBlocked`, `onVpnStatusChanged`                       | ✅ **FULLY IMPLEMENTED** (DNS interception, NXDOMAIN)                     |
| Accessibility | `isAccessibilityEnabled()`, `openAccessibilitySettings()`, `updateBrowserConfigs()`, `updateReelsConfigs()`, `updateBlockedDomains()`, `updateBlockedKeywords()`, `updateWhitelist()`, `updateHardcoreMode()` + events: `onUrlBlocked`, `onReelsDetected` | ✅ **FULLY IMPLEMENTED** (URL monitoring, reels detection, hardcore mode) |
| Overlay       | `showOverlay()`, `hideOverlay()`, `hasOverlayPermission()`, `requestOverlayPermission()`, `isOverlayShowing()`                                                                                                                                            | ✅ **FULLY IMPLEMENTED** (WindowManager overlay, auto-triggered)          |
| Foreground    | `startService()`, `stopService()`, `isServiceRunning()`, `updateNotification()`, `setAutoStart()`, `isAutoStartEnabled()`                                                                                                                                 | ✅ **FULLY IMPLEMENTED** (persistent notification, boot auto-start)       |
| Device Admin  | `isAdminActive()`, `requestAdminActivation()`                                                                                                                                                                                                             | ✅ **FULLY IMPLEMENTED**                                                  |

---

## Content Blocking Architecture

### Layer 1: DNS-Level Blocking (VPN Service)

A local VPN intercepts all DNS traffic. Queries for blocked domains return NXDOMAIN (domain not found). All non-DNS traffic passes through unchanged to minimize battery impact.

```
App Traffic -> TUN Interface -> FreedomVpnService -> DnsInterceptor
                                                        |
                                                DomainBlocklist.contains()?
                                                YES -> NXDOMAIN + event
                                                NO  -> Forward to real DNS
```

**Status**: ✅ **FULLY IMPLEMENTED**. TUN interface, DNS packet parsing, NXDOMAIN injection, upstream forwarding, event broadcasting all complete.

### VPN Service Internals

```
FreedomVpnService (Thread: FreedomVPN-PacketProcessor)
  └─ reads IP packets from TUN FileInputStream
  └─ parses IPv4 header → protocol=UDP, port=53
  └─ extracts DNS payload
  └─ DnsInterceptor.processQuery(payload)
       └─ parseDomainName() → "example.com"
       └─ DomainBlocklist.isBlocked("example.com")
            └─ checks whitelist (ConcurrentHashSet) → if match, allow
            └─ checks blocklist (ConcurrentHashSet) → suffix match (sub.example.com → example.com)
       └─ if blocked: buildNxdomainResponse() → RCODE=3
       └─ if allowed: return null
  └─ BLOCKED: buildResponseIpPacket() → write to TUN outputStream
  └─ ALLOWED: forwardDnsQuery() via DatagramSocket (protected to avoid VPN loop)
```

### JS-Side Services

| Service             | File                            | Purpose                                                      |
| ------------------- | ------------------------------- | ------------------------------------------------------------ |
| `BlocklistService`  | `services/BlocklistService.ts`  | Parse/merge domain lists, sync to native, fetch remote lists |
| `ProtectionService` | `services/ProtectionService.ts` | Start/stop VPN with blocklist sync, event subscriptions      |

### Layer 2: URL-Level Blocking (Accessibility Service)

The Accessibility Service monitors browser URL bars as a secondary check. This catches:

- Domains not in the blocklist but with adult content in URL paths
- URL keyword matching
- Navigation within already-loaded pages

**Status**: ✅ **FULLY IMPLEMENTED**. BrowserUrlMonitor extracts URLs via node tree, ContentMatcher checks domains/keywords, triggers about:blank + overlay broadcast.

### Layer 3: App Section Blocking (Reels Detection)

The same Accessibility Service detects when users enter reels/shorts sections of social media apps by identifying specific UI node IDs in the accessibility tree.

**Status**: ✅ **FULLY IMPLEMENTED**. ReelsDetector searches node tree for app-specific IDs, falls back to keyword scanning, reports state changes only.

### Layer 4: Response (Overlay + New Tab)

When content is detected:

1. OverlayService draws full-screen "Stay Away" overlay via WindowManager
2. For browser blocking: opens `about:blank` as a new tab
3. Overlay persists until safe content is confirmed

**Status**: ✅ **FULLY IMPLEMENTED**. OverlayService auto-shows on URL_BLOCKED and REELS_DETECTED broadcasts, auto-hides when reels cleared. Full-screen, touch-absorbing, display cutout aware.

---

### Layer 5: Settings Protection (Hardcore Mode)

In Hardcore mode, `SettingsProtector` monitors `com.android.settings` and `packageinstaller` packages. It blocks three categories of danger screens:

1. **App Info page**: Detects "Freedom" + danger keywords ("Uninstall", "Force stop", "Clear data") using manual accessibility tree traversal (`collectAllText`).
2. **Device Admin page**: Detects `DeviceAdminAdd` activity by class name (node tree is null on this activity).
3. **Accessibility Service page**: Detects attempts to disable Freedom's accessibility service.
4. **Package Installer**: Catches uninstall confirmation dialogs.

Key technical notes:

- Uses `collectAllText()` tree traversal instead of `findAccessibilityNodeInfosByText()` (broken on Android 14+ Compose-based Settings/`SpaActivity`).
- Hardcore mode state persisted via SharedPreferences (`freedom_settings`) to survive service restarts.
- Activity class detection runs before node tree access for activities where `rootInActiveWindow` returns null.

**Status**: FULLY IMPLEMENTED. Tested on Android 16 (Compose Settings).

### Layer 6: Scheduling

The `ProtectionService` evaluates the current system time against user-defined `ScheduleEntry` objects. If schedules are defined but the current time falls outside them, protection filters (VPN, Accessibility) return `false` on the dashboard status check, and some features can be bypassed until the next active window.

**Status**: ✅ **FULLY IMPLEMENTED**. Time-matching logic with overnight support.

---

## Native Module Communication

```
Native-to-Native: LocalBroadcastManager (low latency blocking)
Native-to-JS:     Expo Module events (stats, UI updates)
JS-to-Native:     Expo Module function calls (start/stop, config)
```

## Data Architecture

All blocking data is file-based for simplicity and extensibility:

- `data/domains/*.txt` — one domain per line, organized by category
- `data/keywords/*.txt` — one keyword per line
- `data/sources.json` — URLs to open-source blocklist repos
- Zustand stores persist user customizations (included/excluded URLs, toggles)

## State Management

| Store                | File                           | Purpose                                             | Persisted       |
| -------------------- | ------------------------------ | --------------------------------------------------- | --------------- |
| `useAppStore`        | `stores/useAppStore.ts`        | Protection status, stats, settings, onboarding flag | ✅ AsyncStorage |
| `useBlockingStore`   | `stores/useBlockingStore.ts`   | Keywords, URLs, categories, reels app toggles       | ✅ AsyncStorage |
| `useOnboardingStore` | `stores/useOnboardingStore.ts` | Per-permission grant status, current step           | ✅ AsyncStorage |

## Permission Flow

The `usePermissions` hook (`hooks/usePermissions.ts`) orchestrates all 5 permissions:

1. **Auto-check** on mount + when app returns from background (AppState listener)
2. **Request** via system dialog or deep-link to Settings
3. **Sync** granted status to `useOnboardingStore` + `useAppStore.protection`
4. **Graceful fallback** when native modules unavailable (web/dev mode)

## Extensibility Design

### Adding Browser Support

Browser configs are defined in `constants/browsers.ts` as a typed array. Adding a new browser requires only adding a new entry with the package name and URL bar resource ID.

### Adding Blocking Categories

Drop a `.txt` file into `data/domains/` or `data/keywords/`. The app reads all files in these directories and presents them as toggleable categories.

### Adding Reels App Support

Reels app configs are defined in `constants/reels.ts`. Adding support for a new app requires the package name and UI node IDs for the reels section.

---

## Key Android Permissions

Declared in `app.config.ts`:

- `INTERNET` — Network access
- `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_SPECIAL_USE` — Persistent service
- `SYSTEM_ALERT_WINDOW` — Draw overlay
- `RECEIVE_BOOT_COMPLETED` — Auto-start on reboot
- `POST_NOTIFICATIONS` — Foreground service notification
- `BIND_ACCESSIBILITY_SERVICE` — Accessibility service
- `BIND_DEVICE_ADMIN` — Device admin receiver
- `BIND_VPN_SERVICE` — Local VPN
