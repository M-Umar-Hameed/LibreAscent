# Mobile Ad Blocker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in "Block Ads & Trackers" toggle to the mobile app that blocks ad/tracker domains network-wide via the VPN/DNS layer, independent of the adult-content toggle.

**Architecture:** A new `ads` blocking category joins the existing `adult`/`hentai` categories, fed by a bundled HaGeZi Ultimate source. The category is driven only by its own `enabled` flag (never gated by `adultBlockingEnabled`) and enforced by adding/removing a category in the native VPN `DomainBlocklist`. A Settings toggle flips the flag and, on first enable, fetches the list.

**Tech Stack:** Expo / React Native, Zustand (SQLite-persisted), Kotlin Expo modules, TypeScript.

## Global Constraints

- Ad blocking ships **opt-in** (ads category `enabled: false` by default). Do not force it on.
- Ad blocking must remain active when `adultBlockingEnabled` is `false`. No `adultBlockingEnabled` gate on the `ads` category anywhere.
- Blocklist URL (verbatim): `https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/ultimate.txt`, format `"domains"`.
- No new test framework. Per-task gate: `npm --prefix mobile run typecheck` and `npm --prefix mobile run lint`, both zero-error. `lint` runs with `--max-warnings 0`.
- No emojis, no AI attribution in commits. Match existing code style (Prettier is enforced by lint-staged).
- Do not add `adsCategoryDomains` to `getProtectionSnapshot` (YAGNI).

---

### Task 1: Data model — `ads` category, HaGeZi source, source `category` field, migration

**Files:**
- Modify: `mobile/types/blocking.ts` (`BlocklistSource` interface)
- Modify: `mobile/stores/useBlockingStore.ts` (`DEFAULT_SOURCES`, initial `categories`, `onRehydrateStorage`)

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `BlocklistSource.category?: "adult" | "hentai" | "ads"`
  - Store initial `categories` includes an `ads` entry (`enabled: false`).
  - `DEFAULT_SOURCES` includes a source `{ id: "hagezi-ultimate", category: "ads", format: "domains", enabled: true }`.
  - Existing-user migration injects the `ads` category on rehydrate.

- [ ] **Step 1: Add the optional `category` field to `BlocklistSource`**

In `mobile/types/blocking.ts`, change the interface:

```ts
export interface BlocklistSource {
  id: string;
  url: string;
  name: string;
  enabled: boolean;
  format: "domains" | "hosts" | "keywords";
  category?: "adult" | "hentai" | "ads";
  lastFetchedAt?: string;
}
```

- [ ] **Step 2: Add the HaGeZi source to `DEFAULT_SOURCES`**

In `mobile/stores/useBlockingStore.ts`, append to the `DEFAULT_SOURCES` array (after the `oisd-nsfw` entry):

```ts
  {
    id: "hagezi-ultimate",
    name: "HaGeZi Ultimate (Ads/Trackers)",
    url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/ultimate.txt",
    format: "domains",
    enabled: true,
    category: "ads",
  },
```

- [ ] **Step 3: Extract default categories to a module const including `ads`**

In `mobile/stores/useBlockingStore.ts`, add above the `useBlockingStore` definition (near `DEFAULT_SOURCES`):

```ts
export const ADS_CATEGORY: BlockingCategory = {
  id: "ads",
  name: "Ads & Trackers",
  description:
    "Blocks ad, tracker, and telemetry domains network-wide via DNS. Aggressive — whitelist sites that break.",
  domains: [],
  enabled: false,
};

export const DEFAULT_CATEGORIES: BlockingCategory[] = [
  {
    id: "adult",
    name: "Adult Content",
    description: "General adult and pornographic websites",
    domains: [],
    enabled: true,
  },
  {
    id: "hentai",
    name: "Hentai",
    description:
      "Animated adult content and manga. (Contains some manga sites; whitelist your fav manga/manhwa/manhua if needed)",
    domains: [],
    enabled: true,
  },
  ADS_CATEGORY,
];
```

- [ ] **Step 4: Use `DEFAULT_CATEGORIES` in the store's initial state**

In `mobile/stores/useBlockingStore.ts`, replace the inline `categories: [ … ]` initial value (the `adult` + `hentai` array) with:

```ts
      categories: [...DEFAULT_CATEGORIES],
```

- [ ] **Step 5: Migrate existing users in `onRehydrateStorage`**

In `mobile/stores/useBlockingStore.ts`, in `onRehydrateStorage`, replace the categories-restore block (the `if (state.categories.length === 0) { state.importSettings({ categories: [ … ] }); }` block) with:

