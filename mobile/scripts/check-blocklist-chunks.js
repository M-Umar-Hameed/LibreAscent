// Non-shipping runnable check for db/blocklistChunks.ts, run against
// node:sqlite on the cached_domains/source_cache schema from db/database.ts.
// Run with: node scripts/check-blocklist-chunks.js
const assert = require("node:assert");
const { DatabaseSync } = require("node:sqlite");
const {
  CHUNK_SIZE,
  parseLinesInChunks,
  planRefreshSync,
  saveSourceDomainsInChunks,
} = require("../db/blocklistChunks.ts");

function openDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE source_cache (
      source_id TEXT PRIMARY KEY,
      etag TEXT DEFAULT '',
      last_modified TEXT DEFAULT '',
      content_hash TEXT DEFAULT ''
    );
    CREATE TABLE cached_domains (
      source_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      domain TEXT NOT NULL
    );
  `);
  const log = { begins: 0, inTxn: false, failInsertAt: -1, inserts: 0 };
  const db = {
    execSync(sql) {
      sqlite.exec(sql);
      if (sql.startsWith("BEGIN")) {
        log.begins += 1;
        log.inTxn = true;
      } else {
        log.inTxn = false;
      }
    },
    runSync(sql, params) {
      if (sql.startsWith("INSERT INTO cached_domains")) {
        if (log.inserts === log.failInsertAt) throw new Error("killed");
        log.inserts += 1;
      }
      sqlite.prepare(sql).run(...params);
    },
  };
  const rows = (source) =>
    sqlite
      .prepare("SELECT COUNT(*) AS c FROM cached_domains WHERE source_id = ?")
      .get(source).c;
  const cacheRow = (source) =>
    sqlite.prepare("SELECT * FROM source_cache WHERE source_id = ?").get(source);
  return { db, log, rows, cacheRow };
}

const domains = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i}.com`);

(async () => {
  // A list spanning three chunks: one transaction each, every row written,
  // the cache row present, and the event loop turned between transactions
  // with none left open across the turn.
  {
    const { db, log, rows, cacheRow } = openDb();
    const total = CHUNK_SIZE * 2 + 1;
    const turns = [];
    const watch = () => {
      turns.push(log.inTxn);
      if (turns.length < 10) setTimeout(watch, 0);
    };
    setTimeout(watch, 0);
    await saveSourceDomainsInChunks(db, "s", "adult", "e1", "lm", "h1", domains(total, "a"));
    assert.strictEqual(log.begins, 3, "one transaction per chunk");
    assert.ok(turns.length >= 2, "the UI got a turn between chunks");
    assert.ok(turns.every((open) => !open), "no transaction held across a yield");
    assert.strictEqual(rows("s"), total);
    assert.strictEqual(cacheRow("s").content_hash, "h1");
  }

  // A re-save replaces the source's rows and leaves other sources alone.
  {
    const { db, rows, cacheRow } = openDb();
    await saveSourceDomainsInChunks(db, "s", "adult", "e1", "", "h1", domains(500, "old"));
    await saveSourceDomainsInChunks(db, "t", "adult", "", "", "ht", domains(10, "t"));
    await saveSourceDomainsInChunks(db, "s", "adult", "e2", "", "h2", domains(300, "new"));
    assert.strictEqual(rows("s"), 300);
    assert.strictEqual(rows("t"), 10);
    assert.strictEqual(cacheRow("s").etag, "e2");
  }

  // Killed in the second chunk: the failed chunk rolls back, and the source
  // has no cache row left, so the next refresh cannot answer 304 against the
  // partial rows.
  {
    const { db, log, rows, cacheRow } = openDb();
    await saveSourceDomainsInChunks(db, "s", "adult", "e1", "", "h1", domains(100, "old"));
    log.inserts = 0;
    log.failInsertAt = Math.ceil(CHUNK_SIZE / 300) + 1;
    await assert.rejects(
      saveSourceDomainsInChunks(db, "s", "adult", "e2", "", "h2", domains(CHUNK_SIZE * 2, "n")),
      /killed/,
    );
    assert.strictEqual(cacheRow("s"), undefined, "cache row dropped with the old rows");
    assert.strictEqual(rows("s"), CHUNK_SIZE, "only the committed first chunk remains");
    assert.strictEqual(log.inTxn, false, "rolled back, nothing left open");
  }

  // An empty list still clears the source and records its cache row.
  {
    const { db, log, rows, cacheRow } = openDb();
    await saveSourceDomainsInChunks(db, "s", "adult", "", "", "h0", []);
    assert.strictEqual(log.begins, 1);
    assert.strictEqual(rows("s"), 0);
    assert.strictEqual(cacheRow("s").content_hash, "h0");
  }

  // Parsing keeps every line across chunk boundaries and yields between them.
  {
    const lines = CHUNK_SIZE * 2 + 5;
    const content = Array.from({ length: lines }, (_, i) => (i % 2 ? `d${i}.com` : "# c")).join("\n");
    let turned = false;
    setTimeout(() => {
      turned = true;
    }, 0);
    const parsed = await parseLinesInChunks(content, (l) => (l.startsWith("#") ? null : l));
    assert.ok(turned, "parsing yielded to the event loop");
    assert.strictEqual(parsed.length, Math.floor(lines / 2));
    assert.strictEqual(parsed[parsed.length - 1], `d${lines - 2}.com`);
  }

  // After the saves: a category with a half-written source is not pushed,
  // and any save failure or half-written source leaves the refresh unrecorded
  // so the next launch refetches.
  {
    const clean = planRefreshSync(new Set(["adult", "ads"]), new Set(), false);
    assert.deepStrictEqual([...clean.push].sort(), ["ads", "adult"]);
    assert.strictEqual(clean.markUpdated, true);

    const partial = planRefreshSync(new Set(["adult", "ads"]), new Set(["adult"]), true);
    assert.deepStrictEqual([...partial.push], ["ads"], "the half-written category stays out");
    assert.strictEqual(partial.markUpdated, false);

    const firstChunkFailed = planRefreshSync(new Set(), new Set(), true);
    assert.strictEqual(firstChunkFailed.markUpdated, false, "a rolled-back save still retries");

    const leftover = planRefreshSync(new Set(), new Set(["hentai"]), false);
    assert.strictEqual(leftover.markUpdated, false, "an earlier killed save still retries");
  }

  console.log("blocklistChunks: all checks passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
