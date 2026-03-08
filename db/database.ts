import * as SQLite from "expo-sqlite";

// Create or open the database.
// To use synchronous database calls (which are often easier for simple React Native state),
// expo-sqlite ^14 provides openDatabaseSync.
const db = SQLite.openDatabaseSync("freedom.db");

/**
 * Initialize all necessary tables for the app.
 */
export function initDB(): void {
  db.execSync(`
    -- We are removing WAL mode because it can sometimes leave uncheckpointed
    -- writes in the -wal file if the app is force closed in dev mode.
    PRAGMA journal_mode = DELETE;

    -- Table for tracking daily blocking statistics
    CREATE TABLE IF NOT EXISTS stats (
      date TEXT PRIMARY KEY,
      blocked_count INTEGER DEFAULT 0
    );

    -- Table for keeping a history of individually blocked URLs
    CREATE TABLE IF NOT EXISTS blocked_urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Table for simple key-value persistence (e.g. Zustand stores)
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
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
  setItem: (name: string, value: string): void => {
    // console.log(`[sqliteStorage] setItem called for ${name}. Value length: ${value.length}`);
    try {
      db.runSync(
        `INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
        name,
        value,
      );
      // console.log(`[sqliteStorage] setItem SUCCESS for ${name}`);
    } catch (err) {
      console.error(`[sqliteStorage] setItem ERROR for ${name}:`, err);
    }
  },
  removeItem: (name: string): void => {
    try {
      db.runSync(`DELETE FROM kv_store WHERE key = ?;`, [name]);
    } catch (err) {
      console.error("[sqliteStorage] Failed to remove", name, err);
    }
  },
};

/**
 * Increment the blocked count for the current day.
 */
export function incrementDailyBlockedCount(): void {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  db.runSync(
    `INSERT INTO stats (date, blocked_count) VALUES (?, 1)
     ON CONFLICT(date) DO UPDATE SET blocked_count = blocked_count + 1;`,
    today,
  );
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

/**
 * Record a specifically blocked URL.
 */
export function logBlockedUrl(url: string, timestamp?: number): void {
  // If timestamp is provided, convert to ISO string. Otherwise DB uses CURRENT_TIMESTAMP.
  if (timestamp) {
    const isoString = new Date(timestamp).toISOString();
    db.runSync(
      `INSERT INTO blocked_urls (url, timestamp) VALUES (?, ?);`,
      url,
      isoString,
    );
  } else {
    db.runSync(`INSERT INTO blocked_urls (url) VALUES (?);`, url);
  }
}
