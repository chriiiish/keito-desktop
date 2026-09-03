import { describe, expect, it } from "vitest";
import { FakeKeito } from "../../../test/fake-keito.js";
import { KeitoClient } from "../keito/client.js";
import { loadCatalog, loadEntries } from "./workspace.js";

const NOW = new Date("2026-09-02T09:30:00Z");

const keitoWith = (options = {}) =>
  new FakeKeito({
    now: () => NOW,
    projects: [
      { id: "p_acme", name: "Acme Rebuild", client: { name: "Acme" } },
      { id: "p_bank", name: "Bank Portal" },
    ],
    tasksByProject: {
      p_acme: [{ id: "t_dev", name: "Development" }],
      p_bank: [{ id: "t_dev", name: "Development" }],
    },
    ...options,
  });

const clientFor = (keito: FakeKeito) =>
  new KeitoClient({ apiKey: "kto_k", accountId: "co_9", fetch: keito.fetch, retryDelayMs: 0 });

describe("loadCatalog", () => {
  it("builds the whole catalog from a single request", async () => {
    const keito = keitoWith();

    const catalog = await loadCatalog(clientFor(keito), NOW);

    expect(catalog.map((pair) => pair.id)).toEqual(["p_acme:t_dev", "p_bank:t_dev"]);
    expect(keito.requests).toHaveLength(1);
    expect(keito.requests[0]!.path).toBe("/projects");
  });

  it("never asks for tasks per project, since projects already carry them", async () => {
    const keito = keitoWith();

    await loadCatalog(clientFor(keito), NOW);

    expect(keito.requests.some((request) => request.path === "/tasks")).toBe(false);
  });

  it("follows pagination rather than silently losing projects", async () => {
    const projects = Array.from({ length: 12 }, (_, i) => ({
      id: `p_${i}`,
      name: `Project ${String(i).padStart(2, "0")}`,
      tasks: [{ id: "t_dev", name: "Development" }],
    }));
    const keito = new FakeKeito({ now: () => NOW, projects, pageSize: 5 });

    const catalog = await loadCatalog(clientFor(keito), NOW);

    expect(catalog).toHaveLength(12);
  });
});

