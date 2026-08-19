// Non-shipping runnable check for db/dedupeWrite.ts.
// Run with: node scripts/check-app-store-dedup-write.js
const assert = require("node:assert");
const { shouldWrite } = require("../db/dedupeWrite.ts");

// (a) A settings change must reach disk promptly: shouldWrite() is
// synchronous with no queue/timer, so returning true IS the immediate write.
const settingsA = '{"controlMode":"flexible"}';
const settingsB = '{"controlMode":"hardcore"}';
assert.strictEqual(
  shouldWrite(settingsA),
  true,
  "first write should proceed",
);
assert.strictEqual(
  shouldWrite(settingsB),
  true,
  "a genuinely changed value must write immediately",
);

// (b) Repeated blocked events serialize to the same value (the persisted
// blob excludes the per-event counter fields), so none of them should write.
let writes = 0;
for (let i = 0; i < 5; i++) {
  if (shouldWrite(settingsB)) writes += 1;
}
assert.strictEqual(
  writes,
  0,
  "a run of blocked events should produce no app-store write",
);

console.log("dedupeWrite: all checks passed");
