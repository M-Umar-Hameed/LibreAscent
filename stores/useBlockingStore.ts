import { sqliteStorage } from "@/db/database";
import type { BlockingCategory } from "@/types/blocking";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface BlockingState {
  // Keywords
  keywords: string[];

  // Websites
  includedUrls: string[];
  excludedUrls: string[];

  // Categories
  categories: BlockingCategory[];
  adultBlockingEnabled: boolean;

  // Keyword actions
  addKeyword: (keyword: string) => void;
  removeKeyword: (keyword: string) => void;
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
}

export const useBlockingStore = create<BlockingState>()(
  persist(
    (set) => ({
      keywords: [],
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
          description: "Animated adult content and manga",
          domains: [],
          enabled: true,
        },
      ],
      adultBlockingEnabled: true,

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

      setKeywords: (keywords) => set({ keywords }),

      addIncludedUrl: (url) =>
        set((state) => {
          const lower = url.trim().toLowerCase();
          // console.log(`[useBlockingStore] addIncludedUrl called for: ${lower}`);
          if (!lower || state.includedUrls.includes(lower)) {
            // console.log(`[useBlockingStore] Url ${lower} not added (empty or already exists)`);
            return state;
          }
          // console.log(`[useBlockingStore] Successfully added ${lower} to includedUrls`);
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
          // Keep a unique list to avoid storing duplicates and bloating sqlite
          const uniqueDomains = Array.from(new Set(domains));
          return {
            categories: state.categories.map((cat) =>
              cat.id === id ? { ...cat, domains: uniqueDomains } : cat,
            ),
          };
        }),

      setAdultBlockingEnabled: (enabled) =>
        set({ adultBlockingEnabled: enabled }),
    }),
    {
      name: "freedom-blocking-store",
      storage: createJSONStorage(() => sqliteStorage),
    },
  ),
);
