// Runnable check for strengthenOnly in types/blocking.ts.
// Run with: node scripts/check-import-strengthen.js
const assert = require("node:assert");
const { strengthenOnly } = require("../types/blocking.ts");

const current = {
  keywords: ["hentai", "nsfw"],
  includedUrls: [
    { url: "bad.example", enabled: true },
    { url: "off.example", enabled: false },
  ],
  excludedUrls: [{ url: "mangaread.org", enabled: true }],
  adultBlockingEnabled: true,
  blockedApps: [{ packageName: "com.a" }],
};

// A hostile file: empties the blocklist, widens the whitelist, turns adult
// blocking off, drops blocked apps.
const weakened = strengthenOnly(current, {
  keywords: [],
  includedUrls: [],
  excludedUrls: [{ url: "pornhub.com", enabled: true }],
  adultBlockingEnabled: false,
  blockedApps: [],
});
assert.deepStrictEqual(weakened.keywords, current.keywords);
assert.deepStrictEqual(weakened.includedUrls, current.includedUrls);
assert.deepStrictEqual(weakened.excludedUrls, current.excludedUrls, "whitelist never grows");
assert.strictEqual(weakened.adultBlockingEnabled, true);
assert.deepStrictEqual(weakened.blockedApps, current.blockedApps);

// Additions apply.
const strengthened = strengthenOnly(current, {
  keywords: ["Manga", "nsfw"],
  includedUrls: [
    { url: "new.example", enabled: true },
    { url: "off.example", enabled: true },
    { url: "ignored.example", enabled: false },
  ],
  blockedApps: [{ packageName: "com.b" }],
});
assert.deepStrictEqual(strengthened.keywords, ["hentai", "nsfw", "manga"]);
assert.deepStrictEqual(strengthened.includedUrls, [
  { url: "bad.example", enabled: true },
  { url: "off.example", enabled: true },
  { url: "new.example", enabled: true },
]);
assert.deepStrictEqual(
  strengthened.blockedApps.map((a) => a.packageName),
  ["com.a", "com.b"],
);

console.log("check-import-strengthen: ok");
