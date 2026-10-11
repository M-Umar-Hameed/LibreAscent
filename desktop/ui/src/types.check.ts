// Run with: node src/types.check.ts
import assert from "node:assert/strict";
import { windowShrinks } from "./types.ts";

const w = (startHour: number, endHour: number) => ({
  enabled: true,
  startHour,
  endHour,
  countdownSeconds: 0,
  clickCount: 0,
});

// All-day lock: moving either hour unlocks something.
assert.equal(windowShrinks(w(0, 0), w(1, 0)), true);
assert.equal(windowShrinks(w(0, 0), w(0, 23)), true);
assert.equal(windowShrinks(w(0, 0), w(5, 5)), false);
// Growing a window is free; shrinking is not.
assert.equal(windowShrinks(w(22, 6), w(21, 6)), false);
assert.equal(windowShrinks(w(22, 6), w(22, 7)), false);
assert.equal(windowShrinks(w(22, 6), w(23, 6)), true);
assert.equal(windowShrinks(w(9, 17), w(9, 9)), false);
assert.equal(windowShrinks(w(9, 17), w(10, 17)), true);
console.log("types.check: ok");
