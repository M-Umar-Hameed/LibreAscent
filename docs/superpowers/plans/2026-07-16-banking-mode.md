# Banking Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings toggle that pauses LibreAscent's accessibility service for a hard-capped 5 minutes (so accessibility-hostile banking apps work), auto-restoring via an alarm plus launch/boot backstops, without weakening hardcore protection.

**Architecture:** A stateless native `BankingModeManager` writes `enabled_accessibility_services` via `WRITE_SECURE_SETTINGS` to remove only our service, persists a `bankingUntil` timestamp, and schedules an alarm (inexact, so no exact-alarm permission) to restore. A `BankingRestoreReceiver` handles both the alarm and `BOOT_COMPLETED`. JS wrappers expose start/end/state, the app calls an expiry backstop on launch, and a Settings card drives it with a live countdown.

**Tech Stack:** Kotlin Expo module, Android `Settings.Secure` + `AlarmManager`, Expo Modules API, React Native / TypeScript.

## Global Constraints

- Duration is fixed at `BANKING_DURATION_MS = 300_000` (5 minutes). Not user-configurable.
- Pause the accessibility service ONLY. Do not touch the VPN/DNS blocklist, device admin, foreground service, or the control-mode setting.
- Banking mode is control-mode-independent: identical in flexible/locked/hardcore, no friction, no cooldown.
- Requires `WRITE_SECURE_SETTINGS`, inert until granted once via `adb shell pm grant com.libreascent.app android.permission.WRITE_SECURE_SETTINGS`. When ungranted, `startBankingMode` rejects `ERR_NO_WRITE_SECURE_SETTINGS` and nothing is written.
- Service component string, verbatim: `com.libreascent.app/expo.modules.freedomaccessibility.FreedomAccessibilityService` (built as `"${context.packageName}/expo.modules.freedomaccessibility.FreedomAccessibilityService"`).
- SharedPreferences file `freedom_settings`, keys `banking_until` (Long) and `banking_saved_services` (String).
- No JS test runner. Gate: `npm --prefix mobile run typecheck` + `lint` (`--max-warnings 0`) for TS; `./gradlew :app:compileReleaseKotlin -PreactNativeArchitectures=arm64-v8a` for Kotlin (run from `mobile/android`). No emojis / no AI attribution in commits.

---

### Task 1: Native banking mechanism (manager + receiver + permission)

**Files:**
- Create: `mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/BankingModeManager.kt`
- Create: `mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/BankingRestoreReceiver.kt`
- Modify: `mobile/modules/freedom-accessibility-service/android/src/main/AndroidManifest.xml`
- Modify: `mobile/app.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `BankingModeManager.hasWriteSecureSettings(context): Boolean`
  - `BankingModeManager.isActive(context): Boolean`
  - `BankingModeManager.remainingMs(context): Long`
  - `BankingModeManager.start(context)` (throws `SecurityException` if ungranted)
  - `BankingModeManager.restore(context)`
  - `BankingModeManager.enforceExpiry(context)`
  - `BankingModeManager.restoreIfPending(context)`
  - `BankingModeManager.ACTION_RESTORE = "expo.modules.freedomaccessibility.BANKING_RESTORE"`

- [ ] **Step 1: Create `BankingModeManager.kt`**

```kotlin
package expo.modules.freedomaccessibility

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.util.Log

/**
 * Time-boxed pause of LibreAscent's own accessibility service so that
 * accessibility-hostile banking apps can run. Only the accessibility service
 * is touched; the VPN/DNS blocklist and device admin stay active.
 */
object BankingModeManager {
    private const val TAG = "BankingMode"
    private const val PREFS = "freedom_settings"
    private const val KEY_UNTIL = "banking_until"
    private const val KEY_SAVED = "banking_saved_services"
    private const val ALARM_REQUEST_CODE = 24603

    const val BANKING_DURATION_MS = 300_000L
    const val ACTION_RESTORE = "expo.modules.freedomaccessibility.BANKING_RESTORE"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun serviceComponent(context: Context): String =
        "${context.packageName}/expo.modules.freedomaccessibility.FreedomAccessibilityService"

