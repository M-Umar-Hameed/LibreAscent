# Freedom

**Take back control of your digital life.**

Freedom is a powerful, open-source Android application designed to help you break free from digital addictions. It provides a multi-layered defense system to block adult content, distracting apps, and other harmful distractors at the system level.

## Multi-Layered Protection

Freedom doesn't just block URLs; it secures your device across multiple layers to ensure you stay focused:

1. **DNS-Level Blocking (VPN):** A local DNS-intercepting VPN that returns NXDOMAIN for known adult and distraction domains. Zero battery impact for non-DNS traffic.
2. **URL-Level Blocking (Accessibility):** Real-time monitoring of browser address bars to catch adult content in URL paths and query strings that DNS might miss.
3. **System Overlay:** An un-skippable, full-screen "Stay Away" overlay that triggers immediately when harmful content is detected, covering the entire screen until you navigate away.
4. **App Blocking (Accessibility):** Block distracting apps from being opened. Supports per-app control modes (hard block, timer bypass, click bypass, scheduled blocking) with individual friction settings independent of the global control mode.
5. **Settings Protection (Hardcore Mode):** Prevents uninstalling the app, deactivating Device Admin, or disabling the Accessibility Service from system settings using accessibility tree monitoring and activity class detection.
6. **Scheduling:** Time-based blocking with per-day weekly schedules and overnight support.

## Key Features

- **Adult Content Blocking:** Pre-loaded with thousands of high-quality domain and keyword filters, with its own independent control mode.
- **App Blocking:** Block any installed app with per-app bypass settings — hard block, timer, click count, or scheduled time windows.
- **Keyword Blocking:** Prevent searches and visits to custom keywords.
- **Control Modes:**
  - **Flexible** - Standard app behavior, all settings freely accessible.
  - **Locked** - Settings changes require friction interventions (countdown timer or repeated taps).
  - **Hardcore** - Blocks uninstallation, Device Admin deactivation, and Accessibility Service disabling from system settings.
- **Weekly Schedules:** Configure protection to activate during specific time windows per day, with overnight schedule support.
- **Uninstall Protection:** Device Admin integration prevents impulsive uninstalls during moments of weakness.
- **Native Performance:** Built with React Native and high-performance Kotlin native modules for minimal resource usage.
- **Privacy First:** Everything happens on-device. No traffic is sent to external servers for filtering.
- **Persistent:** Foreground service with boot auto-start ensures protection survives app kills and device reboots.

## Architecture

```
Freedom/
  app/                    # Expo Router screens (Dashboard, Keywords, Sites, Apps, Settings, etc.)
  components/             # UI components (Atomic design)
  modules/                # 5 Custom Expo Native Modules (Kotlin)
    freedom-vpn-service/          # Local VPN for DNS blocking
    freedom-accessibility-service/ # Browser URL + Settings protection
    freedom-overlay/              # Full-screen "Stay Away" overlay
    freedom-foreground-service/   # Persistent background service + boot receiver
    freedom-device-admin/         # Uninstall protection via Device Admin
  services/               # Business logic (ProtectionService, BlocklistService)
  stores/                 # Zustand state (useAppStore, useBlockingStore, useOnboardingStore)
  constants/              # Browser configs, permissions
  data/                   # Domain and keyword blocklists (.txt files)
  hooks/                  # usePermissions, useColorScheme
  types/                  # TypeScript type definitions
```

### Blocking Flows

```
User opens browser -> adult site
  Layer 1: DNS query intercepted by VPN -> NXDOMAIN
  Layer 2: URL bar monitored by Accessibility -> keyword/domain match
  Response: Full-screen overlay + about:blank redirect

User opens blocked app
  Accessibility detects app package in foreground
  Control check: hard block / timer bypass / click bypass / scheduled window
  Response: Full-screen overlay until user navigates away
```

### Native Communication

```
Native <-> Native:  LocalBroadcastManager (low-latency blocking triggers)
Native -> JS:       Expo Module events (stats, UI updates)
JS -> Native:       Expo Module function calls (config, start/stop)
```

## Getting Started

### Prerequisites

- Windows, macOS, or Linux
- [Node.js (LTS)](https://nodejs.org/)
- [Android Studio](https://developer.android.com/studio) & SDK
- A physical Android device (required for testing VPN, Accessibility, and Overlay services)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/M-Umar-Hameed/Freedom.git
   cd Freedom
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Generate the native Android project:

   ```bash
   npx expo prebuild
   ```

4. Run on your device:
   ```bash
   npx expo run:android
   ```

## Tech Stack

- **Frontend:** React Native, Expo SDK 54, Expo Router, Zustand, NativeWind (Tailwind CSS v4)
- **Native (Android):** Kotlin, Expo Modules API, VpnService, AccessibilityService, WindowManager, DeviceAdminReceiver
- **Database:** expo-sqlite for blocking stats and URL logs
- **Styling:** Modern dark-themed UI with glassmorphism effects

## Contributing

We welcome contributions of all kinds!

- **New Browsers:** Add URL bar resource IDs to `constants/browsers.ts`.
- **Blocked Lists:** Add domains or keywords to the `data/` directory.

Please read our [CONTRIBUTING.md](./CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](./LICENSE) file for details.

---

Built with care for a freer mind.
