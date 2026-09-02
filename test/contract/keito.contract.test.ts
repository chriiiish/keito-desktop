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
import { loadCatalog, loadEntries } from "../../src/core/catalog/workspace.js";

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
  for (const id of created) await client.deleteTimeEntry(id);
});

suite("Keito API contract", () => {
  it("validates the key and reports the workspace", async () => {
    const identity = await client.validateKey();

    expect(identity.userId).toBeTruthy();
    expect(identity.accountId).toBeTruthy();
  });

  it("embeds each project's tasks, which is what makes one call enough", async () => {
    const projects = await client.listProjects();

    expect(projects.length).toBeGreaterThan(0);
    // If this ever stops being true, loadCatalog silently returns an empty catalog.
    expect(projects.some((project) => (project.tasks?.length ?? 0) > 0)).toBe(true);
  });

  it("includes the running entry in a plain list, so no is_running lookup is needed", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const entry = await client.createTimeEntry({
      projectId: (await client.listProjects())[0]!.id,
      taskId: (await client.listProjects())[0]!.tasks![0]!.id,
      spentDate: today,
      isRunning: true,
      replaceRunning: true,
      notes: "kieto-timer contract test — safe to delete",
    });
    created.push(entry.id);

    const { running } = await loadEntries(client, new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);

    expect(running?.id).toBe(entry.id);
    await client.stopTimeEntry(entry.id);
  });

  it("has no single-entry GET endpoint, so nothing may depend on one", async () => {
    const [existing] = await client.listTimeEntries({});
    if (!existing) return;

    const response = await fetch(`https://app.keito.ai/api/v2/time_entries/${existing.id}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Keito-Account-Id": process.env["KEITO_ACCOUNT_ID"] ?? "",
      },
    });

    expect(response.status).toBe(405);
  });

  it("returns a catalog of (project, task) pairs from a single projects call", async () => {
    const catalog = await loadCatalog(client, new Date());

    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog[0]).toMatchObject({
      projectId: expect.any(String),
      taskId: expect.any(String),
      projectName: expect.any(String),
      taskName: expect.any(String),
    });
  });

  it("starts a running timer with a server-set start time, then stops it", async () => {
    const catalog = await loadCatalog(client, new Date());
    const pair = catalog[0]!;

    const entry = await client.createTimeEntry({
      projectId: pair.projectId,
      taskId: pair.taskId,
      spentDate: new Date().toISOString().slice(0, 10),
      isRunning: true,
      replaceRunning: true,
      notes: "kieto-timer contract test — safe to delete",
    });
    created.push(entry.id);

    // The crash that motivated this assertion: the create response is NOT wrapped in
    // `time_entry`, so an unwrapping mistake here yields undefined, not a bad field.
    expect(entry?.id).toBeTruthy();
    expect(entry.is_running).toBe(true);
    expect(entry.started_time).toMatch(/^\d{2}:\d{2}$/);
    expect(entry.timer_started_at).toBeTruthy();

    const stopped = await client.stopTimeEntry(entry.id);
    expect(stopped.is_running).toBe(false);
  });
});
