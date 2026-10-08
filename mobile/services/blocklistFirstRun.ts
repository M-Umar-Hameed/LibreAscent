export const FIRST_RUN_RETRY_MS = 6 * 60 * 60 * 1000;

/**
 * Seeds the defaults once, and only into an empty list, so a keyword the user
 * later removes is never re-added.
 */
export function mergeDefaultKeywords(
  keywords: string[],
  applied: boolean,
  defaults: string[],
): { keywords: string[]; applied: boolean } {
  if (applied) return { keywords, applied };
  return {
    keywords: keywords.length === 0 ? [...defaults] : keywords,
    applied: true,
  };
}

/** At most one attempt per launch, and none within 6 hours of a failure. */
export function shouldFetchOnLaunch(input: {
  needsFetch: boolean;
  attemptedThisLaunch: boolean;
  lastFailureAt: number;
  now: number;
}): boolean {
  if (!input.needsFetch || input.attemptedThisLaunch) return false;
  return input.now - input.lastFailureAt >= FIRST_RUN_RETRY_MS;
}
