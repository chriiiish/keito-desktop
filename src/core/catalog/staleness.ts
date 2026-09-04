/** What is currently held, and what is being asked for. */
export interface CatalogFreshness {
  /** Reload regardless — an explicit refresh. */
  force?: boolean;
  /** How many pairs are cached. Zero means there is nothing to keep. */
  cached: number;
  loadedAtMs: number;
  /** The workspace the cached catalog was loaded for, or null if none has been. */
  loadedForAccountId: string | null;
  /** The workspace now connected, or null when it is not known. */
  accountId: string | null;
  nowMs: number;
  ttlMs: number;
}

/**
 * Whether the project and task catalog has to be fetched again.
 *
 * **The workspace is part of the question, not just the age.** Projects and tasks belong to
 * one Keito company, and connecting to a different one inside the cache's lifetime used to
 * leave the previous company's catalog in place: it was neither stale nor empty, so nothing
 * reloaded it. You would then pick a category from a workspace you were no longer in, and
 * the running entry would be matched against a catalog that could not contain it.
 *
 * A null `accountId` also reloads. Not knowing which workspace you are in is not a reason
 * to keep showing the last one.
 *
 * Pure, so the rule can be exercised on its own: every combination of age, emptiness and
 * workspace, including the boundary at exactly the TTL. `electron/service.test.ts` covers
 * the same bug end to end, through the caching this feeds; the two are complementary
 * rather than duplicates — one pins the rule, the other proves it is wired to anything.
 */
export function shouldReloadCatalog(freshness: CatalogFreshness): boolean {
  if (freshness.force) return true;
  if (freshness.cached === 0) return true;
  if (freshness.accountId === null) return true;
  if (freshness.loadedForAccountId !== freshness.accountId) return true;
  return freshness.nowMs - freshness.loadedAtMs > freshness.ttlMs;
}
