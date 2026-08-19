import * as SQLite from "expo-sqlite";
import { flushPending, incrementPending } from "./blockedCountAccumulator";
import { isUnchanged, recordWritten } from "./dedupeWrite";

// Create or open the database.
// To use synchronous database calls (which are often easier for simple React Native state),
// expo-sqlite ^14 provides openDatabaseSync.
const db = SQLite.openDatabaseSync("freedom.db");

/**
 * Initialize all necessary tables for the app.
 */
export function initDB(): void {
  db.execSync(`
    -- WAL mode; checkpointed via wal_checkpoint(TRUNCATE) on AppState background.
    PRAGMA journal_mode = WAL;

    -- Table for tracking daily blocking statistics
    CREATE TABLE IF NOT EXISTS stats (
      date TEXT PRIMARY KEY,
      blocked_count INTEGER DEFAULT 0
    );

    -- Drop the removed blocked_urls table. Its pages go to the free list for
    -- reuse; the file only shrinks on VACUUM.
    DROP TABLE IF EXISTS blocked_urls;

    -- Table for simple key-value persistence (e.g. Zustand stores)
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Blocklist source cache: stores HTTP conditional-request headers
    CREATE TABLE IF NOT EXISTS source_cache (
      source_id TEXT PRIMARY KEY,
      etag TEXT DEFAULT '',
      last_modified TEXT DEFAULT '',
      content_hash TEXT DEFAULT ''
    );

    -- Cached parsed domains per source for fast re-sync
    CREATE TABLE IF NOT EXISTS cached_domains (
      source_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      domain TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cached_domains_source
      ON cached_domains(source_id);
    CREATE INDEX IF NOT EXISTS idx_cached_domains_category
      ON cached_domains(category_id);
    CREATE INDEX IF NOT EXISTS idx_cached_domains_cat_domain
      ON cached_domains(category_id, domain);
  `);
}

/** Checkpoints the WAL file back into the main db file. Call on AppState background. */
export function checkpointWal(): void {
  db.execSync("PRAGMA wal_checkpoint(TRUNCATE);");
}

// Ensure the tables are created immediately upon module load
// so that synchronous storage adapters (like Zustand) don't fail.
initDB();

/**
 * Zustand compatible synchronous storage engine backed by SQLite
 */
