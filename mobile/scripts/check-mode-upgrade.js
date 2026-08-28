// Runnable check for isModeUpgrade in types/blocking.ts.
// Run with: node scripts/check-mode-upgrade.js
const assert = require("node:assert");
const { isModeUpgrade } = require("../types/blocking.ts");

// Promotions (tightening) are upgrades -> friction bypassed.
assert.strictEqual(
  isModeUpgrade("locked", "hardcore"),
  true,
  "locked->hardcore is an upgrade",
);
assert.strictEqual(
  isModeUpgrade("flexible", "locked"),
  true,
  "flexible->locked is an upgrade",
);
assert.strictEqual(
  isModeUpgrade("flexible", "hardcore"),
  true,
  "flexible->hardcore is an upgrade",
);

// Weakening / lateral are NOT upgrades -> friction still required.
assert.strictEqual(
  isModeUpgrade("hardcore", "locked"),
  false,
  "hardcore->locked weakens",
);
assert.strictEqual(
  isModeUpgrade("hardcore", "flexible"),
  false,
  "hardcore->flexible weakens",
);
assert.strictEqual(
  isModeUpgrade("locked", "flexible"),
  false,
  "locked->flexible weakens",
);
assert.strictEqual(
  isModeUpgrade("locked", "locked"),
  false,
  "same mode is not an upgrade",
);
assert.strictEqual(
  isModeUpgrade("hardcore", "hardcore"),
  false,
  "same mode is not an upgrade",
);

console.log("mode-upgrade: all checks passed");