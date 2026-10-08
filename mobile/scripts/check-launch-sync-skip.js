// Non-shipping runnable check for services/launchSyncSkip.ts.
// Run with: node scripts/check-launch-sync-skip.js
const assert = require("node:assert");
const { canSkipSync } = require("../services/launchSyncSkip.ts");

const keywords = ["a"];
const apps = [];
const synced = [keywords, apps, true];
const base = {
  armed: true,
  urlsChanged: false,
  categoriesChanged: false,
  slices: [keywords, apps, true],
  syncedSlices: synced,
};

assert.strictEqual(canSkipSync(base), true, "unchanged slices skip");
assert.strictEqual(
  canSkipSync({ ...base, slices: [[...keywords, "b"], apps, true] }),
  false,
  "a changed slice does not skip",
);
assert.strictEqual(canSkipSync({ ...base, armed: false }), false, "only when armed");
assert.strictEqual(canSkipSync({ ...base, urlsChanged: true }), false);
assert.strictEqual(canSkipSync({ ...base, categoriesChanged: true }), false);
assert.strictEqual(
  canSkipSync({ ...base, syncedSlices: [] }),
  false,
  "no completed sync yet, nothing to compare against",
);

// An edit lands while the recovery sync is in flight. That sync recorded the
// slices it read when it started, so the edit shows up as a difference.
const capturedAtStart = [keywords, apps, true];
const editedKeywords = [...keywords, "added-during-sync"];
assert.strictEqual(
  canSkipSync({
    ...base,
    slices: [editedKeywords, apps, true],
    syncedSlices: capturedAtStart,
  }),
  false,
  "an edit during the in-flight sync is still sent",
);

console.log("launchSyncSkip: all checks passed");
