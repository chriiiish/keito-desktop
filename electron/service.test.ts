import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAzure } from "../test/fake-azure.js";
import { FakeKeito, type FakeEntry } from "../test/fake-keito.js";
import { PreferencesStore } from "../src/core/store/preferences.js";
import { AppService } from "./service.js";
import type { Logger } from "./logger.js";
import type { SecretStore } from "./secrets.js";

/**
 * The one thing `AppService` is tested for.
 *
 * CLAUDE.md keeps the Electron layer verify-by-running, and that stands — but this bug
 * lives in the caching *inside* AppService and only appears across a change of company, so
 * there is nowhere else it could be caught. `AppService` imports nothing from Electron at
 * runtime (`SecretStore` and `Logger` are type-only), so it constructs here with stand-ins
 * and the global `fetch` pointed at the fake.
 */

const acme = () =>
  new FakeKeito({
    company: { id: "co_acme", name: "Acme" },
    projects: [{ id: "p_acme", name: "Acme Rebuild" }],
    tasksByProject: { p_acme: [{ id: "t_dev", name: "Development" }] },
  });

const other = () =>
  new FakeKeito({
    company: { id: "co_other", name: "Other Co" },
    projects: [{ id: "p_other", name: "Other Platform" }],
    tasksByProject: { p_other: [{ id: "t_ops", name: "Operations" }] },
  });

