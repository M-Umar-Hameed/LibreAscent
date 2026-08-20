import { sqliteStorage } from "@/db/database";
import type {
  BlockedApp,
  BlockedUrl,
  BlockingCategory,
  BlocklistSource,
  ControlMode,
  SurveillanceConfig,
} from "@/types/blocking";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface BlockingState {
  // Keywords
  keywords: string[];

  // Websites
  includedUrls: BlockedUrl[];
  excludedUrls: BlockedUrl[];
  siteControlMode: ControlMode;
  siteSurveillance: SurveillanceConfig;

  // Categories
  categories: BlockingCategory[];
  adultBlockingEnabled: boolean;
  adultControlMode: ControlMode;
  adultSurveillance: SurveillanceConfig;
  categoryDomainCounts: Record<string, number>;

  // Custom Sources
  sources: BlocklistSource[];

  // Blocked Apps
  blockedApps: BlockedApp[];

  // Reels blocking (per-app package names that are enabled)
  enabledReelsApps: string[];
  reelsControlMode: ControlMode;
  reelsSurveillance: SurveillanceConfig;

  // Reels actions
  toggleReelsApp: (packageName: string) => void;
  setReelsControlMode: (mode: ControlMode) => void;
  setReelsSurveillance: (config: SurveillanceConfig) => void;

  // NSFW app monitoring (per-app package names scanned for keywords)
  enabledNsfwApps: string[];
  toggleNsfwApp: (packageName: string) => void;

  // Keyword actions
  addKeyword: (keyword: string) => void;
  removeKeyword: (keyword: string) => void;
  removeKeywords: (keywordsToRemove: string[]) => void;
  setKeywords: (keywords: string[]) => void;

  // URL actions
  addIncludedUrl: (url: string) => void;
  removeIncludedUrl: (url: string) => void;
  toggleIncludedUrl: (url: string) => void;
  addExcludedUrl: (url: string) => void;
  removeExcludedUrl: (url: string) => void;
  toggleExcludedUrl: (url: string) => void;
  setSiteControlMode: (mode: ControlMode) => void;
  setSiteSurveillance: (config: SurveillanceConfig) => void;

  // Category actions
  toggleCategory: (id: string) => void;
  addCategory: (category: BlockingCategory) => void;
  removeCategory: (id: string) => void;
  updateCategoryDomains: (id: string, domains: string[]) => void;
  setAdultBlockingEnabled: (enabled: boolean) => void;
  setAdultControlMode: (mode: ControlMode) => void;
  setAdultSurveillance: (config: SurveillanceConfig) => void;
  setCategoryDomainCount: (id: string, count: number) => void;

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
    url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn-only/hosts",
    format: "hosts",
    enabled: true,
  },
  {
    id: "oisd-nsfw",
    name: "oisd nsfw (Porn)",
    url: "https://nsfw.oisd.nl/domainswild2",
    format: "domains",
    enabled: true,
  },
  {
    id: "hagezi-pro",
    name: "HaGeZi Pro (Ads/Trackers)",
    url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/pro-onlydomains.txt",
    format: "domains",
    enabled: true,
    category: "ads",
  },
];

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

