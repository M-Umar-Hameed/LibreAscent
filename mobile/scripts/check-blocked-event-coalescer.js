// Non-shipping runnable check for services/blockedEventCoalescer.ts and the
// count it hands to incrementBlockedStats. Run with:
//   node scripts/check-blocked-event-coalescer.js
const assert = require("node:assert");
const {
  createBlockedEventCoalescer,
} = require("../services/blockedEventCoalescer.ts");
const { incrementBlockedStats } = require("../stores/appStorePersistence.ts");

const timers = [];
const flushed = [];
const record = createBlockedEventCoalescer(
  (count) => flushed.push(count),
  1000,
  (run, ms) => timers.push({ run, ms }),
);

for (let i = 0; i < 25; i++) record();
assert.strictEqual(timers.length, 1, "a burst schedules one flush");
assert.strictEqual(timers[0].ms, 1000);
assert.deepStrictEqual(flushed, [], "nothing reaches the store before the interval");

timers.shift().run();
assert.deepStrictEqual(flushed, [25], "the burst lands as one update");

record();
record();
assert.strictEqual(timers.length, 1, "the next event starts a new interval");
timers.shift().run();
assert.deepStrictEqual(flushed, [25, 2]);

const stats = incrementBlockedStats(
  { blockedToday: 1, totalBlocked: 10, lastBlockedAt: null, cleanSince: "", daysClean: 0 },
  25,
);
assert.strictEqual(stats.blockedToday, 26);
assert.strictEqual(stats.totalBlocked, 35);

console.log("blockedEventCoalescer: all checks passed");
