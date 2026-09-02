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

    const result = await loadEntries(clientFor(keito), NOW);

    expect(keito.requests).toHaveLength(1);
    expect(result.recents).toEqual(["p_acme:t_dev"]);
    expect(result.today.map((entry) => entry.id)).toEqual(["te_1"]);
    expect(result.running?.id).toBe("te_1");
  });

  it("reports no running timer when none is going", async () => {
    const keito = keitoWith();

    const result = await loadEntries(clientFor(keito), NOW);

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

    const result = await loadEntries(clientFor(keito), NOW);

    // p_bank has 20 uses to p_acme's 5; only paging past the first page can see that.
    expect(result.recents[0]).toBe("p_bank:t_dev");
  });
});
