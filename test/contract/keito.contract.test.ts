/**
 * Runs against a REAL Keito workspace. Opt-in: skipped unless KEITO_API_KEY is set.
 *
 *   KEITO_API_KEY=kto_xxx npm run test:contract
 *
 * This is the guard against test/fake-keito.ts drifting from the actual API. It creates
 * exactly one scratch entry and deletes it again, and never touches anything else.
 */
import { afterAll, describe, expect, it } from "vitest";
import { KeitoClient } from "../../src/core/keito/client.js";
import { loadWorkspace } from "../../src/core/catalog/workspace.js";

const apiKey = process.env["KEITO_API_KEY"];
const suite = apiKey ? describe : describe.skip;

const client = new KeitoClient({
  apiKey: apiKey ?? "",
  ...(process.env["KEITO_ACCOUNT_ID"] ? { accountId: process.env["KEITO_ACCOUNT_ID"] } : {}),
  fetch,
});

/** Entries this run created, so they can be removed even if an assertion fails. */
const created: string[] = [];

afterAll(async () => {
  for (const id of created) {
    const { etag } = await client.getTimeEntry(id);
    await client.deleteTimeEntry(id, etag ?? "");
  }
});

suite("Keito API contract", () => {
  it("validates the key and reports the workspace", async () => {
    const identity = await client.validateKey();

    expect(identity.userId).toBeTruthy();
    expect(identity.accountId).toBeTruthy();
  });

  it("returns a catalog of (project, task) pairs", async () => {
    const { catalog } = await loadWorkspace(client, new Date());

    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog[0]).toMatchObject({
      projectId: expect.any(String),
      taskId: expect.any(String),
      projectName: expect.any(String),
      taskName: expect.any(String),
    });
  });

  it("starts a running timer with a server-set start time, then stops it", async () => {
    const { catalog } = await loadWorkspace(client, new Date());
    const pair = catalog[0]!;

    const { entry, etag } = await client.createTimeEntry({
      projectId: pair.projectId,
      taskId: pair.taskId,
      spentDate: new Date().toISOString().slice(0, 10),
      isRunning: true,
      replaceRunning: true,
      notes: "kieto-timer contract test — safe to delete",
    });
    created.push(entry.id);

    expect(entry.is_running).toBe(true);
    expect(entry.started_time).toMatch(/^\d{2}:\d{2}$/);
    // The API is documented to return an ETag; if this ever goes null, stop() breaks.
    expect(etag).not.toBeNull();

    const stopped = await client.stopTimeEntry(entry.id, etag!);
    expect(stopped.is_running).toBe(false);
  });
});
