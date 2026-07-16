# Banking Mode Design

## Goal

Let a user temporarily pause LibreAscent's accessibility service so accessibility-hostile banking apps (e.g. HBL, `com.hbl.android.hblmobilebanking`) work, with a hard 5-minute cap after which the accessibility service is automatically re-enabled. The pause must not let the user browse explicit content and must layer on top of hardcore control mode without weakening it.

## Scope

Included:

- A native "banking mode" that removes only LibreAscent's own accessibility service from `enabled_accessibility_services`, then restores it after at most 5 minutes.
- A hard 5-minute cap enforced by an exact alarm, with a backstop on app launch and device boot so a lost alarm can't leave protection off indefinitely.
- A Settings toggle with a live countdown, and a clear one-time-setup state when the required permission is not yet granted.

Excluded:

- Any user-configurable duration (the 5-minute cap is fixed and not editable).
- Cooldowns or friction to start banking mode (unlimited re-triggers; the 5-minute cap is the only guard).
- Pausing anything other than the accessibility service. The VPN/DNS blocklist, device admin, foreground service, and the control-mode setting are all untouched.
- Rooted/LSPosed "hide the service from the bank" approaches. Banking mode disables the service, it does not cloak it.

## Background

Android exposes every enabled accessibility service to all apps via `Settings.Secure.enabled_accessibility_services` and `AccessibilityManager`. Banking apps enumerate that list and refuse to run when a non-whitelisted service is active. There is no unrooted way to keep the service enabled and hide it, so the only option is to disable it for the banking session.

An app can modify `enabled_accessibility_services` only with `WRITE_SECURE_SETTINGS`, a signature/privileged permission that can be granted once per install via adb:

```
adb shell pm grant com.libreascent.app android.permission.WRITE_SECURE_SETTINGS
```

Until it is granted, banking mode is inert and the UI shows the command.

## Design

### Component

Extend the existing `freedom-accessibility-service` module — it already owns the accessibility service. Add:

- `BankingModeManager.kt` — a stateless object holding all banking logic (start, restore, end, state, expiry enforcement, alarm scheduling). Single source of truth so the module and the receivers share one implementation.
- `BankingRestoreReceiver.kt` — a `BroadcastReceiver` the alarm fires into; it calls `BankingModeManager.restore(context)`.
- New `AsyncFunction`s on `FreedomAccessibilityModule`.

Banking state lives in the existing `freedom_settings` SharedPreferences:

- `banking_until` — `Long`, epoch millis when the window ends (absent when inactive).
- `banking_saved_services` — `String`, the exact `enabled_accessibility_services` value captured at start, restored verbatim.

The accessibility service component string is:
`com.libreascent.app/expo.modules.freedomaccessibility.FreedomAccessibilityService`

Fixed constant: `BANKING_DURATION_MS = 300_000` (5 minutes).

### Mechanism

`BankingModeManager.start(context)`:

1. If `WRITE_SECURE_SETTINGS` is not granted, throw a typed failure the module maps to `ERR_NO_WRITE_SECURE_SETTINGS`.
2. Read the current `enabled_accessibility_services`; save it to `banking_saved_services` and set `banking_until = now + BANKING_DURATION_MS`.
3. Remove **only** our component from the list and write the result back via `Settings.Secure.putString`. The OS disables our accessibility service (its `onDestroy` fires).
4. Schedule an exact alarm (`AlarmManager.setExactAndAllowWhileIdle`) at `banking_until` targeting `BankingRestoreReceiver` (action `expo.modules.freedomaccessibility.BANKING_RESTORE`).

`BankingModeManager.restore(context)`:

1. Write `banking_saved_services` back to `enabled_accessibility_services` (re-adds our component → OS re-enables the service) and set `accessibility_enabled = 1`. If the saved value did not contain our component, append it before writing, so restore always turns protection back on.
2. Clear `banking_until` and `banking_saved_services`; cancel the pending alarm.

`BankingModeManager.end(context)` — manual early end: same as `restore`.

`BankingModeManager.enforceExpiry(context)` — backstop: if `banking_until` is set and `now >= banking_until`, call `restore`. Used on app launch (see below).

`BankingModeManager.state(context)` → `{ active: Boolean, remainingMs: Long }` where `active = banking_until != absent && now < banking_until` and `remainingMs = max(0, banking_until - now)`.

### Expiry backstop (why more than the alarm)

The accessibility service is off during the window, so its `OnCreate` cannot run the check. The backstop therefore lives where code still runs while the service is off:

- **Alarm** (primary): restores at the scheduled time even if the app UI is backgrounded.
- **App launch** (JS `_layout` calls `enforceBankingExpiry`): if the window already expired while the app was away, restore immediately.
- **Boot** (`freedom-foreground` `BootReceiver`): a reboot ends any banking session — if `banking_until` is present at boot, restore immediately and clear it, so a pause never survives a reboot.

Force-stop during the window cancels the alarm (Android behavior); the app-launch backstop restores on next open. Force-stop already halts all protection, so this introduces no new hole.

