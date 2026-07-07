# Mobile Ad Blocker Design

## Goal

Add ad and tracker blocking to the LibreAscent mobile app as a first-class, independently toggleable feature, using the most aggressive available blocklist. The toggle lives in the Settings screen and does not depend on the adult-content blocking toggle.

## Scope

Included:

- A new `ads` blocking category alongside the existing `adult` and `hentai` categories.
- A bundled strong ad/tracker blocklist source (HaGeZi Ultimate).
- A Settings toggle that enables/disables ad blocking independently of adult blocking.
- Enforcement through the existing VPN/DNS layer.
- Targeted de-hardcoding of the category-id list where it blocks the feature.

Excluded:

- Forcing ad blocking on by default (it ships opt-in).
- Tying ad blocking to hardcore-mode tamper protection.
- A fully data-driven category system (noted as future cleanup, not done here).
- Any per-source category picker UI.
- Adding `adsCategoryDomains` to the native protection snapshot (YAGNI).

## Background

The app already blocks content by fetching domain lists and pushing them to two native layers:

- **VPN** (`freedom-vpn-service`, `DomainBlocklist`): a local DNS-only tunnel. Checks whitelist, then blocked domains, then each category set. It has **no master gate** — a category is active if and only if it has been added via `addCategory`. This is the correct and natural layer for ad blocking, because ad domains are page subresources that never appear in a browser URL bar.
- **Accessibility** (`freedom-accessibility-service`, `ContentMatcher`): scrapes browser URL bars and scans app UIs. Its `isUrlBlocked` early-returns when `adultBlockingEnabled` is false, and category enable state is gated behind `adultBlockingEnabled` in the JS sync path. Because ad domains do not surface in URL bars, this layer is effectively irrelevant to ad blocking.

The category id list `["adult", "hentai"]` is hardcoded in three places: `ContentMatcher.loadPersistedData` (native fast-path), and two loops in `BlocklistService.updateBlocklists`. The JS sync functions (`syncCategoryFlagsToNative`, `syncDomainsToNative`, `syncVpnCategoryToggle`, `syncAllCategoriesFromCache`) gate every category behind the `adultBlockingEnabled` master flag.

## Design

### 1. Data model (`stores/useBlockingStore.ts`, `types/blocking.ts`)

Add a third default category:

```ts
{
  id: "ads",
  name: "Ads & Trackers",
  description:
    "Blocks ad, tracker, and telemetry domains network-wide via DNS. Aggressive — whitelist sites that break.",
  domains: [],
  enabled: false,
}
```

The category ships **disabled** (opt-in toggle).

Add a bundled source to `DEFAULT_SOURCES`:

```ts
{
  id: "hagezi-ultimate",
  name: "HaGeZi Ultimate (Ads/Trackers)",
  url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/ultimate.txt",
  format: "domains",
  enabled: true,
  category: "ads",
}
```

Add an optional `category?: "adult" | "hentai" | "ads"` field to the `BlocklistSource` type. This is backward compatible (optional) and removes the need for name-substring guessing.

`onRehydrateStorage` already force-resets `sources` to `DEFAULT_SOURCES` on every launch, so existing users receive the HaGeZi source automatically. Add a migration in the same hook: if the persisted `categories` array has no entry with `id === "ads"`, inject the default `ads` category so existing users get the new bucket.

### 2. Source-to-category mapping (`services/BlocklistService.ts`)

`getCategoryForSource` becomes:

```ts
getCategoryForSource: (source) =>
  source.category ??
  (isHentai(source) ? "hentai" : "adult"),
```

Explicit `category` wins; the existing hentai/adult inference remains the fallback for user-added sources without a category.

### 3. Un-gate ads from the adult master flag (`services/BlocklistService.ts`)

Ad blocking must remain active even when `adultBlockingEnabled` is false. In each of the four sync functions, compute the effective master per category: for `id === "ads"`, gate only on the ads category's own `enabled`; for all other categories, keep the existing `adultBlockingEnabled && enabled` gate.

- `syncCategoryFlagsToNative`: `setCategoryEnabled(cat.id, cat.id === "ads" ? cat.enabled : state.adultBlockingEnabled && cat.enabled)`.
- `syncDomainsToNative`: the `isActive` computation uses the same per-category master.
- `syncVpnCategoryToggle`: the `enabled && state.adultBlockingEnabled` guard becomes `enabled && (categoryId === "ads" ? true : state.adultBlockingEnabled)`.
- `syncAllCategoriesFromCache`: replace the blanket `if (!state.adultBlockingEnabled) return;` early return with a per-category skip so `ads` is still processed when the adult master is off.