export const useBlockingStore = create<BlockingState>()(
  persist(
    (set) => ({
      keywords: [],
      includedUrls: [],
      excludedUrls: [],
      siteControlMode: "flexible",
      siteSurveillance: { type: "none", value: 0 },
      categories: [...DEFAULT_CATEGORIES],
      adultBlockingEnabled: true,
      adultControlMode: "flexible",
      adultSurveillance: { type: "none", value: 0 },
      categoryDomainCounts: {},
      sources: DEFAULT_SOURCES,
      blockedApps: [],
      enabledReelsApps: [],
      reelsControlMode: "flexible",
      reelsSurveillance: { type: "none", value: 0 },

      toggleReelsApp: (packageName) =>
        set((state) => {
          const exists = state.enabledReelsApps.includes(packageName);
          return {
            enabledReelsApps: exists
              ? state.enabledReelsApps.filter((p) => p !== packageName)
              : [...state.enabledReelsApps, packageName],
          };
        }),
      setReelsControlMode: (mode) => set({ reelsControlMode: mode }),
      setReelsSurveillance: (config) => set({ reelsSurveillance: config }),

      enabledNsfwApps: [],
      toggleNsfwApp: (packageName) =>
        set((state) => {
          const exists = state.enabledNsfwApps.includes(packageName);
          return {
            enabledNsfwApps: exists
              ? state.enabledNsfwApps.filter((p) => p !== packageName)
              : [...state.enabledNsfwApps, packageName],
          };
        }),

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
          if (!lower || state.includedUrls.some((u) => u.url === lower))
            return state;
          return {
            includedUrls: [
              ...state.includedUrls,
              { url: lower, enabled: true },
            ],
          };
        }),

      removeIncludedUrl: (url) =>
        set((state) => ({
          includedUrls: state.includedUrls.filter((u) => u.url !== url),
        })),

      toggleIncludedUrl: (url) =>
        set((state) => ({
          includedUrls: state.includedUrls.map((u) =>
            u.url === url ? { ...u, enabled: !u.enabled } : u,
          ),
        })),

      addExcludedUrl: (url) =>
        set((state) => {
          const lower = url.trim().toLowerCase();
          if (!lower || state.excludedUrls.some((u) => u.url === lower))
            return state;
          return {
            excludedUrls: [
              ...state.excludedUrls,
              { url: lower, enabled: true },
            ],
          };
        }),

      removeExcludedUrl: (url) =>
        set((state) => ({
          excludedUrls: state.excludedUrls.filter((u) => u.url !== url),
        })),

      toggleExcludedUrl: (url) =>
        set((state) => ({
          excludedUrls: state.excludedUrls.map((u) =>
            u.url === url ? { ...u, enabled: !u.enabled } : u,
          ),
        })),

      setSiteControlMode: (mode) => set({ siteControlMode: mode }),
      setSiteSurveillance: (config) => set({ siteSurveillance: config }),

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

      setAdultControlMode: (mode) => set({ adultControlMode: mode }),
      setAdultSurveillance: (config) => set({ adultSurveillance: config }),

      setCategoryDomainCount: (id, count) =>
        set((state) => ({
          categoryDomainCounts: { ...state.categoryDomainCounts, [id]: count },
        })),

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
          categories: data.categories || state.categories,
          adultBlockingEnabled:
            data.adultBlockingEnabled ?? state.adultBlockingEnabled,
          sources: data.sources || state.sources,
          blockedApps: data.blockedApps || state.blockedApps,
        })),
    }),
    {
      name: "freedom-blocking-store",
      storage: createJSONStorage(() => sqliteStorage),
      // sources is force-reset to DEFAULT_SOURCES below on every rehydrate —
      // persisting it would be pure waste.
      partialize: (state) => {
        const { sources: _sources, ...persisted } = state;
        return persisted;
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Force-reset sources to exactly DEFAULT_SOURCES on every launch.
          state.importSettings({ sources: [...DEFAULT_SOURCES] });

          // Restore default categories if persisted state has none
          if (state.categories.length === 0) {
            state.importSettings({ categories: [...DEFAULT_CATEGORIES] });
          } else if (!state.categories.some((c) => c.id === "ads")) {
            // Existing user predating the ads category — inject it (disabled)
            state.importSettings({
              categories: [...state.categories, ADS_CATEGORY],
            });
          }

          // Migrate old string[] URLs to BlockedUrl[] objects
          if (
            state.includedUrls.length > 0 &&
            typeof state.includedUrls[0] === "string"
          ) {
            state.importSettings({
              includedUrls: (state.includedUrls as unknown as string[]).map(
                (url) => ({ url, enabled: true }),
              ),
            });
          }
          if (
            state.excludedUrls.length > 0 &&
            typeof state.excludedUrls[0] === "string"
          ) {
            state.importSettings({
              excludedUrls: (state.excludedUrls as unknown as string[]).map(
                (url) => ({ url, enabled: true }),
              ),
            });
          }
        }
      },
    },
  ),
);

/** Helper: get only enabled included URLs as string[] for native sync */
export function getActiveIncludedUrls(): string[] {
  return useBlockingStore
    .getState()
    .includedUrls.filter((u) => u.enabled)
    .map((u) => u.url);
}

/** Helper: get only enabled excluded URLs as string[] for native sync */
export function getActiveExcludedUrls(): string[] {
  return useBlockingStore
    .getState()
    .excludedUrls.filter((u) => u.enabled)
    .map((u) => u.url);
}
