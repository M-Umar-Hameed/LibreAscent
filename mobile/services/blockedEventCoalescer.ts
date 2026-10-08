/**
 * Counts blocked events and hands the total to flush at most once per
 * intervalMs. A page load blocks dozens of domains in a burst; each one used
 * to be its own store update and re-render.
 */
export function createBlockedEventCoalescer(
  flush: (count: number) => void,
  intervalMs = 1000,
  schedule: (run: () => void, ms: number) => void = (run, ms) => {
    setTimeout(run, ms);
  },
): () => void {
  let pending = 0;
  let scheduled = false;
  return () => {
    pending += 1;
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      const count = pending;
      pending = 0;
      flush(count);
    }, intervalMs);
  };
}
