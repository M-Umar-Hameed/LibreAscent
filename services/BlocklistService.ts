import {
  contentFingerprint,
  getCachedDomainCount,
  getSourceCache,
  pruneDisabledSources,
  readCachedDomainsBatch,
  saveSourceDomains,
  setLastBlocklistUpdate,
} from "@/db/database";
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
import * as FreedomVpn from "@/modules/freedom-vpn-service/src";
import {
  getActiveExcludedUrls,
  getActiveIncludedUrls,
  useBlockingStore,
} from "@/stores/useBlockingStore";

/**
 * BlocklistService — Manages domain blocklists on the JS side.
 */
export const BlocklistService = {
  /**
   * Load all enabled category domains + user domains
   * and push to the native VPN and Accessibility blocklists.
   */
  syncBlocklistToNative: async (): Promise<void> => {
    await BlocklistService.syncDomainsToNative();
    await BlocklistService.syncKeywordsToNative();
    await BlocklistService.syncAppsToNative();
  },

  /**
   * Lightweight sync: only update master flag + per-category enabled states.
   * No domain transfer — instant effect on native side.
   */
  syncCategoryFlagsToNative: async (): Promise<void> => {
    const state = useBlockingStore.getState();

    try {
      await FreedomAccessibility.updateAdultBlockingEnabled(
        state.adultBlockingEnabled,
      );
    } catch (e) {
      console.warn("[BlocklistService] Failed to sync master flag:", e);
    }

    for (const category of state.categories) {
      try {
        await FreedomAccessibility.setCategoryEnabled(
          category.id,
          state.adultBlockingEnabled && category.enabled,
        );
      } catch (e) {
        console.warn(
          `[BlocklistService] Failed to sync category ${category.id} enabled:`,
          e,
        );
      }
    }
  },

  /**
   * Batch size for domain transfers across the JS-native bridge.
   * Each batch stays well under the bridge memory limit.
   */
  BATCH_SIZE: 10000,

  /**
   * Send an array in batches to avoid OOM on the JS-native bridge.
   */
  sendInBatches: async (
    domains: string[],
    batchFn: (batch: string[]) => Promise<void>,
  ): Promise<void> => {
    for (let i = 0; i < domains.length; i += BlocklistService.BATCH_SIZE) {
      const batch = domains.slice(i, i + BlocklistService.BATCH_SIZE);
      await batchFn(batch);
    }
  },

  syncDomainsToNative: async (options?: {
    skipResync?: boolean;
  }): Promise<void> => {
    const state = useBlockingStore.getState();

    // Always sync flags (instant)
    await BlocklistService.syncCategoryFlagsToNative();

    // If we only want to toggle flags, skip the heavy domain transfer
    if (options?.skipResync) return;

    // Sync per-category domains to both Accessibility and VPN in batches
    for (const category of state.categories) {
      const nativeCount = state.categoryDomainCounts[category.id] ?? 0;
      const hasDomains = category.domains.length > 0 || nativeCount > 0;
      const isActive =
        state.adultBlockingEnabled && category.enabled && hasDomains;

      if (!isActive) {
        try {
          await FreedomVpn.removeCategory(category.id);
        } catch (e) {
          console.warn(
            `[BlocklistService] Failed to remove VPN category ${category.id}:`,
            e,
          );
        }
        continue;
      }

      // If domains are already in native memory (count > 0, JS array empty),
      // skip re-sending — updateBlocklists already handled it.
      if (category.domains.length === 0 && nativeCount > 0) {
        continue;
      }

      // Clear existing category data before batching
      try {
        await FreedomVpn.removeCategory(category.id);
      } catch {
        // ignore — category might not exist yet
      }

      // Batch to both VPN and Accessibility
      try {
        await BlocklistService.sendInBatches(
          category.domains,
          async (batch) => {
            await FreedomVpn.addCategory(category.id, batch);
            await FreedomAccessibility.appendCategoryDomains(
              category.id,
              batch,
            );
          },
        );
        // Finalize accessibility (persist + rebuild active domains)
        await FreedomAccessibility.finalizeCategorySync(category.id);
      } catch (e) {
        console.warn(
          `[BlocklistService] Failed to sync category ${category.id}:`,
          e,
        );
      }
    }

    // Sync included/excluded URLs (only enabled ones)
    const activeIncluded = getActiveIncludedUrls();
    const activeExcluded = getActiveExcludedUrls();

    try {
      await FreedomAccessibility.setIncludedDomains(activeIncluded);
      await FreedomAccessibility.updateWhitelist(activeExcluded);
    } catch (e) {
      console.warn(
        "[BlocklistService] Failed to sync URLs to Accessibility:",
        e,
      );
    }

    try {
      await FreedomVpn.updateBlocklist(activeIncluded);
      await FreedomVpn.setWhitelist(activeExcluded);
    } catch (e) {
      console.warn("[BlocklistService] Failed to sync URLs to VPN:", e);
    }
  },

  /**
   * Sync VPN category toggle: add or remove a category from VPN blocklist.
   */
  syncVpnCategoryToggle: async (
    categoryId: string,
    enabled: boolean,
  ): Promise<void> => {
    const state = useBlockingStore.getState();
    const category = state.categories.find((c) => c.id === categoryId);
    if (!category || category.domains.length === 0) return;

    try {
      if (enabled && state.adultBlockingEnabled) {
        await FreedomVpn.addCategory(categoryId, category.domains);
      } else {
        await FreedomVpn.removeCategory(categoryId);
      }
    } catch (e) {
      console.warn(
        `[BlocklistService] Failed to sync VPN category ${categoryId}:`,
        e,
      );
    }
  },

  syncKeywordsToNative: async (): Promise<void> => {
    const state = useBlockingStore.getState();
    try {
      await FreedomAccessibility.updateBlockedKeywords(state.keywords);
    } catch (e) {
      console.warn(
        "[BlocklistService] Failed to sync keywords to Accessibility:",
        e,
      );
    }
  },

  syncAppsToNative: async (): Promise<void> => {
    const state = useBlockingStore.getState();
    try {
      const configs = state.blockedApps
        .filter((a) => a.enabled)
        .map((a) => {
          const config: {
            packageName: string;
            appName: string;
            surveillanceType: string;
            surveillanceValue: number;
            startTime?: string;
            endTime?: string;
          } = {
            packageName: a.packageName,
            appName: a.appName,
            surveillanceType: a.surveillance.type,
            surveillanceValue: a.surveillance.value,
          };
          if (a.startTime) config.startTime = a.startTime;
          if (a.endTime) config.endTime = a.endTime;
          return config;
        });
      await FreedomAccessibility.updateBlockedApps(configs);
    } catch (e) {
      console.warn(
        "[BlocklistService] Failed to sync apps to Accessibility:",
        e,
      );
    }
  },

  /**
   * Parse a domain list text file.
   */
  parseDomainList: (content: string): string[] => {
    const domains: string[] = [];
    const lines = content.split("\n");
    for (const line of lines) {
      let trimmed = line.trim();
      if (
        !trimmed ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("!") ||
        trimmed.startsWith("[")
      ) {
        continue;
      }

      if (trimmed.startsWith("0.0.0.0 ") || trimmed.startsWith("127.0.0.1 ")) {
        trimmed = trimmed.split(/\s+/)[1] || "";
        if (!trimmed) continue;
      }

      if (
        trimmed.includes("##") ||
        trimmed.includes("#?#") ||
        trimmed.startsWith("@@")
      ) {
        continue;
      }

      const commentIdx = trimmed.indexOf("#");
      if (commentIdx > 0) {
        trimmed = trimmed.substring(0, commentIdx).trim();
      }

      if (trimmed.startsWith("||")) {
        trimmed = trimmed.substring(2);
      }

      const caretIdx = trimmed.indexOf("^");
      if (caretIdx > 0) {
        trimmed = trimmed.substring(0, caretIdx);
      }

      const dollarIdx = trimmed.indexOf("$");
      if (dollarIdx > 0) {
        trimmed = trimmed.substring(0, dollarIdx);
      }

      trimmed = trimmed
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .replace(/:.*$/, "")
        .toLowerCase();

      if (trimmed && trimmed.includes(".") && !trimmed.includes(" ")) {
        domains.push(trimmed);
      }
    }
    return domains;
  },

  /**
   * Parse a keyword list text file (one word per line).
   */
  parseKeywordList: (content: string): string[] => {
    const keywords: string[] = [];
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (
        !trimmed ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("!") ||
        trimmed.startsWith("[")
      ) {
        continue;
      }
      // Only include words that are 3+ chars and don't contain spaces (single words)
      if (trimmed.length >= 3 && !trimmed.includes(" ")) {
        keywords.push(trimmed);
      }
    }
    return keywords;
  },

  /**
   * Fetch a blocklist from a remote URL.
   */
  fetchRemoteList: async (
    url: string,
    _format: "domains" | "hosts" | "keywords",
  ): Promise<string[]> => {
    try {
      // Handle comma-separated multi-URL strings for multi-language sources
      if (url.includes(",")) {
        const urls = url
          .split(",")
          .map((u) => u.trim())
          .filter(Boolean);
        const results = await Promise.all(
          urls.map((u) => BlocklistService.fetchRemoteList(u, _format)),
        );
        return results.flat();
      }

      // Special handling for Bon-Appetit meta.json — resolve dynamic block file URL
      if (
        url.includes("Bon-Appetit/porn-domains") &&
        url.endsWith("meta.json")
      ) {
        return await BlocklistService.fetchBonAppetitList(url);
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const content = await response.text();

      if (_format === "keywords") {
        return BlocklistService.parseKeywordList(content);
      }
      return BlocklistService.parseDomainList(content);
    } catch (error) {
      console.warn(`[BlocklistService] Failed to fetch ${url}:`, error);
      return [];
    }
  },

  /**
   * Fetch the Bon-Appetit porn-domains list via its meta.json.
   * The repo uses dynamic filenames, so we first fetch meta.json
   * to discover the current block file URL.
   */
  fetchBonAppetitList: async (metaUrl: string): Promise<string[]> => {
    try {
      const baseUrl = metaUrl.replace("meta.json", "");
      const metaResponse = await fetch(metaUrl);
      if (!metaResponse.ok)
        throw new Error(`meta.json HTTP ${metaResponse.status}`);
      const meta = await metaResponse.json();

      // meta.json structure: { blocklist: { name: "block.xxx.txt" }, allowlist: { ... } }
      // meta.json contains the current block filename
      const blockFile = meta.block || meta.blocklist;
      if (!blockFile) {
        console.warn(
          "[BlocklistService] Bon-Appetit meta.json missing block filename",
        );
        return [];
      }

      const blockUrl = `${baseUrl}${blockFile}`;
      // eslint-disable-next-line no-console
      console.log(`[BlocklistService] Bon-Appetit resolved: ${blockUrl}`);

      const response = await fetch(blockUrl);
      if (!response.ok) throw new Error(`Block file HTTP ${response.status}`);
      const content = await response.text();
      return BlocklistService.parseDomainList(content);
    } catch (error) {
      console.warn(
        "[BlocklistService] Failed to fetch Bon-Appetit list:",
        error,
      );
      return [];
    }
  },

  /**
   * Get the total number of domains in the native blocklist.
   */
  getBlocklistSize: async (): Promise<number> => {
    return FreedomVpn.getBlocklistSize();
  },

  /**
   * Get the total number of blocked attempts.
   */
  getBlockedCount: async (): Promise<number> => {
    return FreedomVpn.getBlockedCount();
  },

  /**
   * Determine which category a source belongs to.
   */
  getCategoryForSource: (source: { id: string; name: string }): string => {
    const isHentai =
      source.id === "hentai-refined" ||
      source.id === "hentai-blocklist" ||
      source.name.toLowerCase().includes("hentai");
    return isHentai ? "hentai" : "adult";
  },

  /**
   * Fetch a source with HTTP conditional request (ETag / Last-Modified).
   * Returns null if the source has not changed (304 or matching content hash).
   * Returns the parsed domain/keyword list if it changed.
   */
  fetchSourceWithCache: async (
    sourceId: string,
    url: string,
    format: "domains" | "hosts" | "keywords",
  ): Promise<{
    changed: boolean;
    list: string[];
    etag: string;
    lastModified: string;
    hash: string;
  }> => {
    const cached = getSourceCache(sourceId);

    // For complex URLs (comma-separated, Bon-Appetit), skip conditional request
    // and use content hash comparison instead.
    const isSimpleUrl = !url.includes(",") && !url.endsWith("meta.json");

    const headers: Record<string, string> = {};
    if (cached && isSimpleUrl) {
      if (cached.etag) headers["If-None-Match"] = cached.etag;
      if (cached.lastModified)
        headers["If-Modified-Since"] = cached.lastModified;
    }

    let content: string;
    let etag = "";
    let lastModified = "";

    if (isSimpleUrl) {
      const response = await fetch(url, { headers });
      if (response.status === 304) {
        return {
          changed: false,
          list: [],
          etag: cached?.etag ?? "",
          lastModified: cached?.lastModified ?? "",
          hash: cached?.contentHash ?? "",
        };
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      content = await response.text();
      etag = response.headers.get("etag") ?? "";
      lastModified = response.headers.get("last-modified") ?? "";
    } else {
      // Complex URL — fetch normally via existing helper
      const list = await BlocklistService.fetchRemoteList(url, format);
      // Can't get raw content for hash, use list length + sample as proxy
      const hash = contentFingerprint(list.join("\n"));
      if (cached?.contentHash === hash) {
        return { changed: false, list: [], etag: "", lastModified: "", hash };
      }
      return { changed: true, list, etag: "", lastModified: "", hash };
    }

    const hash = contentFingerprint(content);
    if (cached?.contentHash === hash) {
      return { changed: false, list: [], etag, lastModified, hash };
    }

    const list =
      format === "keywords"
        ? BlocklistService.parseKeywordList(content)
        : BlocklistService.parseDomainList(content);

    return { changed: true, list, etag, lastModified, hash };
  },

  /**
   * Push all cached domains for a category from SQLite to native (VPN + A11y).
   * Reads in pages to avoid loading 500k+ strings into JS at once.
   */
  syncCategoryFromCache: async (categoryId: string): Promise<void> => {
    const PAGE = 10000;
    const totalCached = getCachedDomainCount(categoryId);
    for (let offset = 0; offset < totalCached; offset += PAGE) {
      const batch = readCachedDomainsBatch(categoryId, PAGE, offset);
      if (batch.length === 0) break;
      await FreedomVpn.addCategory(categoryId, batch);
      await FreedomAccessibility.appendCategoryDomains(categoryId, batch);
    }
  },

  /**
   * Push ALL enabled categories from SQLite cache to native on app launch.
   * Fast path: skips if cache is empty (fresh install — updateBlocklists will fill it).
   */
  syncAllCategoriesFromCache: async (): Promise<void> => {
    const state = useBlockingStore.getState();
    if (!state.adultBlockingEnabled) return;

    for (const category of state.categories) {
      if (!category.enabled) continue;
      const cached = getCachedDomainCount(category.id);
      if (cached === 0) continue;

      try {
        await FreedomVpn.removeCategory(category.id);
      } catch { /* might not exist */ }

      await BlocklistService.syncCategoryFromCache(category.id);

      try {
        await FreedomAccessibility.finalizeCategorySync(category.id);
      } catch (e) {
        console.warn(`[BlocklistService] finalize ${category.id}:`, e);
      }

      const nativeCount = await FreedomAccessibility.getCategoryDomainCount(category.id);
      useBlockingStore.getState().setCategoryDomainCount(category.id, nativeCount);
    }
  },

  /**
   * Fetch all enabled blocklists, cache in SQLite, and sync to native.
   *
   * Uses HTTP conditional requests (ETag / Last-Modified) + content hashing
   * to skip sources that haven't changed since the last update.
   * Only categories with at least one changed source are re-synced to native.
   */
  updateBlocklists: async (
    onProgress?: (progress: number, total: number, name: string) => void,
  ): Promise<boolean> => {
    try {
      const state = useBlockingStore.getState();
      const enabledSources = state.sources.filter((s) => s.enabled);

      if (enabledSources.length === 0) return true;

      // Remove cached data for sources that are no longer enabled
      pruneDisabledSources(enabledSources.map((s) => s.id));

      const total = enabledSources.length + 1;
      const dirtyCategories = new Set<string>();
      const fetchedKeywords: string[] = [];

      // Phase 1: Check each source for changes
      for (let i = 0; i < enabledSources.length; i++) {
        const source = enabledSources[i];
        onProgress?.(i + 1, total, `Checking ${source.name}...`);
        await new Promise((r) => setTimeout(r, 0));

        try {
          const result = await BlocklistService.fetchSourceWithCache(
            source.id,
            source.url,
            source.format,
          );

          if (!result.changed) {
            // eslint-disable-next-line no-console
            console.log(
              `[BlocklistService] ${source.name}: unchanged (cache hit)`,
            );
            continue;
          }

          if (result.list.length === 0) continue;

          if (source.format === "keywords") {
            fetchedKeywords.push(...result.list);
            continue;
          }

          const categoryId = BlocklistService.getCategoryForSource(source);
          saveSourceDomains(
            source.id,
            categoryId,
            result.etag,
            result.lastModified,
            result.hash,
            result.list,
          );
          dirtyCategories.add(categoryId);
          // eslint-disable-next-line no-console
          console.log(
            `[BlocklistService] ${source.name}: ${result.list.length} domains cached`,
          );
        } catch (e) {
          console.warn(`[BlocklistService] Failed to fetch ${source.name}:`, e);
        }
      }

      // Phase 2: Re-sync dirty categories from SQLite to native
      onProgress?.(total, total, "Syncing to native...");
      await new Promise((r) => setTimeout(r, 0));

      for (const categoryId of ["adult", "hentai"]) {
        if (!dirtyCategories.has(categoryId)) {
          // Nothing changed — native already has correct data from its own
          // persistence files. Just update the UI count from SQLite DISTINCT.
          const cachedCount = getCachedDomainCount(categoryId);
          if (cachedCount > 0) {
            useBlockingStore
              .getState()
              .setCategoryDomainCount(categoryId, cachedCount);
          }
          continue;
        }

        // Clear native category and re-populate from SQLite cache
        try {
          await FreedomVpn.removeCategory(categoryId);
          await FreedomAccessibility.clearCategoryDomains(categoryId);
        } catch {
          /* ignore */
        }

        await BlocklistService.syncCategoryFromCache(categoryId);

        try {
          await FreedomAccessibility.finalizeCategorySync(categoryId);
        } catch (e) {
          console.warn("[BlocklistService] finalizeCategorySync warning:", e);
        }
      }

      // Update counts: use native count for dirty categories (just re-synced),
      // SQLite DISTINCT count for clean categories (already set above).
      for (const categoryId of ["adult", "hentai"]) {
        if (dirtyCategories.has(categoryId)) {
          const nativeCount =
            await FreedomAccessibility.getCategoryDomainCount(categoryId);
          useBlockingStore
            .getState()
            .setCategoryDomainCount(categoryId, nativeCount);
        }
      }

      const counts = useBlockingStore.getState().categoryDomainCounts;
      const adultCount = counts.adult ?? 0;
      const hentaiCount = counts.hentai ?? 0;
      // eslint-disable-next-line no-console
      console.log(
        `[BlocklistService] Synced ${adultCount} adult + ${hentaiCount} hentai domains (unique)`,
      );

      const { ProtectionService } =
        await import("@/services/ProtectionService");
      ProtectionService.snapshotCategoryContent();

      // Merge fetched keywords
      if (fetchedKeywords.length > 0) {
        const currentKeywords = useBlockingStore.getState().keywords;
        const merged = new Set([...currentKeywords, ...fetchedKeywords]);
        useBlockingStore.getState().setKeywords([...merged]);
      }

      // Sync flags, keywords, URLs
      await BlocklistService.syncCategoryFlagsToNative();
      await BlocklistService.syncKeywordsToNative();
      try {
        const inclUrls = getActiveIncludedUrls();
        const exclUrls = getActiveExcludedUrls();
        await FreedomAccessibility.setIncludedDomains(inclUrls);
        await FreedomAccessibility.updateWhitelist(exclUrls);
        await FreedomVpn.updateBlocklist(inclUrls);
        await FreedomVpn.setWhitelist(exclUrls);
      } catch (e) {
        console.warn("[BlocklistService] Failed to sync URLs:", e);
      }

      setLastBlocklistUpdate();
      return true;
    } catch (error) {
      console.error("[BlocklistService] Failed to update blocklists:", error);
      return false;
    }
  },
};