### Hardcore layering

Banking mode is control-mode-independent — identical in flexible, locked, and hardcore, with no friction or cooldown. It pauses only the accessibility service; during the window:

- VPN/DNS adult blocking stays on → explicit domains remain NXDOMAIN'd; the user cannot load porn even mid-banking.
- Device admin stays active → the app still cannot be uninstalled.
- The control-mode setting is unchanged; after ≤5 minutes the accessibility service and its `SettingsProtector` auto-restore → full hardcore is back.

The pause writes secure settings directly, never through the Settings UI that `SettingsProtector` guards, so hardcore's tamper-bounce neither fights nor flags banking mode.

**Accepted limitation:** while accessibility is paused, `SettingsProtector` is not bouncing the user out of the device-admin-deactivate screen. A deliberate user could, within the 5-minute window, deactivate device admin and uninstall. This is a "quit the app entirely" path, not an impulse-to-explicit-content path (porn stays DNS-blocked throughout), and it is time-boxed. It is documented, not defended against, in this version.

### Permission

Add `WRITE_SECURE_SETTINGS` to the Android manifest (via `app.config.ts` permissions and the module manifest). It is inert until granted once per install via the adb command above. `hasWriteSecureSettings()` reports whether it is granted so the UI can show setup instructions.

### JS interface (`freedom-accessibility-service/src/index.ts`)

- `hasWriteSecureSettings(): Promise<boolean>`
- `getBankingState(): Promise<{ active: boolean; remainingMs: number }>`
- `startBankingMode(): Promise<void>` — rejects `ERR_NO_WRITE_SECURE_SETTINGS` when ungranted.
- `endBankingMode(): Promise<void>`
- `enforceBankingExpiry(): Promise<void>` — called once on app launch.

### UI (`app/(tabs)/settings.tsx`)

A "Banking Mode" card in the Protection section, polling `getBankingState` on a 1s interval while mounted:

- **Permission not granted:** card disabled, subtitle explains one-time setup, shows the adb command in a copyable code block and a "Re-check" button (`hasWriteSecureSettings`).
- **Granted, inactive:** toggle off, subtitle "Pause protection for 5 minutes to use banking apps".
- **Active:** toggle on, subtitle shows a live `m:ss` countdown from `remainingMs`; toggling off calls `endBankingMode` (early restore).

## Data flow

1. User toggles banking mode on → `startBankingMode()` → `BankingModeManager.start` disables our a11y service, saves state, schedules the alarm.
2. Banking app now sees no active accessibility service and runs.
3. At +5 min the alarm fires → `BankingRestoreReceiver` → `restore` re-enables the service; hardcore fully back.
4. If the app is reopened after expiry, `enforceBankingExpiry` restores as a backstop; on reboot, `BootReceiver` restores.

## Error handling

- `WRITE_SECURE_SETTINGS` ungranted: `startBankingMode` rejects `ERR_NO_WRITE_SECURE_SETTINGS`; UI shows setup, never leaves the user in a half-paused state (nothing is written).
- Secure-settings write failure (`SecurityException`): surfaced as a rejected promise; state is not persisted so no dangling pause.
- Missing `banking_saved_services` at restore time: fall back to writing just our component so protection is always restored.

## Testing

No JS unit-test runner exists; verification is `npm --prefix mobile run typecheck` + `lint` per touched TS file, the Android build for Kotlin, and manual on-device checks:

- Without the grant: card shows setup instructions; toggle does nothing.
- After the grant: toggle on → LibreAscent's accessibility service turns off in system settings; HBL runs.
- During the window: an explicit domain is still blocked (DNS layer on); a countdown ticks down.
- At 5 min (or manual off): the accessibility service re-enables automatically.
- Backstops: force-stop mid-window then reopen → restored; reboot mid-window → restored on boot.

## Files touched

- `mobile/modules/freedom-accessibility-service/android/.../BankingModeManager.kt` — new.
- `mobile/modules/freedom-accessibility-service/android/.../BankingRestoreReceiver.kt` — new.
- `mobile/modules/freedom-accessibility-service/android/.../FreedomAccessibilityModule.kt` — new `AsyncFunction`s.
- `mobile/modules/freedom-accessibility-service/android/src/main/AndroidManifest.xml` — receiver + `WRITE_SECURE_SETTINGS`.
- `mobile/modules/freedom-foreground-service/android/.../BootReceiver.kt` — boot backstop.
- `mobile/modules/freedom-accessibility-service/src/index.ts` — JS wrappers.
- `mobile/app.config.ts` — `WRITE_SECURE_SETTINGS` permission.
- `mobile/app/(tabs)/settings.tsx` — Banking Mode card.
- `mobile/app/_layout.tsx` — call `enforceBankingExpiry` on launch.

## Future work (not in scope)

- Optional cooldown/friction if abuse proves a problem.
- Closing the device-admin gap during the window (e.g. a lightweight device-admin-screen watch that survives the accessibility pause).