### 4. De-hardcode the category loop (`services/BlocklistService.ts`, native `ContentMatcher.kt`)

- In `updateBlocklists`, replace both `["adult", "hentai"]` loops with the live category ids: `useBlockingStore.getState().categories.map((c) => c.id)`. Ads then flows through fetch → cache → native sync automatically. This is a targeted improvement, not a refactor of the whole category system.
- In native `ContentMatcher.loadPersistedData`, add `"ads"` to the `knownCategories` fast-path list. The existing `category_*.txt` file-scan fallback already covers arbitrary categories, so this only speeds the common case.
- Do **not** extend `getProtectionSnapshot`; call `getCategoryDomainCount("ads")` directly where a count is needed.

### 5. Settings toggle (`app/(tabs)/settings.tsx`)

Add a switch row to the Protection section: "Block Ads & Trackers", bound to the `ads` category `enabled` flag.

- **Enable** (strengthens protection, always free): flip `ads` category enabled. If `getCachedDomainCount("ads") === 0`, run `BlocklistService.updateBlocklists()` behind a loading indicator (first fetch of the HaGeZi list is heavy). If the cache is already populated, run `syncVpnCategoryToggle("ads", true)` and push the accessibility category from cache.
- **Disable**: in `flexible` mode, apply immediately (`syncVpnCategoryToggle("ads", false)` + `syncCategoryFlagsToNative`). In `locked`/`hardcore`, route through the existing `InteractionGuard` (already imported in `settings.tsx`) by extending the `pendingAction` union with an `"adblock"` case. This matches the app-wide convention that adding protection is free and removing it requires friction.

### 6. Enforcement summary

- VPN category add/remove is the real, network-wide ad block.
- The accessibility layer receives the ads domains too (via the shared sync path) but does not meaningfully act on them, since ad domains do not appear in URL bars.
- No `adultBlockingEnabled` gate applies to the `ads` category on any path.

## Data flow

1. User enables the Settings toggle.
2. Store flips `ads.enabled = true`.
3. First enable: `updateBlocklists()` fetches HaGeZi Ultimate → parses domains → caches in SQLite (`cached_domains`, category `ads`) → syncs to native (VPN `addCategory("ads", …)` batched, accessibility category file).
4. Subsequent app launches: `LaunchRecoveryService` → `syncAllCategoriesFromCache` restores the `ads` category from SQLite to native (now un-gated from the adult master).
5. VPN resolves DNS: ad domains return NXDOMAIN.

## Performance and risk

- HaGeZi Ultimate is roughly one million domains — tens of MB of heap for the HashSet. `largeHeap: true` is already set in `app.config.ts`; native persistence is file-based (>5000-domain sets go to `category_*.txt`) and JS→native transfer is batched at 10k. Acceptable, but real.
- Aggressive lists break some sites and logins. The existing whitelist tab in the Content screen is the escape hatch. If Ultimate proves too heavy or breaks too much, swapping the source URL to HaGeZi Pro (`domains/pro.txt`, ~150k) is a one-line change requiring no other design changes.
- First enable performs a large network fetch; the loading indicator must be shown so the toggle does not appear frozen.

## Testing

Unit / logic:

- Default `categories` include `ads` (disabled) and `DEFAULT_SOURCES` includes the HaGeZi source with `category: "ads"`.
- Rehydration migration injects `ads` for a persisted store that predates the feature.
- `getCategoryForSource` returns `"ads"` for the HaGeZi source via the explicit `category` field.
- With `adultBlockingEnabled = false` and `ads.enabled = true`, `syncCategoryFlagsToNative` calls `setCategoryEnabled("ads", true)` and `syncVpnCategoryToggle` keeps the VPN `ads` category.

Manual (device):

- Toggle on → first-run fetch completes → visit an ad-heavy site → ads blocked.
- Toggle off (flexible) → ads return.
- Turn adult blocking off while ad blocking stays on → ads remain blocked.
- In hardcore mode, disabling ad blocking presents the friction guard.

## Files touched

- `mobile/stores/useBlockingStore.ts` — default category, source, migration.
- `mobile/types/blocking.ts` — optional `category` on `BlocklistSource`.
- `mobile/services/BlocklistService.ts` — mapping, un-gate, de-hardcode loop.
- `mobile/modules/freedom-accessibility-service/android/.../ContentMatcher.kt` — `knownCategories`.
- `mobile/app/(tabs)/settings.tsx` — toggle row + guard case.

## Future work (not in scope)

Make the category system fully data-driven so new categories require no hardcoded-list edits (Approach C from brainstorming). The native `knownCategories` fast-path and any remaining constants would derive from a single source of truth.