    fun hasWriteSecureSettings(context: Context): Boolean =
        context.checkSelfPermission(android.Manifest.permission.WRITE_SECURE_SETTINGS) ==
            PackageManager.PERMISSION_GRANTED

    fun isActive(context: Context): Boolean {
        val until = prefs(context).getLong(KEY_UNTIL, 0L)
        return until > 0L && System.currentTimeMillis() < until
    }

    fun remainingMs(context: Context): Long {
        val until = prefs(context).getLong(KEY_UNTIL, 0L)
        return if (until > 0L) maxOf(0L, until - System.currentTimeMillis()) else 0L
    }

    fun start(context: Context) {
        if (!hasWriteSecureSettings(context)) {
            throw SecurityException("WRITE_SECURE_SETTINGS not granted")
        }
        val resolver = context.contentResolver
        val current = Settings.Secure.getString(
            resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: ""
        val component = serviceComponent(context)
        val filtered = current.split(":")
            .filter { it.isNotBlank() && it != component }
            .joinToString(":")

        val until = System.currentTimeMillis() + BANKING_DURATION_MS
        prefs(context).edit()
            .putString(KEY_SAVED, current)
            .putLong(KEY_UNTIL, until)
            .apply()

        Settings.Secure.putString(
            resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, filtered
        )
        scheduleAlarm(context, until)
        Log.i(TAG, "Banking mode started until $until")
    }

    fun restore(context: Context) {
        val resolver = context.contentResolver
        val saved = prefs(context).getString(KEY_SAVED, null)
        val component = serviceComponent(context)
        val target = when {
            saved.isNullOrBlank() -> component
            saved.split(":").any { it == component } -> saved
            else -> "$saved:$component"
        }
        Settings.Secure.putString(
            resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, target
        )
        Settings.Secure.putInt(resolver, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
        prefs(context).edit().remove(KEY_UNTIL).remove(KEY_SAVED).apply()
        cancelAlarm(context)
        Log.i(TAG, "Banking mode restored")
    }

    /** Restore only if the window has already elapsed (app-launch backstop). */
    fun enforceExpiry(context: Context) {
        val until = prefs(context).getLong(KEY_UNTIL, 0L)
        if (until > 0L && System.currentTimeMillis() >= until) restore(context)
    }

    /** A reboot ends any banking session immediately (boot backstop). */
    fun restoreIfPending(context: Context) {
        if (prefs(context).getLong(KEY_UNTIL, 0L) > 0L) restore(context)
    }

    private fun scheduleAlarm(context: Context, triggerAt: Long) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        // Inexact on purpose: exact alarms need SCHEDULE_EXACT_ALARM on API 31+.
        // A few minutes of Doze slack is fine here; the app-launch and boot
        // backstops restore precisely when the user next opens the app / reboots.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, alarmIntent(context))
    }

    private fun cancelAlarm(context: Context) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(alarmIntent(context))
    }

    private fun alarmIntent(context: Context): PendingIntent {
        val intent = Intent(context, BankingRestoreReceiver::class.java)
            .setAction(ACTION_RESTORE)
        return PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
```

- [ ] **Step 2: Create `BankingRestoreReceiver.kt`**

```kotlin
package expo.modules.freedomaccessibility

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restores the accessibility service when the banking window ends (alarm) or
 * when the device boots with a pending window (a reboot ends the session).
 */
class BankingRestoreReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> BankingModeManager.restoreIfPending(context)
            else -> BankingModeManager.restore(context)
        }
    }
}
```

- [ ] **Step 3: Register the receiver and permission in the module manifest**

In `mobile/modules/freedom-accessibility-service/android/src/main/AndroidManifest.xml`, add the `tools` namespace to the root `<manifest>` tag, a `<uses-permission>`, and the receiver inside `<application>`. The full file becomes:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
    <uses-permission
        android:name="android.permission.WRITE_SECURE_SETTINGS"
        tools:ignore="ProtectedPermissions" />
    <application>
        <service
            android:name="expo.modules.freedomaccessibility.FreedomAccessibilityService"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
            android:exported="false"
            android:label="LibreAscent Content Protection">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data
                android:name="android.accessibilityservice"
                android:resource="@xml/accessibility_service_config" />
        </service>
        <receiver
            android:name="expo.modules.freedomaccessibility.BankingRestoreReceiver"
            android:enabled="true"
            android:exported="true">
            <intent-filter>
                <action android:name="expo.modules.freedomaccessibility.BANKING_RESTORE" />
                <action android:name="android.intent.action.BOOT_COMPLETED" />
            </intent-filter>
        </receiver>
    </application>
</manifest>
```