```ts
          // Restore default categories if persisted state has none
          if (state.categories.length === 0) {
            state.importSettings({ categories: [...DEFAULT_CATEGORIES] });
          } else if (!state.categories.some((c) => c.id === "ads")) {
            // Existing user predating the ads category — inject it (disabled)
            state.importSettings({
              categories: [...state.categories, ADS_CATEGORY],
            });
          }
```

Leave the `sources` force-reset (`state.importSettings({ sources: [...DEFAULT_SOURCES] })`) and the URL-migration blocks unchanged.

- [ ] **Step 6: Typecheck and lint**

Run: `npm --prefix mobile run typecheck`
Expected: no errors.

Run: `npm --prefix mobile run lint`
Expected: no errors, no warnings.

- [ ] **Step 7: Commit**

```bash
git add mobile/types/blocking.ts mobile/stores/useBlockingStore.ts
git commit -m "feat(mobile): add opt-in ads blocking category and HaGeZi source"
```

---

### Task 2: BlocklistService — explicit source mapping, un-gate `ads`, de-hardcode category loop

**Files:**
- Modify: `mobile/services/BlocklistService.ts` (`getCategoryForSource`, `syncCategoryFlagsToNative`, `syncDomainsToNative`, `syncVpnCategoryToggle`, `syncAllCategoriesFromCache`, `updateBlocklists`)

**Interfaces:**
- Consumes: `BlocklistSource.category` and the `ads` category from Task 1.
- Produces: sync functions treat `id === "ads"` as always-master-on; `updateBlocklists` iterates the live category ids.

- [ ] **Step 1: Make `getCategoryForSource` honor an explicit `category`**

In `mobile/services/BlocklistService.ts`, replace `getCategoryForSource`:

```ts
  getCategoryForSource: (source: {
    id: string;
    name: string;
    category?: string;
  }): string => {
    if (source.category) return source.category;
    const isHentai =
      source.id === "hentai-refined" ||
      source.id === "hentai-blocklist" ||
      source.name.toLowerCase().includes("hentai");
    return isHentai ? "hentai" : "adult";
  },
```

- [ ] **Step 2: Un-gate `ads` in `syncCategoryFlagsToNative`**

Replace the category loop body in `syncCategoryFlagsToNative`:

```ts
    for (const category of state.categories) {
      const masterOn =
        category.id === "ads" ? true : state.adultBlockingEnabled;
      try {
        await FreedomAccessibility.setCategoryEnabled(
          category.id,
          masterOn && category.enabled,
        );
      } catch (e) {
        console.warn(
          `[BlocklistService] Failed to sync category ${category.id} enabled:`,
          e,
        );
      }
    }
```

- [ ] **Step 3: Un-gate `ads` in `syncDomainsToNative`**

In `syncDomainsToNative`, inside `for (const category of state.categories)`, replace the `isActive` computation:

```ts
      const nativeCount = state.categoryDomainCounts[category.id] ?? 0;
      const hasDomains = category.domains.length > 0 || nativeCount > 0;
      const masterOn =
        category.id === "ads" ? true : state.adultBlockingEnabled;
      const isActive = masterOn && category.enabled && hasDomains;
```

- [ ] **Step 4: Un-gate `ads` in `syncVpnCategoryToggle`**

In `syncVpnCategoryToggle`, replace the `if (enabled && state.adultBlockingEnabled) {` guard:

```ts
    const masterOn =
      categoryId === "ads" ? true : state.adultBlockingEnabled;
    try {
      if (enabled && masterOn) {
        await FreedomVpn.removeCategory(categoryId);
        if (category.domains.length > 0) {
          await FreedomVpn.addCategory(categoryId, category.domains);
        } else if (getCachedDomainCount(categoryId) > 0) {
          await BlocklistService.syncCategoryFromCache(categoryId, {
            syncVpn: true,
            syncAccessibility: false,
          });
        }
      } else {
        await FreedomVpn.removeCategory(categoryId);
      }
    } catch (e) {
      console.warn(
        `[BlocklistService] Failed to sync VPN category ${categoryId}:`,
        e,
      );
    }
```

- [ ] **Step 5: Un-gate `ads` in `syncAllCategoriesFromCache`**

In `syncAllCategoriesFromCache`, replace the early return + loop guard. Change:

```ts
    const state = useBlockingStore.getState();
    if (!state.adultBlockingEnabled) return;

    for (const category of state.categories) {
      if (!category.enabled) continue;
```

to:

```ts
    const state = useBlockingStore.getState();

    for (const category of state.categories) {
      const masterOn =
        category.id === "ads" ? true : state.adultBlockingEnabled;
      if (!masterOn || !category.enabled) continue;
```

- [ ] **Step 6: De-hardcode the category loops in `updateBlocklists`**

In `updateBlocklists`, phase 2, before the first `for (const categoryId of ["adult", "hentai"])` loop, add:

```ts
      const categoryIds = useBlockingStore
        .getState()
        .categories.map((c) => c.id);
```

Then replace **both** occurrences of `for (const categoryId of ["adult", "hentai"])` with `for (const categoryId of categoryIds)`.

- [ ] **Step 7: Typecheck and lint**

Run: `npm --prefix mobile run typecheck`
Expected: no errors.

Run: `npm --prefix mobile run lint`
Expected: no errors, no warnings.

- [ ] **Step 8: Commit**

```bash
git add mobile/services/BlocklistService.ts
git commit -m "feat(mobile): drive ads category independently of adult master flag"
```

---

### Task 3: Native ContentMatcher — load the persisted `ads` category

**Files:**
- Modify: `mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/ContentMatcher.kt` (`loadPersistedData`)

**Interfaces:**
- Consumes: `ads` category domains persisted to `category_ads.txt` by the JS sync path.
- Produces: on service startup, the `ads` category is loaded via the fast path (not just the fallback scan).

**Why:** `loadPersistedData` only runs the `category_*.txt` file-scan fallback when the `knownCategories` fast path finds nothing. Because `adult`/`hentai` are always found, the fallback is skipped, so `category_ads.txt` would never load unless `"ads"` is in `knownCategories`.

- [ ] **Step 1: Add `"ads"` to `knownCategories`**

In `ContentMatcher.kt`, in `loadPersistedData`, change:

```kotlin
        val knownCategories = listOf("adult", "hentai")
```

to:

```kotlin
        val knownCategories = listOf("adult", "hentai", "ads")
```

- [ ] **Step 2: Verify the edit compiles in context**

This is a single-element list change. It is verified by the Android build at Task 5 (`npm --prefix mobile run android`). No isolated unit test exists for this path; do not add one.

- [ ] **Step 3: Commit**

```bash
git add mobile/modules/freedom-accessibility-service/android/src/main/java/expo/modules/freedomaccessibility/ContentMatcher.kt
git commit -m "feat(mobile): load persisted ads category on accessibility startup"
```

---

### Task 4: Settings toggle — "Block Ads & Trackers"

**Files:**
- Modify: `mobile/app/(tabs)/settings.tsx`

**Interfaces:**
- Consumes: `ads` category (Task 1), `syncVpnCategoryToggle` / `syncCategoryFlagsToNative` / `updateBlocklists` (Task 2), `getCachedDomainCount` (`@/db/database`), `toggleCategory` (store), `FreedomAccessibility` module.
- Produces: a Protection-section Switch bound to the `ads` category `enabled`, with a first-enable fetch and disable-in-non-flexible friction.

- [ ] **Step 1: Add imports and native module**

At the top of `mobile/app/(tabs)/settings.tsx`, add:

```ts
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
import { getCachedDomainCount } from "@/db/database";
```

- [ ] **Step 2: Read the ads-enabled flag and add loading state**

Inside `SettingsScreen`, after the existing `useBlockingStore` destructure, add:

```ts
  const adBlockEnabled = useBlockingStore(
    (s) => s.categories.find((c) => c.id === "ads")?.enabled ?? false,
  );
  const toggleCategory = useBlockingStore((s) => s.toggleCategory);
  const [adBlockLoading, setAdBlockLoading] = useState(false);
```

- [ ] **Step 3: Widen the `pendingAction` union**

Change:

```ts
  const [pendingAction, setPendingAction] = useState<"boot" | "applock" | null>(
    null,
  );
```

to:

```ts
  const [pendingAction, setPendingAction] = useState<
    "boot" | "applock" | "adblock" | null
  >(null);
```

- [ ] **Step 4: Add the ad-block handlers**

After `toggleBoot`, add:

```ts
  const handleAdBlockToggle = (isEnabling: boolean): void => {
    // Enabling strengthens protection — always free. Disabling in a
    // non-flexible mode requires friction, matching app convention.
    if (isEnabling || controlMode === "flexible") {
      void applyAdBlock(isEnabling);
    } else {
      setPendingAction("adblock");
    }
  };

  const applyAdBlock = async (enable: boolean): Promise<void> => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    toggleCategory("ads");
    setPendingAction(null);

    if (enable) {
      setAdBlockLoading(true);
      try {
        if (getCachedDomainCount("ads") === 0) {
          // First enable: fetch + cache + sync the HaGeZi list.
          await BlocklistService.updateBlocklists();
        } else {
          await BlocklistService.syncVpnCategoryToggle("ads", true);
          await BlocklistService.syncCategoryFlagsToNative();
        }
      } catch (e) {
        console.error("[Settings] Ad-block enable failed:", e);
      } finally {
        setAdBlockLoading(false);
      }
    } else {
      await BlocklistService.syncVpnCategoryToggle("ads", false);
      await BlocklistService.syncCategoryFlagsToNative();
    }
  };
```

- [ ] **Step 5: Add the toggle row to the Protection card**

In the Protection `View` (the card containing the Auto-start and App Lock rows), add a third row after the App Lock row (before the card's closing `</View>`):

```tsx
          <View className="flex-row items-center justify-between p-4 border-t border-gray-800">
            <View className="flex-1">
              <Text style={{ color: t.textColor }}>Block Ads & Trackers</Text>
              <Text className="text-sm" style={{ color: t.mutedTextColor }}>
                Aggressive network-wide ad/tracker blocking (HaGeZi Ultimate)
              </Text>
            </View>
            {adBlockLoading ? (
              <ActivityIndicator color={t.accentColor} />
            ) : (
              <Switch
                value={adBlockEnabled}
                onValueChange={handleAdBlockToggle}
                trackColor={{ false: "#ccc", true: t.accentColor }}
                thumbColor={adBlockEnabled ? "#fff" : "#999"}
                aria-label="Toggle ad and tracker blocking"
              />
            )}
          </View>
```

Add `ActivityIndicator` to the existing `react-native` import in this file.

- [ ] **Step 6: Handle the `adblock` case in the InteractionGuard**

Update the bottom `InteractionGuard`. Change its `actionName`:

```tsx
        actionName={
          pendingAction === "boot"
            ? "Disable Auto-start"
            : pendingAction === "applock"
              ? "Disable App Lock"
              : "Disable Ad Blocking"
        }
```

And its `onSuccess`:

```tsx
        onSuccess={() => {
          if (pendingAction === "boot") toggleBoot();
          else if (pendingAction === "applock") disableAppLock();
          else if (pendingAction === "adblock") void applyAdBlock(false);
        }}
```

- [ ] **Step 7: Typecheck and lint**

Run: `npm --prefix mobile run typecheck`
Expected: no errors.

Run: `npm --prefix mobile run lint`
Expected: no errors, no warnings.

- [ ] **Step 8: Commit**

```bash
git add "mobile/app/(tabs)/settings.tsx"
git commit -m "feat(mobile): add Block Ads & Trackers toggle to Settings"
```

---

### Task 5: On-device verification

**Files:** none (integration/manual).

**Interfaces:**
- Consumes: all prior tasks.
- Produces: confirmation the feature works end-to-end on a real Android device/emulator.

- [ ] **Step 1: Build and install**

Run: `npm --prefix mobile run android`
Expected: app builds (Kotlin change compiles) and launches on the connected device/emulator.

- [ ] **Step 2: First-enable fetch**

In the app: Settings → Protection → toggle "Block Ads & Trackers" on.
Expected: spinner shows while HaGeZi Ultimate downloads and syncs; toggle settles on.

- [ ] **Step 3: Ads are blocked**

Open a browser, visit an ad-heavy site (e.g. a news site).
Expected: ad slots/trackers fail to load (DNS NXDOMAIN).

- [ ] **Step 4: Independence from adult blocking**

Go to the Safe tab, turn adult blocking OFF. Return to the ad-heavy site.
Expected: ads still blocked (ad category is un-gated from the adult master).

- [ ] **Step 5: Disable path**

Settings → toggle ad blocking off (flexible mode). Revisit the site.
Expected: ads load again.

- [ ] **Step 6: Friction on disable in hardcore**

Settings → Control Modes → Hardcore. Settings → toggle ad blocking off.
Expected: InteractionGuard friction ("Disable Ad Blocking") appears before it turns off.

- [ ] **Step 7: Persistence across relaunch**

Re-enable ad blocking, force-close and reopen the app.
Expected: ad blocking restored on launch (LaunchRecoveryService → `syncAllCategoriesFromCache`, now un-gated), ads still blocked.

---

## Notes

- If HaGeZi Ultimate is too heavy or breaks too many sites, swap the URL in `DEFAULT_SOURCES` to `https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/pro.txt` — a one-line change, no other edits.
- Whitelist breakage via the existing Content screen → Whitelist tab.
