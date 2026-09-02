import { describe, expect, it } from "vitest";
import { FakeKeito } from "../../../test/fake-keito.js";
import { KeitoClient } from "../keito/client.js";
import { loadWorkspace, TASK_FETCH_CONCURRENCY } from "./workspace.js";

const NOW = new Date("2026-09-02T09:30:00Z");

const keitoWith = () =>
  new FakeKeito({
    now: () => NOW,
    projects: [
      { id: "p_acme", name: "Acme Rebuild", client_name: "Acme" },
      { id: "p_bank", name: "Bank Portal" },
    ],
    tasksByProject: {
      p_acme: [{ id: "t_dev", name: "Development" }],
      p_bank: [{ id: "t_dev", name: "Development" }],
    },
  });

describe("loadWorkspace", () => {
  it("assembles the catalog from projects and their assigned tasks", async () => {
    const keito = keitoWith();
    const client = new KeitoClient({ apiKey: "kto_k", accountId: "co_9", fetch: keito.fetch });

    const { catalog } = await loadWorkspace(client, NOW);

    expect(catalog.map((p) => p.id)).toEqual(["p_acme:t_dev", "p_bank:t_dev"]);
  });

  it("derives recents from the entries already logged in Keito, not from local history", async () => {
    const keito = keitoWith();
    keito.seedRunning({ project_id: "p_bank", task_id: "t_dev", spent_date: "2026-09-01" });
    keito.seedRunning({ project_id: "p_bank", task_id: "t_dev", spent_date: "2026-09-01" });
    keito.seedRunning({ project_id: "p_acme", task_id: "t_dev", spent_date: "2026-08-25" });
    const client = new KeitoClient({ apiKey: "kto_k", accountId: "co_9", fetch: keito.fetch });

    const { recents } = await loadWorkspace(client, NOW);

    expect(recents).toEqual(["p_bank:t_dev", "p_acme:t_dev"]);
  });

  it("asks Keito only for the last 30 days of entries", async () => {
    const keito = keitoWith();
    const client = new KeitoClient({ apiKey: "kto_k", accountId: "co_9", fetch: keito.fetch });

    await loadWorkspace(client, NOW);

    const listed = keito.requests.find((r) => r.path === "/time_entries")!;
    expect(listed.body).toBeUndefined();
    expect(keito.requests.some((r) => r.path === "/projects")).toBe(true);
  });

  it("picks out today's entries from the same fetch the ranking uses", async () => {
    const keito = keitoWith();
    keito.seedRunning({ project_id: "p_acme", task_id: "t_dev", spent_date: "2026-09-02" });
    keito.seedRunning({ project_id: "p_bank", task_id: "t_dev", spent_date: "2026-08-30" });
    const client = new KeitoClient({ apiKey: "kto_k", accountId: "co_9", fetch: keito.fetch });

    const { today } = await loadWorkspace(client, NOW);

    expect(today.map((entry) => entry.project_id)).toEqual(["p_acme"]);
  });

  it("retries a project whose tasks are temporarily at capacity", async () => {
    const keito = keitoWith();
    keito.taskFailures.set("p_bank", 2);
    const client = new KeitoClient({
      apiKey: "kto_k",
      accountId: "co_9",
      fetch: keito.fetch,
      retryDelayMs: 0,
    });

    const { catalog } = await loadWorkspace(client, NOW);

    expect(catalog.map((pair) => pair.id)).toEqual(["p_acme:t_dev", "p_bank:t_dev"]);
  });

  it("keeps the rest of the catalog when one project will not load at all", async () => {
    const keito = keitoWith();
    keito.taskFailures.set("p_bank", 99);
    const client = new KeitoClient({
      apiKey: "kto_k",
      accountId: "co_9",
      fetch: keito.fetch,
      retryDelayMs: 0,
    });

    const { catalog } = await loadWorkspace(client, NOW);

    // Losing one project beats failing to start at all.
    expect(catalog.map((pair) => pair.id)).toEqual(["p_acme:t_dev"]);
  });

  it("does not stampede the API with one request per project at once", async () => {
    const projects = Array.from({ length: 20 }, (_, i) => ({ id: `p_${i}`, name: `Project ${i}` }));
    const tasksByProject = Object.fromEntries(
      projects.map((project) => [project.id, [{ id: "t_dev", name: "Development" }]]),
    );
    const keito = new FakeKeito({ now: () => NOW, projects, tasksByProject });
    const client = new KeitoClient({ apiKey: "kto_k", accountId: "co_9", fetch: keito.fetch });

    await loadWorkspace(client, NOW);

    expect(keito.maxConcurrent).toBeLessThanOrEqual(TASK_FETCH_CONCURRENCY);
  });
});
