import type { BlockingStats } from "@/types/blocking";
import type { AppState } from "./useAppStore";

export type PersistedAppState = Omit<
  AppState,
  "protection" | "protectionProblems" | "stats"
> & {
  stats: Pick<BlockingStats, "cleanSince" | "daysClean">;
};

/** Bumps the blocked counters by count blocked events. */
export function incrementBlockedStats(
  stats: BlockingStats,
  count = 1,
): BlockingStats {
  return {
    ...stats,
    blockedToday: stats.blockedToday + count,
    totalBlocked: stats.totalBlocked + count,
    lastBlockedAt: new Date().toISOString(),
  };
}

/** Drops fields that change per blocked event, so dedupingAppStoreStorage can skip those writes. */
export function partializeAppState(state: AppState): PersistedAppState {
  const {
    protection: _protection,
    protectionProblems: _protectionProblems,
    stats,
    ...rest
  } = state;
  return {
    ...rest,
    stats: { cleanSince: stats.cleanSince, daysClean: stats.daysClean },
  };
}

/** Restores the fields partializeAppState dropped from the fresh in-memory state. */
export function mergeAppState(
  persistedState: unknown,
  currentState: AppState,
): AppState {
  const persisted = persistedState as Partial<PersistedAppState> | undefined;
  return {
    ...currentState,
    ...persisted,
    stats: { ...currentState.stats, ...persisted?.stats },
  };
}
