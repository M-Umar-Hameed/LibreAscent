// Pure in-memory counter for blocked-domain events. No native deps, so this
// stays flushable/testable independent of the SQLite-backed store below.
let pending = 0;

/** Record one blocked event; call on every native block event. */
export function incrementPending(): void {
  pending += 1;
}

/** Returns the pending count and resets it to zero. */
export function drainPending(): number {
  const count = pending;
  pending = 0;
  return count;
}
