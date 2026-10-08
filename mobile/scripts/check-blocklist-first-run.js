// Non-shipping runnable check for services/blocklistFirstRun.ts and the
// default keyword list. Run with: node scripts/check-blocklist-first-run.js
const assert = require("node:assert");
const {
  FIRST_RUN_RETRY_MS,
  mergeDefaultKeywords,
  shouldFetchOnLaunch,
} = require("../services/blocklistFirstRun.ts");
const {
  DEFAULT_ADULT_KEYWORDS,
} = require("../data/keywords/defaultAdultKeywords.ts");

const defaults = ["porn", "xxx"];
assert.deepStrictEqual(mergeDefaultKeywords([], false, defaults), {
  keywords: defaults,
  applied: true,
});
assert.deepStrictEqual(mergeDefaultKeywords(["mine"], false, defaults), {
  keywords: ["mine"],
  applied: true,
});
// A user who removed everything after the defaults were applied stays empty.
assert.deepStrictEqual(mergeDefaultKeywords([], true, defaults), {
  keywords: [],
  applied: true,
});

const base = { needsFetch: true, attemptedThisLaunch: false, now: 10 * FIRST_RUN_RETRY_MS };
assert.strictEqual(shouldFetchOnLaunch({ ...base, lastFailureAt: 0 }), true);
assert.strictEqual(shouldFetchOnLaunch({ ...base, needsFetch: false, lastFailureAt: 0 }), false);
assert.strictEqual(shouldFetchOnLaunch({ ...base, attemptedThisLaunch: true, lastFailureAt: 0 }), false);
assert.strictEqual(shouldFetchOnLaunch({ ...base, lastFailureAt: base.now - 1000 }), false);
assert.strictEqual(
  shouldFetchOnLaunch({ ...base, lastFailureAt: base.now - FIRST_RUN_RETRY_MS }),
  true,
);

// Default list stays within the matcher's safe shape.
assert.strictEqual(new Set(DEFAULT_ADULT_KEYWORDS).size, DEFAULT_ADULT_KEYWORDS.length);
for (const k of DEFAULT_ADULT_KEYWORDS) {
  assert.ok(/^[a-z0-9]+$/.test(k), k);
  assert.ok(k.length >= 4 || k === "xxx", k);
}
const common = ["essex", "sussex", "class", "assess", "title", "document", "computer", "scunthorpe", "analysis", "cockpit", "milford", "popcorn", "classic", "therapist", "shiitake"];
for (const w of common) {
  assert.ok(!DEFAULT_ADULT_KEYWORDS.some((k) => k !== "xxx" && w.includes(k)), w);
}
console.log("ok");
