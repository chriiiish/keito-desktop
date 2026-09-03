import { describe, expect, it } from "vitest";
import type { TimeEntry } from "../keito/types.js";
import { loggedBeforeRunning, totalsByTaskAndNote } from "./totals.js";

const TZ = "UTC";
/** 10:00 on the day every fixture below is filed under. */
const NOW = Date.parse("2026-09-03T10:00:00Z");

const entry = (over: Partial<TimeEntry> & { id: string }): TimeEntry => ({
  project_id: "p_acme",
  task_id: "t_dev",
  spent_date: "2026-09-03",
  started_time: "09:00",
  ended_time: "09:30",
  hours: 0.5,
  is_running: false,
  notes: null,
  ...over,
});

/** A running entry reports hours: null — its length is only measurable from its start. */
const running = (over: Partial<TimeEntry> & { id: string }): TimeEntry =>
  entry({
    hours: null,
    ended_time: null,
    is_running: true,
    timer_started_at: "2026-09-03T09:50:00Z",
    ...over,
  });

describe("totalsByTaskAndNote", () => {
  it("adds up every stretch of the same task and note", () => {
    // The bug this exists for: switching away and back POSTs a *new* entry, so a task
    // worked on twice is two rows, and while the second is running it reports hours: null
    // — so the popover showed only the latest stretch and the earlier work vanished.
    const totals = totalsByTaskAndNote(
      [running({ id: "te_2", notes: "Sprint planning" }), entry({ id: "te_1", notes: "Sprint planning" })],
      NOW,
      TZ,
    );

    expect(totals).toHaveLength(1);
    // 30 minutes logged, plus 10 minutes running since 09:50.
    expect(totals[0]!.seconds).toBe(40 * 60);
    expect(totals[0]!.isRunning).toBe(true);
  });

  it("keeps the same task apart when the notes differ", () => {
    // "for that task with that note" — two different things worked on under one task are
    // still two things.
    const totals = totalsByTaskAndNote(
      [entry({ id: "te_1", notes: "Sprint planning" }), entry({ id: "te_2", notes: "Code review" })],
      NOW,
      TZ,
    );

    expect(totals).toHaveLength(2);
    expect(totals.map((total) => total.seconds)).toEqual([30 * 60, 30 * 60]);
  });

  it("treats a blank note and no note as the same thing", () => {
    // Keito stores an untouched note as null and a cleared one as "", and the user who
    // typed neither means the same by both.
    const totals = totalsByTaskAndNote(
      [entry({ id: "te_1", notes: null }), entry({ id: "te_2", notes: "   " })],
      NOW,
      TZ,
    );

    expect(totals).toHaveLength(1);
    expect(totals[0]!.seconds).toBe(60 * 60);
  });

  it("ignores surrounding whitespace when matching notes", () => {
    const totals = totalsByTaskAndNote(
      [entry({ id: "te_1", notes: "Sprint planning" }), entry({ id: "te_2", notes: " Sprint planning " })],
      NOW,
      TZ,
    );

    expect(totals).toHaveLength(1);
  });

  it("keeps the same note apart when the task differs", () => {
    const totals = totalsByTaskAndNote(
      [entry({ id: "te_1", task_id: "t_dev" }), entry({ id: "te_2", task_id: "t_ops" })],
      NOW,
      TZ,
    );

    expect(totals).toHaveLength(2);
  });

  it("keeps the same task and note apart across projects", () => {
    const totals = totalsByTaskAndNote(
      [entry({ id: "te_1", project_id: "p_acme" }), entry({ id: "te_2", project_id: "p_bank" })],
      NOW,
      TZ,
    );

    expect(totals).toHaveLength(2);
  });

  it("leads each group with its newest entry, which is the one the buttons act on", () => {
    // Resuming has to restart the most recent stretch, not the first one of the day.
    const totals = totalsByTaskAndNote(
      [entry({ id: "te_newest" }), entry({ id: "te_older" })],
      NOW,
      TZ,
    );

    expect(totals[0]!.latest.id).toBe("te_newest");
    expect(totals[0]!.entries.map((e) => e.id)).toEqual(["te_newest", "te_older"]);
  });

  it("keeps the order the entries arrived in, newest group first", () => {
    const totals = totalsByTaskAndNote(
      [entry({ id: "te_b", task_id: "t_ops" }), entry({ id: "te_a", task_id: "t_dev" })],
      NOW,
      TZ,
    );

    expect(totals.map((total) => total.latest.id)).toEqual(["te_b", "te_a"]);
  });

  it("is running if any stretch in the group is", () => {
    const totals = totalsByTaskAndNote(
      [entry({ id: "te_1" }), running({ id: "te_2" })],
      NOW,
      TZ,
    );

    expect(totals[0]!.isRunning).toBe(true);
  });

  it("reports null only when nothing in the group can be measured at all", () => {
    // A single unmeasurable entry stays "—" rather than becoming a confident 0:00.
    const totals = totalsByTaskAndNote(
      [entry({ id: "te_1", hours: null, duration_seconds: null })],
      NOW,
      TZ,
    );

    expect(totals[0]!.seconds).toBeNull();
  });

  it("still totals a group where only some stretches can be measured", () => {
    const totals = totalsByTaskAndNote(
      [entry({ id: "te_1", hours: null, duration_seconds: null }), entry({ id: "te_2" })],
      NOW,
      TZ,
    );

    expect(totals[0]!.seconds).toBe(30 * 60);
  });

  it("has nothing to say about an empty day", () => {
    expect(totalsByTaskAndNote([], NOW, TZ)).toEqual([]);
  });
});

