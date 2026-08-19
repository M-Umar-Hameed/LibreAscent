// Non-shipping runnable check for stores/appStorePersistence.ts and
// db/dedupeWrite.ts. Run with: node scripts/check-app-store-dedup-write.js
const assert = require("node:assert");
const {
  incrementBlockedStats,
  partializeAppState,
} = require("../stores/appStorePersistence.ts");
const { isUnchanged, recordWritten } = require("../db/dedupeWrite.ts");

const baseState = {
  protection: {
    vpn: false,
    accessibility: false,
    overlay: false,
    deviceAdmin: false,
    foregroundService: false,
  },
  stats: {
    blockedToday: 0,
    totalBlocked: 0,
    lastBlockedAt: null,
    cleanSince: "2024-01-01T00:00:00.000Z",
    daysClean: 0,
  },
  autoStartOnBoot: true,
  appLockEnabled: false,
  appLockType: null,
  appLockHash: null,
  appThemeId: "default",
  customTheme: null,
  overlayCustomImage: null,
  overlayTexts: { title: "", subtitle: "", heading: "", body: "" },
  controlMode: "flexible",
  schedule: [],
  surveillance: { type: "none", value: 0, startHour: 0, endHour: 0 },
  isOnboarded: false,
};

// Two real blocked events via the real reducer used by incrementBlocked().
const afterOne = { ...baseState, stats: incrementBlockedStats(baseState.stats) };
const afterTwo = { ...afterOne, stats: incrementBlockedStats(afterOne.stats) };

// Sanity: the two events must have actually changed something, so the
// assertion below is proving partialize cancels a real difference, not a
// difference that never existed.
assert.notStrictEqual(
  JSON.stringify(afterOne.stats),
  JSON.stringify(afterTwo.stats),
  "sanity: two blocked events should change stats",
);

// The load-bearing property: the real partialize output for the app store's
// persist middleware must not change across blocked events.
assert.strictEqual(
  JSON.stringify(partializeAppState(afterOne)),
  JSON.stringify(partializeAppState(afterTwo)),
  "a blocked event must not change the persisted app-store blob",
);

// A settings change (outside stats) must still change the persisted blob.
const withSetting = { ...afterTwo, controlMode: "hardcore" };
assert.notStrictEqual(
  JSON.stringify(partializeAppState(afterTwo)),
  JSON.stringify(partializeAppState(withSetting)),
  "a real settings change must change the persisted app-store blob",
);

// dedupeWrite: a failed write must not be recorded, so it's retried.
assert.strictEqual(isUnchanged("v1"), false, "nothing written yet");
assert.strictEqual(
  isUnchanged("v1"),
  false,
  "a failed write (recordWritten not called) must not be treated as done",
);
recordWritten("v1");
assert.strictEqual(
  isUnchanged("v1"),
  true,
  "a confirmed write is skipped next time",
);
assert.strictEqual(isUnchanged("v2"), false, "a different value is not unchanged");

console.log("appStorePersistence/dedupeWrite: all checks passed");
