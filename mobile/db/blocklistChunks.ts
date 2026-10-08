/** Lines per parse step and domains per transaction when caching a source. */
export const CHUNK_SIZE = 20000;

// 300 rows x 3 params stays under SQLite's 999-variable limit.
const INSERT_BATCH = 300;

export interface SyncDb {
  execSync(source: string): void;
  runSync(source: string, params: string[]): unknown;
}

export const yieldToUi = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Maps each line through parseLine, yielding to the UI every CHUNK_SIZE lines. */
export async function parseLinesInChunks(
  content: string,
  parseLine: (line: string) => string | null,
): Promise<string[]> {
  const lines = content.split("\n");
  const out: string[] = [];
  for (let start = 0; start < lines.length; start += CHUNK_SIZE) {
    if (start > 0) await yieldToUi();
    const end = Math.min(lines.length, start + CHUNK_SIZE);
    for (let i = start; i < end; i++) {
      const parsed = parseLine(lines[i]);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

/**
 * Replaces a source's cached domains, one transaction per CHUNK_SIZE domains
 * with a yield between them. The first transaction drops the source's cache
 * row along with its domains and only the last writes it back, so a refresh
 * killed in between leaves no ETag or hash to answer 304 against: the next
 * refresh refetches the source in full.
 */
export async function saveSourceDomainsInChunks(
  db: SyncDb,
  sourceId: string,
  categoryId: string,
  etag: string,
  lastModified: string,
  contentHash: string,
  domains: string[],
): Promise<void> {
  const chunks = Math.max(1, Math.ceil(domains.length / CHUNK_SIZE));
  for (let c = 0; c < chunks; c++) {
    if (c > 0) await yieldToUi();
    db.execSync("BEGIN TRANSACTION");
    try {
      if (c === 0) {
        db.runSync("DELETE FROM source_cache WHERE source_id = ?", [sourceId]);
        db.runSync("DELETE FROM cached_domains WHERE source_id = ?", [
          sourceId,
        ]);
      }

      const end = Math.min(domains.length, (c + 1) * CHUNK_SIZE);
      for (let i = c * CHUNK_SIZE; i < end; i += INSERT_BATCH) {
        const slice = domains.slice(i, Math.min(end, i + INSERT_BATCH));
        const params: string[] = [];
        for (const d of slice) {
          params.push(sourceId, categoryId, d);
        }
        db.runSync(
          `INSERT INTO cached_domains (source_id, category_id, domain) VALUES ${slice.map(() => "(?,?,?)").join(",")}`,
          params,
        );
      }

      if (c === chunks - 1) {
        db.runSync(
          `INSERT INTO source_cache (source_id, etag, last_modified, content_hash)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(source_id) DO UPDATE SET
             etag = excluded.etag,
             last_modified = excluded.last_modified,
             content_hash = excluded.content_hash`,
          [sourceId, etag, lastModified, contentHash],
        );
      }

      db.execSync("COMMIT");
    } catch (e) {
      db.execSync("ROLLBACK");
      throw e;
    }
  }
}

/**
 * What a refresh does after saving its sources. A category with a half-written
 * source (a save that failed after its first chunk committed, or an earlier
 * run killed mid-save) is not pushed over native's full copy, and the refresh
 * is not recorded as done, so the next launch refetches instead of waiting out
 * the update interval.
 */
export function planRefreshSync(
  dirty: ReadonlySet<string>,
  partial: ReadonlySet<string>,
  saveFailed: boolean,
): { push: Set<string>; markUpdated: boolean } {
  return {
    push: new Set([...dirty].filter((id) => !partial.has(id))),
    markUpdated: !saveFailed && partial.size === 0,
  };
}
