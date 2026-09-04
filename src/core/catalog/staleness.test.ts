import { describe, expect, it } from "vitest";
import { shouldReloadCatalog } from "./staleness.js";

const TTL = 15 * 60_000;
const NOW = Date.parse("2026-09-04T10:00:00Z");

/** A catalog loaded a minute ago for Acme: fresh, populated, and the right workspace. */
const fresh = {
  force: false,
  cached: 12,
  loadedAtMs: NOW - 60_000,
  loadedForAccountId: "co_acme",
  accountId: "co_acme",
  nowMs: NOW,
  ttlMs: TTL,
};

describe("shouldReloadCatalog", () => {
  it("keeps a catalog that is fresh, populated and for this workspace", () => {
    expect(shouldReloadCatalog(fresh)).toBe(false);
  });

  it("reloads when the workspace has changed", () => {
    // The bug this exists for. Connecting to a different company inside the TTL kept the
    // previous company's projects and tasks: the catalog was neither stale nor empty, so
    // nothing reloaded it, and you picked from a workspace you were no longer in.
    expect(shouldReloadCatalog({ ...fresh, accountId: "co_other" })).toBe(true);
  });

  it("reloads when there is nothing cached", () => {
    expect(shouldReloadCatalog({ ...fresh, cached: 0 })).toBe(true);
  });

  it("reloads once the cache is older than its lifetime", () => {
    expect(shouldReloadCatalog({ ...fresh, loadedAtMs: NOW - TTL - 1 })).toBe(true);
  });

  it("does not reload a catalog exactly at its lifetime", () => {
    // Older *than* the TTL, not as old as it — otherwise the boundary reloads twice.
    expect(shouldReloadCatalog({ ...fresh, loadedAtMs: NOW - TTL })).toBe(false);
  });

  it("reloads on request, however fresh the cache is", () => {
    expect(shouldReloadCatalog({ ...fresh, force: true })).toBe(true);
  });

  it("reloads when nothing has been loaded for any workspace yet", () => {
    expect(
      shouldReloadCatalog({ ...fresh, cached: 0, loadedForAccountId: null, accountId: "co_acme" }),
    ).toBe(true);
  });

  it("reloads when the workspace becomes unknown", () => {
    // Signing out and back in with a key whose company cannot be read: better to fetch
    // than to keep showing a workspace nobody has confirmed you are still in.
    expect(shouldReloadCatalog({ ...fresh, accountId: null })).toBe(true);
  });

  it("does not treat a workspace change as satisfied by the TTL", () => {
    // Both wrong at once: the answer is still yes, and for the workspace reason.
    expect(
      shouldReloadCatalog({ ...fresh, accountId: "co_other", loadedAtMs: NOW - TTL - 1 }),
    ).toBe(true);
  });
});
