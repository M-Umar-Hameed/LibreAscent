import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
import * as FreedomVpn from "@/modules/freedom-vpn-service/src";
import { useBlockingStore } from "@/stores/useBlockingStore";

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
      const isActive =
        state.adultBlockingEnabled &&
        category.enabled &&
        category.domains.length > 0;

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

    // Sync included/excluded URLs (small lists — no batching needed)
    try {
      await FreedomAccessibility.setIncludedDomains(state.includedUrls);
      await FreedomAccessibility.updateWhitelist(state.excludedUrls);
    } catch (e) {
      console.warn(
        "[BlocklistService] Failed to sync URLs to Accessibility:",
        e,
      );
    }

    try {
      await FreedomVpn.updateBlocklist(state.includedUrls);
      await FreedomVpn.setWhitelist(state.excludedUrls);
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
      // eslint-disable-next-line no-console
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
        // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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
   * Fetch all enabled blocklists and send directly to native in batches.
   * Each source is fetched, parsed, sent to native, then freed from JS memory
   * to avoid accumulating 900k+ domain strings in the JS heap.
   */
  updateBlocklists: async (
    onProgress?: (progress: number, total: number, name: string) => void,
  ): Promise<boolean> => {
    try {
      const state = useBlockingStore.getState();
      const enabledSources = state.sources.filter((s) => s.enabled);

      if (enabledSources.length === 0) return true;

      const total = enabledSources.length + 1; // +1 for finalize step

      // Clear existing categories before re-populating
      try {
        await FreedomVpn.removeCategory("adult");
        await FreedomVpn.removeCategory("hentai");
      } catch {
        // ignore — categories might not exist yet
      }

      let adultCount = 0;
      let hentaiCount = 0;
      const fetchedKeywords: string[] = [];

      // Process each source individually: fetch → parse → send to native → free
      for (let i = 0; i < enabledSources.length; i++) {
        const source = enabledSources[i];
        onProgress?.(i + 1, total, `Fetching ${source.name}...`);

        // Yield to UI thread so progress renders
        await new Promise((r) => setTimeout(r, 0));

        const list = await BlocklistService.fetchRemoteList(
          source.url,
          source.format,
        );

        if (list.length === 0) continue;

        if (source.format === "keywords") {
          fetchedKeywords.push(...list);
          continue;
        }

        // Determine category
        const isHentai =
          source.id === "hentai-refined" ||
          source.name.toLowerCase().includes("hentai");
        const categoryId = isHentai ? "hentai" : "adult";

        // Batch-send this source's domains to native immediately, then discard
        await BlocklistService.sendInBatches(list, async (batch) => {
          await FreedomVpn.addCategory(categoryId, batch);
          await FreedomAccessibility.appendCategoryDomains(categoryId, batch);
        });

        if (isHentai) hentaiCount += list.length;
        else adultCount += list.length;

        // list goes out of scope here — GC can free it
      }

      // Finalize: persist + rebuild active domains on native side
      onProgress?.(total, total, "Finalizing...");
      await new Promise((r) => setTimeout(r, 0));

      try {
        if (adultCount > 0)
          await FreedomAccessibility.finalizeCategorySync("adult");
        if (hentaiCount > 0)
          await FreedomAccessibility.finalizeCategorySync("hentai");
      } catch (e) {
        console.warn("[BlocklistService] finalizeCategorySync warning:", e);
      }

      // eslint-disable-next-line no-console
      console.log(
        `[BlocklistService] Synced ${adultCount} adult + ${hentaiCount} hentai domains`,
      );

      // Store only domain counts in Zustand
      useBlockingStore.getState().setCategoryDomainCount("adult", adultCount);
      useBlockingStore.getState().setCategoryDomainCount("hentai", hentaiCount);

      // Merge fetched keywords with existing user keywords
      if (fetchedKeywords.length > 0) {
        const currentKeywords = useBlockingStore.getState().keywords;
        const merged = new Set([...currentKeywords, ...fetchedKeywords]);
        useBlockingStore.getState().setKeywords([...merged]);
        // eslint-disable-next-line no-console
        console.log(
          `[BlocklistService] Keywords updated: ${currentKeywords.length} -> ${merged.size}`,
        );
      }

      // Sync URLs and keywords (small lists)
      await BlocklistService.syncKeywordsToNative();
      try {
        await FreedomAccessibility.setIncludedDomains(state.includedUrls);
        await FreedomAccessibility.updateWhitelist(state.excludedUrls);
        await FreedomVpn.updateBlocklist(state.includedUrls);
        await FreedomVpn.setWhitelist(state.excludedUrls);
      } catch (e) {
        console.warn("[BlocklistService] Failed to sync URLs:", e);
      }

      return true;
    } catch (error) {
      console.error("[BlocklistService] Failed to update blocklists:", error);
      return false;
    }
  },
};