describe("loggedBeforeRunning", () => {
  it("is the time already banked against the running work today", () => {
    // The header clock ticks from the running entry's own start, so it needs what came
    // before it — otherwise the header and the row for the same task disagree, both
    // ticking, in a window small enough to see them at once.
    const seconds = loggedBeforeRunning(
      [running({ id: "te_2", notes: "Sprint planning" }), entry({ id: "te_1", notes: "Sprint planning" })],
      TZ,
    );

    expect(seconds).toBe(30 * 60);
  });

  it("counts every earlier stretch, not just the last one", () => {
    const seconds = loggedBeforeRunning(
      [running({ id: "te_3" }), entry({ id: "te_2" }), entry({ id: "te_1" })],
      TZ,
    );

    expect(seconds).toBe(60 * 60);
  });

  it("ignores work on anything else", () => {
    const seconds = loggedBeforeRunning(
      [running({ id: "te_2", notes: "Sprint planning" }), entry({ id: "te_1", notes: "Code review" })],
      TZ,
    );

    expect(seconds).toBe(0);
  });

  it("is zero on the first stretch of a task", () => {
    expect(loggedBeforeRunning([running({ id: "te_1" })], TZ)).toBe(0);
  });

  it("is zero when nothing is running at all", () => {
    expect(loggedBeforeRunning([entry({ id: "te_1" })], TZ)).toBe(0);
    expect(loggedBeforeRunning([], TZ)).toBe(0);
  });

  it("does not count the running stretch itself, which the clock is already ticking", () => {
    // Double counting here would make the header run at twice the speed of the row.
    const seconds = loggedBeforeRunning([running({ id: "te_1" }), running({ id: "te_2" })], TZ);

    expect(seconds).toBe(0);
  });
});

describe("totalsByTaskAndNote does not trust the order it is handed", () => {
  // The list this is given is whatever GET /time_entries paged back. Nothing sorts it:
  // the real API makes no promise, and the fake pushes as it creates, so entries arrive
  // *oldest* first. Picking `latest` by position made resume restart the first stretch of
  // the day rather than the most recent one.
  const at = (id: string, startedTime: string, over: Partial<TimeEntry> = {}) =>
    entry({ id, started_time: startedTime, timer_started_at: `2026-09-03T${startedTime}:00Z`, ...over });

  it("finds the newest stretch even when handed the oldest first", () => {
    const totals = totalsByTaskAndNote([at("te_09", "09:00"), at("te_11", "11:00")], NOW, TZ);

    expect(totals[0]!.latest.id).toBe("te_11");
  });

  it("orders the entries within a group newest first, whatever it was given", () => {
    const totals = totalsByTaskAndNote(
      [at("te_09", "09:00"), at("te_13", "13:00"), at("te_11", "11:00")],
      NOW,
      TZ,
    );

    expect(totals[0]!.entries.map((e) => e.id)).toEqual(["te_13", "te_11", "te_09"]);
  });

  it("orders the groups newest first, by the newest stretch in each", () => {
    const totals = totalsByTaskAndNote(
      [at("te_early", "09:00", { task_id: "t_dev" }), at("te_late", "14:00", { task_id: "t_ops" })],
      NOW,
      TZ,
    );

    expect(totals.map((total) => total.latest.id)).toEqual(["te_late", "te_early"]);
  });

  it("puts a running stretch at the head of its group", () => {
    // It started most recently by definition — it has not finished.
    const totals = totalsByTaskAndNote(
      [at("te_09", "09:00"), running({ id: "te_now", timer_started_at: "2026-09-03T09:50:00Z" })],
      NOW,
      TZ,
    );

    expect(totals[0]!.latest.id).toBe("te_now");
  });

  it("keeps entries whose start cannot be read, and puts them last", () => {
    // No timer_started_at and no started_time: still real logged time, just unorderable.
    const totals = totalsByTaskAndNote(
      [entry({ id: "te_unknown", started_time: null }), at("te_09", "09:00")],
      NOW,
      TZ,
    );

    expect(totals[0]!.entries.map((e) => e.id)).toEqual(["te_09", "te_unknown"]);
    expect(totals[0]!.latest.id).toBe("te_09");
  });
});
