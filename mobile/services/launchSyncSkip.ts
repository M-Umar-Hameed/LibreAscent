/**
 * Whether the sync armed by skipNextSyncIfUnchanged can return early: nothing
 * it would push differs from what the last completed sync pushed. Slices are
 * compared by reference; zustand replaces a slice whenever it changes.
 */
export function canSkipSync(input: {
  armed: boolean;
  urlsChanged: boolean;
  categoriesChanged: boolean;
  slices: readonly unknown[];
  syncedSlices: readonly unknown[];
}): boolean {
  return (
    input.armed &&
    !input.urlsChanged &&
    !input.categoriesChanged &&
    input.slices.length === input.syncedSlices.length &&
    input.slices.every((slice, i) => slice === input.syncedSlices[i])
  );
}
