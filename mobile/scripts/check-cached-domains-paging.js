// Non-shipping runnable check for the keyset paging in db/database.ts
// (readCachedDomainsBatch) and its only caller, syncCategoryFromCache in
// services/BlocklistService.ts. Run with:
//   node scripts/check-cached-domains-paging.js
//
// db/database.ts opens expo-sqlite at import time and BlocklistService.ts
// imports native modules, so neither loads under node. The SQL and the paging
// loop are reproduced here against node:sqlite and pinned to the real source
// text below so they cannot drift apart silently.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const KEYSET_SQL =
  "SELECT DISTINCT domain FROM cached_domains WHERE category_id = ? AND domain > ? ORDER BY domain LIMIT ?";
const OFFSET_SQL =
  "SELECT DISTINCT domain FROM cached_domains WHERE category_id = ? LIMIT ? OFFSET ?";

const databaseSrc = fs.readFileSync(
  path.join(__dirname, "..", "db", "database.ts"),
  "utf8",
);
assert.ok(
  databaseSrc.includes(KEYSET_SQL),
  "db/database.ts no longer contains the keyset query this check exercises",
);

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE cached_domains (
    source_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    domain TEXT NOT NULL
  );
  CREATE INDEX idx_cached_domains_source ON cached_domains(source_id);
  CREATE INDEX idx_cached_domains_cat_domain ON cached_domains(category_id, domain);
`);

const insert = db.prepare(
  "INSERT INTO cached_domains (source_id, category_id, domain) VALUES (?, ?, ?)",
);
const seed = (sourceId, categoryId, domains) => {
  for (const d of domains) insert.run(sourceId, categoryId, d);
};

// Domain names are deliberately not in insertion order, so a paging bug that
// leans on rowid order instead of domain order shows up.
const gen = (n) =>
  Array.from({ length: n }, (_, i) => `d${String((i * 7) % n).padStart(4, "0")}.example`);

// exact: 20 distinct domains, an exact multiple of PAGE below.
seed("src-a", "exact", gen(20));
// ragged: 23 distinct domains, not a multiple of PAGE.
seed("src-a", "ragged", gen(23));
// dupes: two sources contributing an overlapping set to one category.
const dupA = gen(12);
const dupB = gen(12).slice(4).concat(["z-extra.example", "a-extra.example"]);
seed("src-a", "dupes", dupA);
seed("src-b", "dupes", dupB);
// empty: no rows at all.

const PAGE = 5;
const keysetStmt = db.prepare(KEYSET_SQL);
const offsetStmt = db.prepare(OFFSET_SQL);

// The paging loop from syncCategoryFromCache, minus the native calls.
function readKeyset(categoryId) {
  const all = [];
  const pages = [];
  let after = "";
  for (let guard = 0; ; guard++) {
    assert.ok(guard < 1000, `keyset paging did not terminate for ${categoryId}`);
    const batch = keysetStmt.all(categoryId, after, PAGE).map((r) => r.domain);
    if (batch.length === 0) break;
    all.push(...batch);
    pages.push(batch.length);
    after = batch[batch.length - 1];
  }
  return { all, pages };
}

// The loop this replaced: LIMIT/OFFSET bounded by COUNT(DISTINCT domain).
function readOffset(categoryId) {
  const total = db
    .prepare(
      "SELECT COUNT(DISTINCT domain) as c FROM cached_domains WHERE category_id = ?",
    )
    .get(categoryId).c;
  const all = [];
  for (let offset = 0; offset < total; offset += PAGE) {
    const batch = offsetStmt.all(categoryId, PAGE, offset).map((r) => r.domain);
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

const sorted = (xs) => [...xs].sort();

for (const categoryId of ["exact", "ragged", "dupes", "empty"]) {
  const { all, pages } = readKeyset(categoryId);
  const legacy = readOffset(categoryId);

  // The load-bearing property: byte-identical domain sets, old vs new.
  assert.deepStrictEqual(
    sorted(all),
    sorted(legacy),
    `${categoryId}: keyset paging returned a different domain set than OFFSET paging`,
  );
  // No domain may be emitted twice across page boundaries.
  assert.strictEqual(
    new Set(all).size,
    all.length,
    `${categoryId}: keyset paging emitted a duplicate domain`,
  );
  // Every page except the last is full, so nothing was skipped mid-run.
  for (let i = 0; i < pages.length - 1; i++) {
    assert.strictEqual(
      pages[i],
      PAGE,
      `${categoryId}: short page ${i} before the end of the category`,
    );
  }
}

// Sanity on the fixtures themselves, so the assertions above are proving
// something about real data rather than four empty result sets.
assert.strictEqual(readKeyset("exact").all.length, 20, "exact fixture size");
assert.strictEqual(readKeyset("exact").pages.length, 4, "exact page count");
assert.strictEqual(readKeyset("ragged").all.length, 23, "ragged fixture size");
assert.deepStrictEqual(
  readKeyset("ragged").pages,
  [5, 5, 5, 5, 3],
  "ragged page shape",
);
assert.strictEqual(readKeyset("empty").all.length, 0, "empty category");
assert.strictEqual(readKeyset("empty").pages.length, 0, "empty terminates at once");

// DISTINCT must collapse the two sources' overlap: 22 rows, 14 unique domains.
assert.strictEqual(
  db
    .prepare("SELECT COUNT(*) as c FROM cached_domains WHERE category_id = ?")
    .get("dupes").c,
  22,
  "dupes fixture row count",
);
assert.deepStrictEqual(
  readKeyset("dupes").all,
  sorted(new Set([...dupA, ...dupB])),
  "dupes: DISTINCT must collapse domains shared by two sources, in domain order",
);

// hasCachedDomains / hasSourceDomains: the EXISTS checks behind the ad-block
// enable path must not answer yes for an empty category, a pruned source, or a
// source whose rows are all still under the category it used to belong to.
const exists = (sql, ...args) => db.prepare(sql).get(...args).e === 1;
const HAS_CATEGORY_SQL =
  "SELECT EXISTS(SELECT 1 FROM cached_domains WHERE category_id = ? LIMIT 1) as e";
const HAS_SOURCE_SQL =
  "SELECT EXISTS(SELECT 1 FROM cached_domains WHERE source_id = ? AND category_id = ? LIMIT 1) as e";
assert.ok(
  databaseSrc.includes(HAS_CATEGORY_SQL),
  "hasCachedDomains query drifted",
);
assert.ok(databaseSrc.includes(HAS_SOURCE_SQL), "hasSourceDomains query drifted");
assert.strictEqual(exists(HAS_CATEGORY_SQL, "exact"), true, "populated category");
assert.strictEqual(exists(HAS_CATEGORY_SQL, "empty"), false, "empty category");
assert.strictEqual(
  exists(HAS_SOURCE_SQL, "src-b", "dupes"),
  true,
  "source with rows under its own category",
);
assert.strictEqual(
  exists(HAS_SOURCE_SQL, "src-gone", "dupes"),
  false,
  "unknown source",
);
// The F1 case: src-b's rows exist, but under "dupes". A release that moves it
// to a new category must not be told its cache is still usable.
assert.strictEqual(
  exists(HAS_SOURCE_SQL, "src-b", "moved-category"),
  false,
  "rows under the source's previous category must not count as a cache hit",
);

console.log("cachedDomains keyset paging: all checks passed");