- [ ] **Step 4: Add the permission to `app.config.ts`**

In `mobile/app.config.ts`, add `"WRITE_SECURE_SETTINGS"` to the `android.permissions` array (after `"BIND_VPN_SERVICE"`):

```ts
      "BIND_VPN_SERVICE",
      "WRITE_SECURE_SETTINGS",
```

- [ ] **Step 5: Compile the native module**

Run from `mobile/android`: `./gradlew :app:compileReleaseKotlin -PreactNativeArchitectures=arm64-v8a --console=plain`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/BankingModeManager.kt mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/BankingRestoreReceiver.kt mobile/modules/freedom-accessibility-service/android/src/main/AndroidManifest.xml mobile/app.config.ts
git commit -m "feat(mobile): add native banking-mode accessibility pause mechanism"
```

---

### Task 2: Module bridge + JS wrappers

**Files:**
- Modify: `mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/FreedomAccessibilityModule.kt`
- Modify: `mobile/modules/freedom-accessibility-service/src/index.ts`

**Interfaces:**
- Consumes: `BankingModeManager` from Task 1.
- Produces (JS):
  - `hasWriteSecureSettings(): Promise<boolean>`
  - `getBankingState(): Promise<{ active: boolean; remainingMs: number }>`
  - `startBankingMode(): Promise<void>` (rejects `ERR_NO_WRITE_SECURE_SETTINGS`)
  - `endBankingMode(): Promise<void>`
  - `enforceBankingExpiry(): Promise<void>`

- [ ] **Step 1: Add AsyncFunctions to the module**

In `FreedomAccessibilityModule.kt`, inside the `definition()` block, add these `AsyncFunction`s (place them after the existing `getInstalledApps` function, before the closing `}` of `ModuleDefinition`):

```kotlin
        AsyncFunction("hasWriteSecureSettings") { promise: Promise ->
            val context = appContext.reactContext
            promise.resolve(context != null && BankingModeManager.hasWriteSecureSettings(context))
        }

        AsyncFunction("getBankingState") { promise: Promise ->
            val context = appContext.reactContext
            if (context == null) {
                promise.resolve(mapOf("active" to false, "remainingMs" to 0.0))
                return@AsyncFunction
            }
            promise.resolve(
                mapOf(
                    "active" to BankingModeManager.isActive(context),
                    "remainingMs" to BankingModeManager.remainingMs(context).toDouble()
                )
            )
        }

        AsyncFunction("startBankingMode") { promise: Promise ->
            val context = appContext.reactContext
                ?: run {
                    promise.reject("ERR_NO_CONTEXT", "No context", null)
                    return@AsyncFunction
                }
            if (!BankingModeManager.hasWriteSecureSettings(context)) {
                promise.reject(
                    "ERR_NO_WRITE_SECURE_SETTINGS",
                    "WRITE_SECURE_SETTINGS not granted",
                    null
                )
                return@AsyncFunction
            }
            try {
                BankingModeManager.start(context)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_BANKING_START", e.message, e)
            }
        }

        AsyncFunction("endBankingMode") { promise: Promise ->
            val context = appContext.reactContext
                ?: run {
                    promise.reject("ERR_NO_CONTEXT", "No context", null)
                    return@AsyncFunction
                }
            try {
                BankingModeManager.restore(context)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_BANKING_END", e.message, e)
            }
        }

        AsyncFunction("enforceBankingExpiry") { promise: Promise ->
            val context = appContext.reactContext
            try {
                if (context != null) BankingModeManager.enforceExpiry(context)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.resolve(null)
            }
        }
