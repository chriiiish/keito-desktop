import { beforeEach, describe, expect, it } from "vitest";
import { FakeKeito } from "../../../test/fake-keito.js";
import { KeitoClient } from "../keito/client.js";
import { TimerSwitcher } from "./switcher.js";
import { KeitoAuthError, KeitoConflictError, KeitoNetworkError } from "../keito/errors.js";
import type { Pair } from "../keito/types.js";

const NOW = new Date("2026-09-02T09:30:00Z");

const DEV: Pair = {
  id: "p_acme:t_dev",
  projectId: "p_acme",
  projectName: "Acme Rebuild",
  taskId: "t_dev",
  taskName: "Development",
};
const QA: Pair = { ...DEV, id: "p_acme:t_qa", taskId: "t_qa", taskName: "QA" };

let keito: FakeKeito;
let switcher: TimerSwitcher;

beforeEach(() => {
  keito = new FakeKeito({ now: () => NOW });
  switcher = new TimerSwitcher({
    client: new KeitoClient({ apiKey: "kto_k", accountId: "co_9", fetch: keito.fetch }),
    now: () => NOW,
  });
});

describe("starting a timer", () => {
  it("creates a running entry against the chosen pair, tagged as coming from the desktop app", async () => {
    await switcher.switchTo(DEV);

    expect(keito.entries).toHaveLength(1);
    const [entry] = keito.entries;
    expect(entry).toMatchObject({
      project_id: "p_acme",
      task_id: "t_dev",
      spent_date: "2026-09-02",
      is_running: true,
      hours: null,
      source: "desktop",
    });
  });

  it("lets the server set the start time, so no timezone conversion happens on the hot path", async () => {
    await switcher.switchTo(DEV);

    const post = keito.requests.find((r) => r.method === "POST")!;
    expect(post.body).not.toHaveProperty("started_time");
    expect(post.body).not.toHaveProperty("hours");
  });

  it("reports the running pair so the tray can show what is being timed", async () => {
    await switcher.switchTo(DEV);

    expect(switcher.current()).toMatchObject({ status: "running", pair: DEV });
  });

  it("attaches notes when given, and omits them when not", async () => {
    await switcher.switchTo(QA, "Regression sweep");

    expect(keito.entries[0]!.notes).toBe("Regression sweep");
  });
});

describe("switching while a timer is already running", () => {
  it("stops the old timer and starts the new one in a single request", async () => {
    keito.seedRunning({ project_id: "p_acme", task_id: "t_dev" });

    await switcher.switchTo(QA);

    expect(keito.requests.filter((r) => r.method !== "GET")).toHaveLength(1);
    expect(keito.entries.map((e) => [e.task_id, e.is_running])).toEqual([
      ["t_dev", false],
      ["t_qa", true],
    ]);
  });

  it("closes out the previous entry rather than leaving two timers running", async () => {
    keito.seedRunning({ project_id: "p_acme", task_id: "t_dev" });

    await switcher.switchTo(QA);

    expect(keito.entries.filter((e) => e.is_running)).toHaveLength(1);
    expect(keito.entries[0]!.ended_time).toBe("09:30");
  });

  it("surfaces a conflict when a create is not allowed to replace the running timer", async () => {
    keito.seedRunning({ project_id: "p_acme", task_id: "t_dev" });
    const client = new KeitoClient({ apiKey: "kto_k", accountId: "co_9", fetch: keito.fetch });

    await expect(
      client.createTimeEntry({
        projectId: "p_acme",
        taskId: "t_qa",
        spentDate: "2026-09-02",
        isRunning: true,
      }),
    ).rejects.toBeInstanceOf(KeitoConflictError);
  });
});

