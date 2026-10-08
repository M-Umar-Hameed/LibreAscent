// Non-shipping runnable check for services/protectionProblems.ts.
// Run with: node scripts/check-protection-problems.js
const assert = require("node:assert");
const {
  describeProblem,
  sameProblems,
} = require("../services/protectionProblems.ts");
const {
  partializeAppState,
} = require("../stores/appStorePersistence.ts");

assert.strictEqual(sameProblems([], []), true);
assert.strictEqual(sameProblems(["vpn_down"], ["vpn_down"]), true);
assert.strictEqual(sameProblems(["vpn_down"], []), false);
assert.strictEqual(sameProblems(["vpn_down"], ["accessibility_off"]), false);
assert.strictEqual(sameProblems(["a|b"], ["a", "b"]), false);

assert.deepStrictEqual(describeProblem("vpn_down"), {
  message: "DNS protection is off: the LibreAscent VPN is not running",
  target: "vpn",
});
assert.deepStrictEqual(describeProblem("vpn_taken:com.other.vpn"), {
  message: "DNS protection is off: com.other.vpn is set as the always-on VPN",
  target: "vpn",
});
assert.deepStrictEqual(describeProblem("vpn_taken:"), {
  message: "DNS protection is off: another VPN app holds the VPN slot",
  target: "vpn",
});
assert.deepStrictEqual(describeProblem("accessibility_off"), {
  message: "Content protection is off: accessibility service is disabled",
  target: "accessibility",
});
assert.strictEqual(describeProblem("something_new").target, "vpn");

const persisted = partializeAppState({
  protection: {},
  protectionProblems: ["vpn_down"],
  stats: { cleanSince: "x", daysClean: 1, blockedToday: 2 },
});
assert.strictEqual("protectionProblems" in persisted, false);

console.log("protectionProblems: all checks passed");