describe("loadEntries", () => {
  it("gets recents, today and the running timer from one request", async () => {
    const keito = keitoWith();
    keito.seedRunning({ project_id: "p_acme", task_id: "t_dev", spent_date: "2026-09-02" });
    keito.entries.push({ ...keito.entries[0]!, id: "te_old", spent_date: "2026-08-20", is_running: false });

    const result = await loadEntries(clientFor(keito), NOW, "UTC");

    expect(keito.requests).toHaveLength(1);
    expect(result.recents).toEqual(["p_acme:t_dev"]);
    expect(result.today.map((entry) => entry.id)).toEqual(["te_1"]);
    expect(result.running?.id).toBe("te_1");
  });

  it("separates yesterday from today without a second request", async () => {
    const keito = keitoWith();
    keito.seedRunning({ project_id: "p_acme", task_id: "t_dev", spent_date: "2026-09-02" });
    keito.entries.push({
      ...keito.entries[0]!,
      id: "te_yesterday",
      spent_date: "2026-09-01",
      is_running: false,
    });
    keito.entries.push({
      ...keito.entries[0]!,
      id: "te_older",
      spent_date: "2026-08-31",
      is_running: false,
    });

    const result = await loadEntries(clientFor(keito), NOW, "UTC");

    expect(keito.requests).toHaveLength(1);
    expect(result.today.map((entry) => entry.id)).toEqual(["te_1"]);
    expect(result.yesterday.map((entry) => entry.id)).toEqual(["te_yesterday"]);
  });

  it("moves the yesterday boundary with the workspace calendar, not a UTC clock", async () => {
    const keito = keitoWith();
    keito.entries.push({
      ...keito.entries[0]!,
      id: "te_1st",
      spent_date: "2026-09-01",
      is_running: false,
    });

    // 22:00 UTC on the 1st is already the 2nd in Sydney, so the 1st is yesterday there —
    // while Los Angeles is still on the 1st, making it today.
    const early = new Date("2026-09-01T22:00:00Z");

    const sydney = await loadEntries(clientFor(keito), early, "Australia/Sydney");
    expect(sydney.yesterday.map((entry) => entry.id)).toContain("te_1st");
    expect(sydney.today.map((entry) => entry.id)).not.toContain("te_1st");

    const la = await loadEntries(clientFor(keito), early, "America/Los_Angeles");
    expect(la.today.map((entry) => entry.id)).toContain("te_1st");
    expect(la.yesterday.map((entry) => entry.id)).not.toContain("te_1st");
  });

  it("reads today from the workspace's calendar, not UTC's", async () => {
    // 21:30 in Sydney on the 2nd is still 11:30 UTC on the 2nd — but at 09:30 UTC it is
    // already the evening of the 2nd there, while Los Angeles is on the 1st.
    const keito = keitoWith();
    keito.entries.push({
      id: "te_sydney",
      project_id: "p_acme",
      task_id: "t_dev",
      spent_date: "2026-09-02",
      started_time: "09:00",
      ended_time: "10:00",
      timer_started_at: null,
      hours: 1,
      is_running: false,
      notes: null,
      source: null,
    });

    const early = new Date("2026-09-01T22:00:00Z");
    expect(
      (await loadEntries(clientFor(keito), early, "Australia/Sydney")).today.map((e) => e.id),
    ).toEqual(["te_sydney"]);
    expect((await loadEntries(clientFor(keito), early, "America/Los_Angeles")).today).toEqual([]);
  });

  it("reports no running timer when none is going", async () => {
    const keito = keitoWith();

    const result = await loadEntries(clientFor(keito), NOW, "UTC");

    expect(result.running).toBeNull();
  });

  it("pages through a busy month rather than ranking on the first page alone", async () => {
    const keito = keitoWith({ pageSize: 10 });
    for (let i = 0; i < 25; i++) {
      keito.entries.push({
        id: `te_${i}`,
        project_id: i < 20 ? "p_bank" : "p_acme",
        task_id: "t_dev",
        spent_date: "2026-08-25",
        started_time: "09:00",
        ended_time: "10:00",
        timer_started_at: null,
        hours: 1,
        is_running: false,
        notes: null,
        source: null,
      });
    }

    const result = await loadEntries(clientFor(keito), NOW, "UTC");

    // p_bank has 20 uses to p_acme's 5; only paging past the first page can see that.
    expect(result.recents[0]).toBe("p_bank:t_dev");
  });
});

describe("loadEntries ordering", () => {
  it("really does return today newest first, as it says", async () => {
    // The fake pushes as it creates and the real API promises nothing, so this was
    // documented but never true. Anything reading `today[0]` as "the most recent thing"
    // was reading the oldest.
    const keito = keitoWith();
    keito.entries.push(
      {
        id: "te_morning",
        project_id: "p_acme",
        task_id: "t_dev",
        spent_date: "2026-09-02",
        started_time: "09:00",
        ended_time: "09:30",
        timer_started_at: "2026-09-02T09:00:00Z",
        hours: 0.5,
        is_running: false,
        notes: null,
        source: null,
      },
      {
        id: "te_afternoon",
        project_id: "p_acme",
        task_id: "t_dev",
        spent_date: "2026-09-02",
        started_time: "14:00",
        ended_time: "14:30",
        timer_started_at: "2026-09-02T14:00:00Z",
        hours: 0.5,
        is_running: false,
        notes: null,
        source: null,
      },
    );

    const result = await loadEntries(clientFor(keito), NOW, "UTC");

    expect(result.today.map((entry) => entry.id)).toEqual(["te_afternoon", "te_morning"]);
  });

  it("orders yesterday the same way", async () => {
    const keito = keitoWith();
    const base = {
      project_id: "p_acme",
      task_id: "t_dev",
      spent_date: "2026-09-01",
      ended_time: "09:30",
      hours: 0.5,
      is_running: false,
      notes: null,
      source: null,
    };
    keito.entries.push(
      { ...base, id: "te_early", started_time: "09:00", timer_started_at: "2026-09-01T09:00:00Z" },
      { ...base, id: "te_late", started_time: "16:00", timer_started_at: "2026-09-01T16:00:00Z" },
    );

    const result = await loadEntries(clientFor(keito), NOW, "UTC");

    expect(result.yesterday.map((entry) => entry.id)).toEqual(["te_late", "te_early"]);
  });
});
