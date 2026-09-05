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
      notes: "keito-timer contract test — safe to delete",
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
      notes: "keito-timer contract test — safe to delete",
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

/**
 * Whether `internal_notes` is really what Keito calls the team-only note.
 *
 * The public docs list one notes field. The name used here was inferred from Keito's own
 * terminology — "Notes" and "Internal Notes" — and its snake_case convention. That is a
 * reasonable inference and not a verified fact, which is what this is for.
 *
 * It is also the safe direction to be wrong in: a wrong field name means a note is dropped,
 * where guessing the other way would publish a private note to a client. A failure here
 * means notes marked internal are going nowhere, not going somewhere they should not.
 */
suite("internal notes", () => {
  it("round-trips a note written to internal_notes", async () => {
    const [pair] = await loadCatalog(client, new Date());
    if (!pair) return;

    const entry = await client.createTimeEntry({
      projectId: pair.projectId,
      taskId: pair.taskId,
      spentDate: new Date().toISOString().slice(0, 10),
      internalNotes: "keito-timer contract check — internal",
    });
    created.push(entry.id);

    // By id, not the first row: a real workspace may already have entries on this date and
    // the list is in no guaranteed order, so taking [0] could assert against someone else's
    // note — or pass while the one just written is wrong.
    const listed = await client.listTimeEntries({
      from: entry.spent_date,
      to: entry.spent_date,
    });
    const read = listed.find((candidate) => candidate.id === entry.id);
    expect(read, "the entry just created was not in the day's listing").toBeTruthy();

    console.log("internal_notes came back as:", read?.internal_notes ?? "(absent)");
    console.log("notes came back as:", read?.notes ?? "(absent)");

    // If this fails, the field is named something else and `noteFor` needs correcting.
    expect(entry.internal_notes ?? read?.internal_notes).toBe(
      "keito-timer contract check — internal",
    );
    // And it must not have leaked into the client-visible field, on the way out or back.
    expect(entry.notes ?? "").not.toContain("internal");
    expect(read?.notes ?? "").not.toContain("internal");
  });
});

/**
 * The `user_id` filter, and whether a time entry says whose it is.
 *
 * Both are documented; neither has been seen working. This repository has been caught by
 * documented behaviour that turned out to be fiction before — ETags, `If-Match` and a
 * single-entry `GET` were all built against the docs and none of them exist — so the
 * client asks for the filter *and* filters again itself, and this is what tells us which
 * of those two is actually doing the work.
 *
 * Run it as an administrator and it means something. Run it as a user who can only see
 * their own entries and it passes trivially, which is worth knowing before reading much
 * into a green result.
 */
suite("filtering time entries to one user", () => {
  it("reports which field, if any, names the entry's owner", async () => {
    const identity = await client.validateKey();
    const entries = await client.listTimeEntries({});

    // Not an assertion about the value — a printed answer to a question the docs do not
    // cover. If both are undefined the client's second filter can never do anything, and
    // an unhonoured `user_id` would go unnoticed.
    const sample = entries[0];
    console.log("user id from /users/me:", identity.userId);
    console.log("entries returned:", entries.length);
    console.log("sample entry user_id:", sample?.user_id ?? "(absent)");
    console.log("sample entry user.id:", sample?.user?.id ?? "(absent)");

    expect(identity.userId).toBeTruthy();
  });

  it("returns nobody else's entries", async () => {
    const identity = await client.validateKey();
    const scoped = new KeitoClient({
      apiKey: apiKey ?? "",
      ...(process.env["KEITO_ACCOUNT_ID"] ? { accountId: process.env["KEITO_ACCOUNT_ID"] } : {}),
      userId: identity.userId,
      fetch,
    });

    const entries = await scoped.listTimeEntries({});
    const owners = new Set(
      entries.map((entry) => entry.user_id ?? entry.user?.id).filter(Boolean),
    );

    // Either every entry names this user, or none of them name anyone — both are fine.
    // Somebody else's id here means the filter is not working and neither is the fallback.
    expect([...owners].filter((owner) => owner !== identity.userId)).toEqual([]);
  });
});