```

- [ ] **Step 2: Add the methods to the JS interface**

In `mobile/modules/freedom-accessibility-service/src/index.ts`, add these lines to the `FreedomAccessibilityModuleInterface` interface (after `getInstalledApps(...)`):

```ts
  hasWriteSecureSettings(): Promise<boolean>;
  getBankingState(): Promise<{ active: boolean; remainingMs: number }>;
  startBankingMode(): Promise<void>;
  endBankingMode(): Promise<void>;
  enforceBankingExpiry(): Promise<void>;
```

- [ ] **Step 3: Add the exported wrappers**

In `mobile/modules/freedom-accessibility-service/src/index.ts`, add these exports (after the existing `getInstalledApps` export, before the event-listener section):

```ts
export async function hasWriteSecureSettings(): Promise<boolean> {
  if (!FreedomAccessibilityNative) return false;
  return FreedomAccessibilityNative.hasWriteSecureSettings();
}

export async function getBankingState(): Promise<{
  active: boolean;
  remainingMs: number;
}> {
  if (!FreedomAccessibilityNative) return { active: false, remainingMs: 0 };
  return FreedomAccessibilityNative.getBankingState();
}

export async function startBankingMode(): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.startBankingMode();
}

export async function endBankingMode(): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.endBankingMode();
}

export async function enforceBankingExpiry(): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.enforceBankingExpiry();
}
```

- [ ] **Step 4: Verify**

Run from `mobile/android`: `./gradlew :app:compileReleaseKotlin -PreactNativeArchitectures=arm64-v8a --console=plain`
Expected: `BUILD SUCCESSFUL`.

Run from `D:/Github/LibreAscent`: `npm --prefix mobile run typecheck` and `npm --prefix mobile run lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/FreedomAccessibilityModule.kt mobile/modules/freedom-accessibility-service/src/index.ts
git commit -m "feat(mobile): expose banking-mode start/end/state to JS"
```

---

### Task 3: Launch backstop

**Files:**
- Modify: `mobile/app/_layout.tsx`

**Interfaces:**
- Consumes: `enforceBankingExpiry` from Task 2.
- Produces: on every app launch, an expired banking window is restored.

- [ ] **Step 1: Import the accessibility module**

In `mobile/app/_layout.tsx`, add near the other service imports at the top:

```ts
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
```

- [ ] **Step 2: Call the expiry backstop on launch**

In `mobile/app/_layout.tsx`, inside `RootLayout`, add this effect next to the other launch effects:

```ts
  useEffect(() => {
    void FreedomAccessibility.enforceBankingExpiry().catch(() => {
      /* ignore */
    });
  }, []);
```

- [ ] **Step 3: Verify**

Run from `D:/Github/LibreAscent`: `npm --prefix mobile run typecheck` and `npm --prefix mobile run lint`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/_layout.tsx"
git commit -m "feat(mobile): restore expired banking window on app launch"
```

---

### Task 4: Settings card

**Files:**
- Modify: `mobile/app/(tabs)/settings.tsx`

**Interfaces:**
- Consumes: `hasWriteSecureSettings`, `getBankingState`, `startBankingMode`, `endBankingMode` from Task 2.
- Produces: a "Banking Mode" card in the Protection section with a live countdown and a not-granted setup state.

- [ ] **Step 1: Add imports**

In `mobile/app/(tabs)/settings.tsx`, add at the top (alongside the other imports):

```ts
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
```

If `useEffect` is not already imported from `react`, add it to that import.

- [ ] **Step 2: Add banking state + polling inside `SettingsScreen`**

Add near the other `useState` hooks in `SettingsScreen`:

