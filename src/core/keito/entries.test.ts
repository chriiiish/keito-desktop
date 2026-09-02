import { beforeEach, describe, expect, it } from "vitest";
import { FakeKeito } from "../../../test/fake-keito.js";
import { KeitoClient } from "./client.js";

const NOW = new Date("2026-09-02T09:30:00Z");
let keito: FakeKeito;
let client: KeitoClient;

beforeEach(() => {
  keito = new FakeKeito({ now: () => NOW });
  client = new KeitoClient({ apiKey: "kto_k", accountId: "co_9", fetch: keito.fetch });
});

describe("reviewing and correcting entries", () => {
  it("lists the entries for a date range, which is how the window shows today and this week", async () => {
    keito.seedRunning({ project_id: "p_a", task_id: "t_a", spent_date: "2026-09-02" });
    keito.seedRunning({ project_id: "p_b", task_id: "t_b", spent_date: "2026-08-20" });

    const entries = await client.listTimeEntries({ from: "2026-09-01", to: "2026-09-07" });

    expect(entries.map((e) => e.project_id)).toEqual(["p_a"]);
  });

  it("corrects the notes and times on an entry in one call", async () => {
    const seeded = keito.seedRunning({ project_id: "p_a", task_id: "t_a" });

    const updated = await client.updateTimeEntry(seeded.id, {
      notes: "Actually the standup",
      startedTime: "09:00",
      endedTime: "09:25",
    });

    expect(updated).toMatchObject({
      notes: "Actually the standup",
      started_time: "09:00",
      ended_time: "09:25",
    });
  });

  it("edits without a prior read, because there is no single-entry GET endpoint", async () => {
    const seeded = keito.seedRunning({ project_id: "p_a", task_id: "t_a" });

    await client.updateTimeEntry(seeded.id, { notes: "no read first" });

    expect(keito.requests.filter((r) => r.method === "GET")).toHaveLength(0);
  });

  it("reads an entry back unwrapped, as the live API returns it", async () => {
    const seeded = keito.seedRunning({ project_id: "p_a", task_id: "t_a" });

    const updated = await client.updateTimeEntry(seeded.id, { notes: "x" });

    // Not `{ time_entry: { ... } }` — the entry itself.
    expect(updated.id).toBe(seeded.id);
  });

  it("deletes an entry logged by mistake", async () => {
    const seeded = keito.seedRunning({ project_id: "p_a", task_id: "t_a" });

    await client.deleteTimeEntry(seeded.id);

    expect(keito.entries).toHaveLength(0);
  });
});