describe("stopping the timer", () => {
  it("stops the entry it started and goes idle", async () => {
    await switcher.switchTo(DEV);

    await switcher.stop();

    expect(keito.running).toBeUndefined();
    expect(switcher.current()).toEqual({ status: "idle" });
  });

  it("stops through the dedicated endpoint, letting the server set the end time", async () => {
    await switcher.switchTo(DEV);

    await switcher.stop();

    const stop = keito.requests.find((r) => r.path.endsWith("/stop"))!;
    expect(stop.method).toBe("PATCH");
    expect(stop.body).toEqual({});
  });

  it("does nothing when there is no timer to stop", async () => {
    await switcher.stop();

    expect(keito.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
  });
});

describe("picking up a timer started elsewhere", () => {
  it("adopts a timer running in the web app, matching it back to its pair", async () => {
    keito.seedRunning({ project_id: "p_acme", task_id: "t_qa" });

    await switcher.refresh([DEV, QA]);

    expect(switcher.current()).toMatchObject({ status: "running", pair: QA });
  });

  it("can stop a timer it adopted, without a prior read", async () => {
    keito.seedRunning({ project_id: "p_acme", task_id: "t_qa" });
    await switcher.refresh([DEV, QA]);

    await switcher.stop();

    expect(keito.running).toBeUndefined();
    expect(switcher.current()).toEqual({ status: "idle" });
    // The live API has no GET /time_entries/:id — it answers 405.
    expect(keito.requests.some((r) => /^\/time_entries\/[^/]+$/.test(r.path))).toBe(false);
  });

  it("goes idle when Keito says nothing is running", async () => {
    await switcher.refresh([DEV, QA]);

    expect(switcher.current()).toEqual({ status: "idle" });
  });
});

describe("when a switch fails", () => {
  it("keeps the old timer running rather than silently losing tracked time", async () => {
    await switcher.switchTo(DEV);
    keito.offline = true;

    await expect(switcher.switchTo(QA)).rejects.toBeInstanceOf(KeitoNetworkError);

    expect(switcher.current()).toMatchObject({ status: "running", pair: DEV });
    expect(keito.running!.task_id).toBe("t_dev");
  });

  it("reports a rejected key as needing auth, so the UI can open settings", async () => {
    const rejecting = new FakeKeito({ now: () => NOW, rejectAuth: true });
    const authSwitcher = new TimerSwitcher({
      client: new KeitoClient({ apiKey: "kto_stale", accountId: "co_9", fetch: rejecting.fetch }),
      now: () => NOW,
    });

    await expect(authSwitcher.switchTo(DEV)).rejects.toBeInstanceOf(KeitoAuthError);

    expect(authSwitcher.current()).toEqual({ status: "needs-auth" });
  });
});

describe("resuming an earlier entry", () => {
  it("restarts that entry rather than creating a duplicate for the same task", async () => {
    const earlier = keito.seedRunning({ project_id: "p_acme", task_id: "t_dev" });
    await switcher.stop();

    await switcher.restart(earlier.id, DEV);

    expect(keito.entries).toHaveLength(1);
    expect(keito.running?.id).toBe(earlier.id);
    expect(switcher.current()).toMatchObject({ status: "running", pair: DEV });
  });

  it("replaces whatever is running, so resuming is one gesture like switching", async () => {
    const earlier = keito.seedRunning({ project_id: "p_acme", task_id: "t_dev" });
    await switcher.stop();
    await switcher.switchTo(QA);

    await switcher.restart(earlier.id, DEV);

    expect(keito.entries.filter((e) => e.is_running)).toHaveLength(1);
    expect(keito.running?.id).toBe(earlier.id);
  });

  it("keeps the old timer running when the resume fails", async () => {
    const earlier = keito.seedRunning({ project_id: "p_acme", task_id: "t_dev" });
    await switcher.stop();
    await switcher.switchTo(QA);
    keito.offline = true;

    await expect(switcher.restart(earlier.id, DEV)).rejects.toBeInstanceOf(KeitoNetworkError);

    expect(switcher.current()).toMatchObject({ status: "running", pair: QA });
  });
});