```ts
  const [bankingActive, setBankingActive] = useState(false);
  const [bankingRemainingMs, setBankingRemainingMs] = useState(0);
  const [bankingHasPermission, setBankingHasPermission] = useState(true);

  useEffect(() => {
    let mounted = true;
    const poll = async (): Promise<void> => {
      try {
        const [state, perm] = await Promise.all([
          FreedomAccessibility.getBankingState(),
          FreedomAccessibility.hasWriteSecureSettings(),
        ]);
        if (!mounted) return;
        setBankingActive(state.active);
        setBankingRemainingMs(state.remainingMs);
        setBankingHasPermission(perm);
      } catch {
        /* ignore */
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleBankingToggle = async (enable: boolean): Promise<void> => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (enable) {
        await FreedomAccessibility.startBankingMode();
      } else {
        await FreedomAccessibility.endBankingMode();
      }
      const state = await FreedomAccessibility.getBankingState();
      setBankingActive(state.active);
      setBankingRemainingMs(state.remainingMs);
    } catch (e) {
      console.error("[Settings] Banking mode toggle failed:", e);
      Alert.alert(
        "Banking mode unavailable",
        "Grant the one-time permission with adb, then try again.",
      );
    }
  };

  const bankingCountdown = (): string => {
    const total = Math.max(0, Math.ceil(bankingRemainingMs / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };
```

- [ ] **Step 3: Add the card to the Protection section**

In the Protection `View` (the card with the Auto-start, App Lock, and Block Ads rows), add this row after the last existing row, before the card's closing `</View>`:

```tsx
          <View className="p-4 border-t border-gray-800">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text style={{ color: t.textColor }}>Banking Mode</Text>
                <Text className="text-sm" style={{ color: t.mutedTextColor }}>
                  {!bankingHasPermission
                    ? "One-time setup required (see below)"
                    : bankingActive
                      ? `Accessibility paused - ${bankingCountdown()} left`
                      : "Pause accessibility 5 min to use banking apps"}
                </Text>
              </View>
              <Switch
                value={bankingActive}
                disabled={!bankingHasPermission}
                onValueChange={(v) => void handleBankingToggle(v)}
                trackColor={{ false: "#ccc", true: t.accentColor }}
                thumbColor={bankingActive ? "#fff" : "#999"}
                aria-label="Toggle banking mode"
              />
            </View>
            {!bankingHasPermission && (
              <View
                className="mt-3 p-3 rounded-lg"
                style={{ backgroundColor: t.bgColor }}
              >
                <Text className="text-xs mb-2" style={{ color: t.mutedTextColor }}>
                  Run once from a PC with USB debugging on:
                </Text>
                <Text
                  selectable
                  className="text-xs"
                  style={{ color: t.accentColor, fontFamily: "monospace" }}
                >
                  adb shell pm grant com.libreascent.app
                  android.permission.WRITE_SECURE_SETTINGS
                </Text>
              </View>
            )}
          </View>
```

- [ ] **Step 4: Verify**

Run from `D:/Github/LibreAscent`: `npm --prefix mobile run typecheck` and `npm --prefix mobile run lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(tabs)/settings.tsx"
git commit -m "feat(mobile): add Banking Mode card to Settings"
```

---

### Task 5: On-device verification

**Files:** none (manual).

**Interfaces:**
- Consumes: all prior tasks.

- [ ] **Step 1: Build + install**

Run from `mobile/android`: `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain`
Expected: `BUILD SUCCESSFUL`; install `app/build/outputs/apk/release/app-release.apk` (uninstall old first).

- [ ] **Step 2: Not-granted state**

Open Settings → Protection before granting. Expected: Banking Mode card disabled, shows the adb command.

- [ ] **Step 3: Grant + activate**

Run `adb shell pm grant com.libreascent.app android.permission.WRITE_SECURE_SETTINGS`. Reopen Settings, toggle Banking Mode on. Expected: LibreAscent's accessibility service turns off in system Accessibility settings; countdown ticks down.

- [ ] **Step 4: Banking app works, porn still blocked**

Open HBL — it should now run. Open a browser to an explicit domain — still blocked (DNS layer on).

- [ ] **Step 5: Auto-restore**

Wait 5 minutes (or toggle off early). Expected: accessibility service re-enables automatically; card returns to inactive.

- [ ] **Step 6: Backstops**

Toggle on, force-stop the app, reopen → restored. Toggle on, reboot the device → restored on boot.

---

## Notes

- If the grant is missing, `startBankingMode` rejects and nothing is written — the toggle never leaves you half-paused.
- Accepted limitation (documented in the spec): during the window `SettingsProtector` is not guarding the device-admin-deactivate screen; a deliberate user could uninstall within 5 minutes. Porn stays DNS-blocked throughout.
