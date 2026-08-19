// ponytail: in-memory only — a pending count is lost if the process dies
// before FLUSH_THRESHOLD (database.ts) is hit or an AppState flush fires.
// Upgrade path: a durable native queue (e.g. WorkManager) if that's too high.
let pending = 0;

/** Records one blocked event; returns the new pending count. */
export function incrementPending(): number {
  pending += 1;
  return pending;
}

/** Drains pending and calls write(count) only if there is something to flush. */
export function flushPending(write: (count: number) => void): void {
  const count = pending;
  if (count === 0) return;
  pending = 0;
  write(count);
}