const silentLog = {
  path: "/dev/null",
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

/** Nothing durable: the key is irrelevant to what is being tested. */
const memorySecrets = (): SecretStore => {
  let stored: string | null = null;
  return {
    read: async () => stored,
    write: async (value: string) => {
      stored = value;
    },
    clear: async () => {
      stored = null;
    },
  } as unknown as SecretStore;
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "keito-service-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

const serviceFor = async (keito: FakeKeito) => {
  vi.stubGlobal("fetch", keito.fetch);
  const prefs = await PreferencesStore.open(join(dir, "preferences.json"));
  return AppService.create(prefs, memorySecrets(), silentLog, "1.0.0");
};

describe("connecting to a different company", () => {
  it("throws away the previous company's projects and tasks", async () => {
    // The bug: the catalog is cached for 15 minutes and reloaded only when stale, empty or
    // forced. Connecting to another company inside that window met none of those, so the
    // picker kept offering a workspace you were no longer in.
    const service = await serviceFor(acme());
    await service.setApiKey("kto_acme", "co_acme");
    expect(service.snapshot().catalog.map((pair) => pair.id)).toEqual(["p_acme:t_dev"]);

    vi.stubGlobal("fetch", other().fetch);
    await service.setApiKey("kto_other", "co_other");

    expect(service.snapshot().catalog.map((pair) => pair.id)).toEqual(["p_other:t_ops"]);
    expect(service.snapshot().identity?.accountId).toBe("co_other");
  });

  it("throws it away when only the company id changes", async () => {
    // The likelier route: same key, different Company ID typed into the connection form.
    const service = await serviceFor(acme());
    await service.setApiKey("kto_shared", "co_acme");
    expect(service.snapshot().catalog.map((pair) => pair.id)).toEqual(["p_acme:t_dev"]);

    vi.stubGlobal("fetch", other().fetch);
    await service.setCompanyId("co_other");

    expect(service.snapshot().catalog.map((pair) => pair.id)).toEqual(["p_other:t_ops"]);
  });

  it("keeps the catalog when the same company connects again", async () => {
    // The cache still has to work, or this fix would just be a slower app.
    const keito = acme();
    const service = await serviceFor(keito);
    await service.setApiKey("kto_acme", "co_acme");
    const projectCalls = () => keito.requests.filter((r) => r.path.startsWith("/projects")).length;
    const before = projectCalls();

    await service.refresh();

    expect(projectCalls()).toBe(before);
    expect(service.snapshot().catalog.map((pair) => pair.id)).toEqual(["p_acme:t_dev"]);
  });
});

/**
 * Writing logged time back to Azure DevOps. Lives here for the same reason as the
 * company-change tests: the rules — which tickets, which window, never blocking Keito —
 * are decisions `AppService` makes, and there is nowhere else they could be exercised.
 */
describe("Azure DevOps time sync", () => {
  const ORG = "https://dev.azure.com/acme";
  const PAIR = "p_acme:t_dev";

  const daysAgo = (days: number): string =>
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const seed = (keito: FakeKeito, entries: Array<Partial<FakeEntry> & { notes: string; hours: number }>) => {
    entries.forEach((entry, index) =>
      keito.entries.push({
        id: `seed_${keito.entries.length}_${index}`,
        project_id: "p_acme",
        task_id: "t_dev",
        spent_date: daysAgo(1),
        started_time: "09:00",
        ended_time: "10:00",
        timer_started_at: null,
        is_running: false,
        source: null,
        ...entry,
      }),
    );
  };

  const workItem = (id: number, title: string) => ({
    id,
    title,
    project: "Acme Web",
    state: "Active",
    changedDate: "2026-10-01T09:00:00Z",
  });

  /** A service connected to both fakes, with sync switched on unless told otherwise. */
  const connected = async (
    over: { azure?: FakeAzure; sync?: boolean; unit?: "hours" | "days" } = {},
  ) => {
    const keito = acme();
    const azure =
      over.azure ?? new FakeAzure({ workItems: [workItem(1842, "Login redirect"), workItem(7, "Other")] });
    const service = await serviceFor(keito);
    // Keito and Azure are told apart by host, as the real network would.
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(String(input)).hostname === "dev.azure.com"
        ? azure.fetch(input, init)
        : keito.fetch(input, init),
    );
    await service.setApiKey("kto_acme", "co_acme");
    await service.connectAzure("pat_good", ORG);
    if (over.sync !== false) {
      await service.setAzureSync({ enabled: true, ...(over.unit ? { unit: over.unit } : {}) });
    }
    return { keito, azure, service };
  };

  const effort = (azure: FakeAzure, id: number) =>
    azure.written.get(id)?.["Microsoft.VSTS.Scheduling.Effort"];

  it("writes nothing until sync is switched on", async () => {
    const { keito, azure, service } = await connected({ sync: false });
    seed(keito, [{ notes: "1842: Login redirect", hours: 2 }]);

    await service.switchTo(PAIR, "1842: Login redirect");
    await service.stopTimer();
    await service.azureSyncIdle();

    expect(azure.written.size).toBe(0);
  });

  it("writes the two-week total, not just the latest entry", async () => {
    const { keito, azure, service } = await connected();
    seed(keito, [
      { notes: "1842: Login redirect", hours: 2, spent_date: daysAgo(10) },
      { notes: "1842: Login redirect", hours: 1.5, spent_date: daysAgo(3) },
      // Older than the window: not counted.
      { notes: "1842: Login redirect", hours: 9, spent_date: daysAgo(20) },
      // Another ticket: not counted.
      { notes: "7: Other", hours: 4, spent_date: daysAgo(2) },
    ]);

    await service.switchTo(PAIR, "1842: Login redirect");
    await service.stopTimer();
    await service.azureSyncIdle();

    expect(effort(azure, 1842)).toBe(3.5);
  });

  it("syncs the ticket it switched away from as well as the one it switched to", async () => {
    const { keito, azure, service } = await connected();
    seed(keito, [
      { notes: "1842: Login redirect", hours: 2 },
      { notes: "7: Other", hours: 1 },
    ]);

    await service.switchTo(PAIR, "1842: Login redirect");
    await service.switchTo(PAIR, "7: Other");
    await service.azureSyncIdle();

    expect(effort(azure, 1842)).toBe(2);
    expect(effort(azure, 7)).toBe(1);
  });

  it("writes days when asked, at the configured length of a day", async () => {
    const { keito, azure, service } = await connected({ unit: "days" });
    seed(keito, [{ notes: "1842: Login redirect", hours: 6.2 }]);

    await service.switchTo(PAIR, "1842: Login redirect");
    await service.stopTimer();
    await service.azureSyncIdle();
    expect(effort(azure, 1842)).toBe(1);

    await service.setAzureSync({ hoursPerDay: 8 });
    await service.stopTimer();
    await service.switchTo(PAIR, "1842: Login redirect");
    await service.azureSyncIdle();
    // 6.2 hours over an 8 hour day is 0.775, which rounds up to 0.8.
    expect(effort(azure, 1842)).toBe(0.8);
  });

  it("re-syncs when an entry's time is edited or the entry is deleted", async () => {
    const { keito, azure, service } = await connected();
    seed(keito, [
      { id: "keep", notes: "1842: Login redirect", hours: 2 },
      { id: "drop", notes: "1842: Login redirect", hours: 1 },
    ]);
    await service.refresh();

    await service.deleteEntry("drop");
    await service.azureSyncIdle();

    expect(effort(azure, 1842)).toBe(2);
  });

  it("moves both tickets when an edit changes which one an entry names", async () => {
    const { keito, azure, service } = await connected();
    seed(keito, [{ id: "e1", notes: "1842: Login redirect", hours: 2 }]);
    await service.refresh();
    await service.switchTo(PAIR, "1842: Login redirect");
    await service.azureSyncIdle();
    expect(effort(azure, 1842)).toBe(2);

    await service.updateEntry("e1", { notes: "7: Other", noteField: "client" });
    await service.azureSyncIdle();

    expect(effort(azure, 1842)).toBe(0);
    expect(effort(azure, 7)).toBe(2);
  });

  it("does not write again when the total has not changed", async () => {
    const { keito, azure, service } = await connected();
    seed(keito, [{ notes: "1842: Login redirect", hours: 2 }]);

    await service.switchTo(PAIR, "1842: Login redirect");
    await service.stopTimer();
    await service.azureSyncIdle();
    const writes = () => azure.requests.filter((r) => r.method === "PATCH").length;
    const before = writes();

    await service.switchTo(PAIR, "1842: Login redirect");
    await service.stopTimer();
    await service.azureSyncIdle();

    expect(writes()).toBe(before);
  });

  it("ignores a number that is not one of your assigned work items", async () => {
    // "2024: planning" is a note that happens to start with a number, not a ticket pick.
    const { keito, azure, service } = await connected();
    seed(keito, [{ notes: "2024: planning", hours: 2 }]);

    await service.switchTo(PAIR, "2024: planning");
    await service.stopTimer();
    await service.azureSyncIdle();

    expect(azure.requests.some((r) => r.method === "PATCH")).toBe(false);
    expect(service.snapshot().azure.sync.errorCount).toBe(0);
  });

  it("still switches the timer, and counts the error, when Azure refuses the write", async () => {
    const azure = new FakeAzure({ workItems: [workItem(1842, "Login redirect")], canWrite: false });
    const { service } = await connected({ azure });

    const snapshot = await service.switchTo(PAIR, "1842: Login redirect");
    await service.azureSyncIdle();

    expect(snapshot.timer.status).toBe("running");
    expect(snapshot.error).toBeNull();
    expect(service.snapshot().azure.sync.errorCount).toBe(1);
  });

  it("counts a ticket whose type lacks the field, and carries on with the next", async () => {
    const azure = new FakeAzure({
      workItems: [workItem(1842, "Login redirect"), workItem(7, "Other")],
      idsWithoutFields: [1842],
    });
    const { keito, service } = await connected({ azure });
    seed(keito, [{ notes: "7: Other", hours: 1 }]);

    await service.switchTo(PAIR, "1842: Login redirect");
    await service.switchTo(PAIR, "7: Other");
    await service.azureSyncIdle();

    // 1842 fails when it starts and again when it is left; 7 is written regardless.
    expect(service.snapshot().azure.sync.errorCount).toBe(2);
    expect(azure.written.get(7)).toBeDefined();
  });

  it("offers the numeric fields once sync is on", async () => {
    const { service } = await connected();
    expect(service.snapshot().azure.sync.fields.map((field) => field.name)).toEqual([
      "Completed Work",
      "Effort",
    ]);
  });

  it("refuses a nonsense day length", async () => {
    const { service } = await connected();
    await service.setAzureSync({ hoursPerDay: 0 });
    await service.setAzureSync({ hoursPerDay: 30 });
    expect(service.snapshot().azure.sync.hoursPerDay).toBe(6.2);
  });
});
