// Non-shipping runnable check for db/blockedCountAccumulator.ts.
// Run with: node scripts/check-blocked-count-accumulator.js
const assert = require("node:assert");
const {
  incrementPending,
  flushPending,
} = require("../db/blockedCountAccumulator.ts");

const N = 7;
for (let i = 0; i < N; i++) {
  incrementPending();
}
let writes = [];
flushPending((count) => writes.push(count));
assert.deepStrictEqual(
  writes,
  [N],
  `${N} increments should flush as a single write of ${N}`,
);

writes = [];
flushPending((count) => writes.push(count));
assert.deepStrictEqual(
  writes,
  [],
  "a flush with zero pending should perform no write",
);

console.log("blockedCountAccumulator: all checks passed");
