// Non-shipping runnable check for db/blockedCountAccumulator.ts.
// Run with: node scripts/check-blocked-count-accumulator.js
const assert = require("node:assert");
const {
  incrementPending,
  drainPending,
} = require("../db/blockedCountAccumulator.ts");

// Mirrors flushBlockedStats()'s "skip the write if nothing pending" branch.
function flush(write) {
  const count = drainPending();
  if (count > 0) write(count);
}

const N = 7;
for (let i = 0; i < N; i++) {
  incrementPending();
}
let writes = [];
flush((count) => writes.push(count));
assert.deepStrictEqual(
  writes,
  [N],
  `${N} increments should flush as a single write of ${N}`,
);

writes = [];
flush((count) => writes.push(count));
assert.deepStrictEqual(
  writes,
  [],
  "a flush with zero pending should perform no write",
);

console.log("blockedCountAccumulator: all checks passed");
