import { beforeEach, describe, expect, it } from "vitest";
import { FakeKeito } from "../../../test/fake-keito.js";
import { KeitoClient } from "./client.js";
import { KeitoConflictError } from "./errors.js";

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

  it("corrects the notes and times on an entry, proving the edit with If-Match", async () => {
    const seeded = keito.seedRunning({ project_id: "p_a", task_id: "t_a" });
    const { etag } = await client.getTimeEntry(seeded.id);

    const updated = await client.updateTimeEntry(
      seeded.id,
      { notes: "Actually the standup", startedTime: "09:00", endedTime: "09:25" },
      etag!,
    );

    expect(updated).toMatchObject({ notes: "Actually the standup", started_time: "09:00", ended_time: "09:25" });
  });

  it("refuses an edit built on a stale read rather than clobbering someone else's change", async () => {
    const seeded = keito.seedRunning({ project_id: "p_a", task_id: "t_a" });

    await expect(
      client.updateTimeEntry(seeded.id, { notes: "late" }, '"v0"'),
    ).rejects.toBeInstanceOf(KeitoConflictError);
  });

  it("deletes an entry logged by mistake", async () => {
    const seeded = keito.seedRunning({ project_id: "p_a", task_id: "t_a" });
    const { etag } = await client.getTimeEntry(seeded.id);

    await client.deleteTimeEntry(seeded.id, etag!);

    expect(keito.entries).toHaveLength(0);
  });
});
