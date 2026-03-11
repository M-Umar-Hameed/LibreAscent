import { sqliteStorage } from "@/db/database";
import type {
  BlockedApp,
  BlockingCategory,
  BlocklistSource,
} from "@/types/blocking";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface BlockingState {
  // Keywords
  keywords: string[];

  // Websites
  includedUrls: string[];
  excludedUrls: string[];

  // Categories
  categories: BlockingCategory[];
  adultBlockingEnabled: boolean;

  // Custom Sources
  sources: BlocklistSource[];

  // Blocked Apps
  blockedApps: BlockedApp[];

  // Keyword actions
  addKeyword: (keyword: string) => void;
  removeKeyword: (keyword: string) => void;
  removeKeywords: (keywordsToRemove: string[]) => void;
  setKeywords: (keywords: string[]) => void;

  // URL actions
  addIncludedUrl: (url: string) => void;
  removeIncludedUrl: (url: string) => void;
  addExcludedUrl: (url: string) => void;
  removeExcludedUrl: (url: string) => void;

  // Category actions
  toggleCategory: (id: string) => void;
  addCategory: (category: BlockingCategory) => void;
  removeCategory: (id: string) => void;
  updateCategoryDomains: (id: string, domains: string[]) => void;
  setAdultBlockingEnabled: (enabled: boolean) => void;

  // Source actions
  addSource: (source: Omit<BlocklistSource, "id">) => void;
  removeSource: (id: string) => void;
  toggleSource: (id: string) => void;
  updateSourceDomains: (id: string, domains: string[]) => void;

  // App actions
  addBlockedApp: (app: BlockedApp) => void;
  removeBlockedApp: (packageName: string) => void;
  toggleBlockedApp: (packageName: string) => void;
  updateAppControl: (packageName: string, config: Partial<BlockedApp>) => void;

  // Mass actions
  importSettings: (data: Partial<BlockingState>) => void;
}

export const DEFAULT_SOURCES: BlocklistSource[] = [
  {
    id: "steven-black-porn",
    name: "StevenBlack (Porn)",
    url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn/hosts",
    format: "hosts",
    enabled: true,
  },
  {
    id: "blocklist-project-porn",
    name: "BlocklistProject (Porn)",
    url: "https://raw.githubusercontent.com/blocklistproject/Lists/4fbe4d2ac6cf334130319556db6e44c8576a1299/porn.txt",
    format: "domains",
    enabled: true,
  },
  {
    id: "bon-appetit-porn",
    name: "Bon-Appetit (Porn Domains)",
    url: "https://raw.githubusercontent.com/Bon-Appetit/porn-domains/refs/heads/main/block.c180c6fed4.45godp.txt",
    format: "domains",
    enabled: true,
  },
  {
    id: "hentai-refined",
    name: "Hentai Refined",
    url: "https://raw.githubusercontent.com/newedgex/ani-manga-blocklist/main/refined-blacklist.txt",
    format: "domains",
    enabled: true,
  },
];

