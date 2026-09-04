import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeKeito } from "../test/fake-keito.js";
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
