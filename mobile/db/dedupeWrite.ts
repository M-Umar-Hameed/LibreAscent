// Tracks the last successfully written value to skip redundant writes.
let last: string | null = null;

export function isUnchanged(value: string): boolean {
  return value === last;
}

/** Call only after a write of `value` has actually succeeded. */
export function recordWritten(value: string): void {
  last = value;
}
