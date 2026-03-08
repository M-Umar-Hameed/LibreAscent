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
    const state = useBlockingStore.getState();
    const allDomains: string[] = [];

    for (const category of state.categories) {
      if (category.enabled && category.domains.length > 0) {
        for (const domain of category.domains) {
          allDomains.push(domain);
        }
      }
    }

    for (const url of state.includedUrls) {
      allDomains.push(url);
    }

    try {
      await FreedomVpn.updateBlocklist(allDomains);
      await FreedomVpn.setWhitelist(state.excludedUrls);
    } catch (e) {
      console.warn("[BlocklistService] Failed to sync to VPN:", e);
    }

    try {
      await FreedomAccessibility.updateBlockedDomains(allDomains);
      await FreedomAccessibility.updateBlockedKeywords(state.keywords);
      await FreedomAccessibility.updateWhitelist(state.excludedUrls);
    } catch (e) {
      console.warn("[BlocklistService] Failed to sync to Accessibility:", e);
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
        .replace(/^www\./, "")
        .toLowerCase();

      if (trimmed && trimmed.includes(".") && !trimmed.includes(" ")) {
        domains.push(trimmed);
      }
    }
    return domains;
  },

  /**
   * Fetch a blocklist from a remote URL.
   */
  fetchRemoteList: async (
    url: string,
    _format: "domains" | "hosts",
  ): Promise<string[]> => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const content = await response.text();
      return BlocklistService.parseDomainList(content);
    } catch (error) {
      console.warn(`[BlocklistService] Failed to fetch ${url}:`, error);
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
   * Fetch all known adult blocklists from source and update store.
   */
  updateAdultBlocklist: async (): Promise<boolean> => {
    try {
      const adultSources = [
        {
          url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn/hosts",
          format: "hosts" as const,
        },
        {
          url: "https://raw.githubusercontent.com/blocklistproject/Lists/master/porn.txt",
          format: "domains" as const,
        },
        {
          url: "https://raw.githubusercontent.com/4skinSkywalker/Anti-Porn-HOSTS-File/master/HOSTS.txt",
          format: "hosts" as const,
        },
      ];

      const hentaiSources = [
        {
          url: "https://raw.githubusercontent.com/newedgex/ani-manga-blocklist/main/refined-blacklist.txt",
          format: "domains" as const,
        },
      ];

      const adultDomains = new Set<string>();
      for (const source of adultSources) {
        const list = await BlocklistService.fetchRemoteList(
          source.url,
          source.format,
        );
        list.forEach((domain) => adultDomains.add(domain));
      }

      const hentaiDomains = new Set<string>();
      for (const source of hentaiSources) {
        const list = await BlocklistService.fetchRemoteList(
          source.url,
          source.format,
        );
        list.forEach((domain) => hentaiDomains.add(domain));
      }

      const adultDomainList = Array.from(adultDomains);
      const hentaiDomainList = Array.from(hentaiDomains);

      useBlockingStore
        .getState()
        .updateCategoryDomains("adult", adultDomainList);
      useBlockingStore
        .getState()
        .updateCategoryDomains("hentai", hentaiDomainList);

      return true;
    } catch (error) {
      console.error(
        "[BlocklistService] Failed to update adult blocklist:",
        error,
      );
      return false;
    }
  },
};