export const sqliteStorage = {
  getItem: (name: string): string | null => {
    try {
      const result = db.getFirstSync<{ value: string }>(
        `SELECT value FROM kv_store WHERE key = ?;`,
        [name],
      );
      // console.log(`[sqliteStorage] getItem: ${name} ->`, result ? "FOUND" : "NOT FOUND");
      return result?.value || null;
    } catch (err) {
      console.error(`[sqliteStorage] getItem ERROR for ${name}:`, err);
      return null;
    }
  },
  setItem: (name: string, value: string): boolean => {
    // console.log(`[sqliteStorage] setItem called for ${name}. Value length: ${value.length}`);
    try {
      db.runSync(
        `INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
        name,
        value,
      );
      // console.log(`[sqliteStorage] setItem SUCCESS for ${name}`);
      return true;
    } catch (err) {
      console.error(`[sqliteStorage] setItem ERROR for ${name}:`, err);
      return false;
    }
  },
  removeItem: (name: string): boolean => {
    try {
      db.runSync(`DELETE FROM kv_store WHERE key = ?;`, [name]);
      return true;
    } catch (err) {
      console.error("[sqliteStorage] Failed to remove", name, err);
      return false;
    }
  },
};

/** Storage adapter for useAppStore: skips a write unchanged since the last confirmed one. */
export const dedupingAppStoreStorage = {
  getItem: sqliteStorage.getItem,
  setItem: (name: string, value: string): void => {
    if (isUnchanged(value)) return;
    if (sqliteStorage.setItem(name, value)) recordWritten(value);
  },
  removeItem: sqliteStorage.removeItem,
};

/**
 * Commits the pending blocked count to the stats table. Call on the flush
 * interval and on AppState background/inactive.
 */
export function flushBlockedStats(): void {
  flushPending((count) => {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    db.runSync(
      `INSERT INTO stats (date, blocked_count) VALUES (?, ?)
       ON CONFLICT(date) DO UPDATE SET blocked_count = blocked_count + ?;`,
      today,
      count,
      count,
    );
  });
}

// Force-flushes so a long backgrounded session (where the interval below
// doesn't run — RN's Android timer pauses on host pause) can't lose more
// than this many counts if the process is reclaimed before the next
// AppState transition.
const FLUSH_THRESHOLD = 20;

export function accumulateBlockedCount(): void {
  if (incrementPending() >= FLUSH_THRESHOLD) flushBlockedStats();
}

/**
 * Get the total number of blocks across all days.
 */
export function getTotalBlockedCount(): number {
  const result = db.getFirstSync<{ total: number }>(
    `SELECT SUM(blocked_count) as total FROM stats;`,
  );
  return result?.total || 0;
}

/**
 * Get the number of blocks for today specifically.
 */
export function getTodayBlockedCount(): number {
  const today = new Date().toISOString().split("T")[0];
  const result = db.getFirstSync<{ blocked_count: number }>(
    `SELECT blocked_count FROM stats WHERE date = ?;`,
    today,
  );
  return result?.blocked_count || 0;
}

// ---------------------------------------------------------------------------
// Blocklist auto-update
// ---------------------------------------------------------------------------

const LAST_UPDATE_KEY = "blocklist_last_update";

export function getLastBlocklistUpdate(): number {
  const row = db.getFirstSync<{ value: string }>(
    "SELECT value FROM kv_store WHERE key = ?",
    LAST_UPDATE_KEY,
  );
  return row ? parseInt(row.value, 10) : 0;
}

export function setLastBlocklistUpdate(): void {
  db.runSync(
    `INSERT INTO kv_store (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    LAST_UPDATE_KEY,
    String(Date.now()),
  );
}

// ---------------------------------------------------------------------------
// Blocklist source cache
// ---------------------------------------------------------------------------

export function getSourceCache(
  sourceId: string,
): { etag: string; lastModified: string; contentHash: string } | null {
  const row = db.getFirstSync<{
    etag: string;
    last_modified: string;
    content_hash: string;
  }>(
    `SELECT etag, last_modified, content_hash FROM source_cache WHERE source_id = ?`,
    sourceId,
  );
  if (!row) return null;
  return {
    etag: row.etag,
    lastModified: row.last_modified,
    contentHash: row.content_hash,
  };
}

/**
 * Fast content fingerprint: samples head + tail + length.
 * Not cryptographic — just for detecting blocklist changes.
 */
export function contentFingerprint(content: string): string {
  const len = content.length;
  const sample = content.slice(0, 8000) + content.slice(-8000) + String(len);
  let h = 5381;
  for (let i = 0; i < sample.length; i++) {
    h = ((h << 5) + h + sample.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/**
 * Replace cached domains for a source and update its HTTP cache headers.
 * Uses batch INSERT for speed (~300 rows per statement to stay under
 * SQLite's 999-variable limit).
 */
export function saveSourceDomains(
  sourceId: string,
  categoryId: string,
  etag: string,
  lastModified: string,
  contentHash: string,
  domains: string[],
): void {
  db.execSync("BEGIN TRANSACTION");
  try {
    db.runSync("DELETE FROM cached_domains WHERE source_id = ?", sourceId);

    const BATCH = 300;
    for (let i = 0; i < domains.length; i += BATCH) {
      const slice = domains.slice(i, i + BATCH);
      const placeholders = slice.map(() => "(?,?,?)").join(",");
      const params: string[] = [];
      for (const d of slice) {
        params.push(sourceId, categoryId, d);
      }
      db.runSync(
        `INSERT INTO cached_domains (source_id, category_id, domain) VALUES ${placeholders}`,
        params,
      );
    }

    db.runSync(
      `INSERT INTO source_cache (source_id, etag, last_modified, content_hash)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(source_id) DO UPDATE SET
         etag = excluded.etag,
         last_modified = excluded.last_modified,
         content_hash = excluded.content_hash`,
      sourceId,
      etag,
      lastModified,
      contentHash,
    );

    db.execSync("COMMIT");
  } catch (e) {
    db.execSync("ROLLBACK");
    throw e;
  }
}

/**
 * Read a batch of unique cached domains for a category (paginated).
 * DISTINCT deduplicates domains that appear in multiple sources.
 */
export function readCachedDomainsBatch(
  categoryId: string,
  limit: number,
  offset: number,
): string[] {
  const rows = db.getAllSync<{ domain: string }>(
    "SELECT DISTINCT domain FROM cached_domains WHERE category_id = ? LIMIT ? OFFSET ?",
    categoryId,
    limit,
    offset,
  );
  return rows.map((r) => r.domain);
}

/**
 * Total unique cached domain count for a category.
 */
export function getCachedDomainCount(categoryId: string): number {
  const row = db.getFirstSync<{ c: number }>(
    "SELECT COUNT(DISTINCT domain) as c FROM cached_domains WHERE category_id = ?",
    categoryId,
  );
  return row?.c ?? 0;
}

/**
 * Remove cached domains for sources no longer in the enabled list.
 */
export function pruneDisabledSources(enabledSourceIds: string[]): void {
  if (enabledSourceIds.length === 0) {
    db.execSync("DELETE FROM cached_domains");
    db.execSync("DELETE FROM source_cache");
    return;
  }
  const placeholders = enabledSourceIds.map(() => "?").join(",");
  db.runSync(
    `DELETE FROM cached_domains WHERE source_id NOT IN (${placeholders})`,
    enabledSourceIds,
  );
  db.runSync(
    `DELETE FROM source_cache WHERE source_id NOT IN (${placeholders})`,
    enabledSourceIds,
  );
}