export const useBlockingStore = create<BlockingState>()(
  persist(
    (set) => ({
      keywords: [
        "porn",
        "sex",
        "hentai",
        "xvideos",
        "xnxx",
        "xhamster",
        "porntrex",
        "xhaccess",
      ],
      includedUrls: [],
      excludedUrls: [],
      categories: [
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
      ],
      adultBlockingEnabled: true,
      sources: DEFAULT_SOURCES,
      blockedApps: [],

      addKeyword: (keyword) =>
        set((state) => {
          const lower = keyword.trim().toLowerCase();
          if (!lower || state.keywords.includes(lower)) return state;
          return { keywords: [...state.keywords, lower] };
        }),

      removeKeyword: (keyword) =>
        set((state) => ({
          keywords: state.keywords.filter((k) => k !== keyword),
        })),

      removeKeywords: (keywordsToRemove) =>
        set((state) => ({
          keywords: state.keywords.filter((k) => !keywordsToRemove.includes(k)),
        })),

      setKeywords: (keywords) => set({ keywords }),

      addIncludedUrl: (url) =>
        set((state) => {
          const lower = url.trim().toLowerCase();
          if (!lower || state.includedUrls.includes(lower)) {
            return state;
          }
          return { includedUrls: [...state.includedUrls, lower] };
        }),

      removeIncludedUrl: (url) =>
        set((state) => ({
          includedUrls: state.includedUrls.filter((u) => u !== url),
        })),

      addExcludedUrl: (url) =>
        set((state) => {
          const lower = url.trim().toLowerCase();
          if (!lower || state.excludedUrls.includes(lower)) return state;
          return { excludedUrls: [...state.excludedUrls, lower] };
        }),

      removeExcludedUrl: (url) =>
        set((state) => ({
          excludedUrls: state.excludedUrls.filter((u) => u !== url),
        })),

      toggleCategory: (id) =>
        set((state) => ({
          categories: state.categories.map((cat) =>
            cat.id === id ? { ...cat, enabled: !cat.enabled } : cat,
          ),
        })),

      addCategory: (category) =>
        set((state) => ({
          categories: [...state.categories, category],
        })),

      removeCategory: (id) =>
        set((state) => ({
          categories: state.categories.filter((cat) => cat.id !== id),
        })),

      updateCategoryDomains: (id, domains) =>
        set((state) => {
          const uniqueDomains = Array.from(new Set(domains));
          return {
            categories: state.categories.map((cat) =>
              cat.id === id ? { ...cat, domains: uniqueDomains } : cat,
            ),
          };
        }),

      setAdultBlockingEnabled: (enabled) =>
        set({ adultBlockingEnabled: enabled }),

      addSource: (source) =>
        set((state) => ({
          sources: [
            ...state.sources,
            { ...source, id: Math.random().toString(36).substring(7) },
          ],
        })),

      removeSource: (id) =>
        set((state) => ({
          sources: state.sources.filter((s) => s.id !== id),
        })),

      toggleSource: (id) =>
        set((state) => ({
          sources: state.sources.map((s) =>
            s.id === id ? { ...s, enabled: !s.enabled } : s,
          ),
        })),

      updateSourceDomains: (id, domains) =>
        set((state) => ({
          categories: state.categories.map((cat) =>
            cat.id === id ? { ...cat, domains } : cat,
          ),
        })),

      addBlockedApp: (app) =>
        set((state) => {
          if (state.blockedApps.some((a) => a.packageName === app.packageName))
            return state;
          return { blockedApps: [...state.blockedApps, app] };
        }),

      removeBlockedApp: (packageName) =>
        set((state) => ({
          blockedApps: state.blockedApps.filter(
            (a) => a.packageName !== packageName,
          ),
        })),

      toggleBlockedApp: (packageName) =>
        set((state) => ({
          blockedApps: state.blockedApps.map((a) =>
            a.packageName === packageName ? { ...a, enabled: !a.enabled } : a,
          ),
        })),

      updateAppControl: (packageName, config) =>
        set((state) => ({
          blockedApps: state.blockedApps.map((a) =>
            a.packageName === packageName ? { ...a, ...config } : a,
          ),
        })),

      importSettings: (data) =>
        set((state) => ({
          keywords: data.keywords || state.keywords,
          includedUrls: data.includedUrls || state.includedUrls,
          excludedUrls: data.excludedUrls || state.excludedUrls,
          adultBlockingEnabled:
            data.adultBlockingEnabled ?? state.adultBlockingEnabled,
          sources: data.sources || state.sources,
          blockedApps: data.blockedApps || state.blockedApps,
        })),
    }),
    {
      name: "freedom-blocking-store",
      storage: createJSONStorage(() => sqliteStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Removed forced keyword rehydration so users can legitimately have 0 keywords

          let currentSources = [...state.sources];
          currentSources = currentSources.filter(
            (s) =>
              s.id !== "forbidden-words-eng" &&
              s.id !== "forbidden-words-multi" &&
              s.id !== "bad-words-carback1",
          );

          let changed = false;
          for (const ds of DEFAULT_SOURCES) {
            if (!currentSources.some((s) => s.id === ds.id)) {
              currentSources.push(ds);
              changed = true;
            }
          }
          if (changed || currentSources.length !== state.sources.length) {
            state.importSettings({ sources: currentSources });
          }
        }
      },
    },
  ),
);
