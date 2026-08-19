// Pure in-memory "did this value change" gate. No native deps, so this
// stays testable independent of the SQLite-backed store below.
let last: string | null = null;

/** Returns true (and records the value) if it differs from the last write. */
export function shouldWrite(value: string): boolean {
  if (value === last) return false;
  last = value;
  return true;
}
