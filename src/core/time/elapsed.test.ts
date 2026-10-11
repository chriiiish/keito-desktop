import { describe, expect, it } from "vitest";
import type { TimeEntry } from "../keito/types.js";
import { entrySeconds, entryStartMs, formatDecimalHours, formatDuration, recordedSeconds } from "./elapsed.js";

const NOW = Date.parse("2026-09-02T11:30:00Z");

const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: "te_1",
  project_id: "p",
  task_id: "t",
  spent_date: "2026-09-02",
  started_time: "09:00",
  ended_time: "10:00",
  timer_started_at: null,
  duration_seconds: null,
  hours: 1,
  is_running: false,
  notes: null,
  ...over,
});

describe("entryStartMs", () => {
  it("prefers the real instant the API sends", () => {
    const at = entryStartMs(entry({ timer_started_at: "2026-09-02T09:15:00Z" }), "UTC");

    expect(at).toBe(Date.parse("2026-09-02T09:15:00Z"));
  });

  // The fallback is a wall-clock time with no zone in it, so it only means something
  // against the workspace's — an hour that is 09:00 in Sydney is not 09:00 in UTC.
  it("falls back to the workspace's wall clock, not UTC's", () => {
    const sydney = entryStartMs(entry(), "Australia/Sydney");
    const utc = entryStartMs(entry(), "UTC");

    expect(sydney).not.toBe(utc);
    expect(utc).toBe(Date.parse("2026-09-02T09:00:00Z"));
  });

  it("prefers the instant even when a wall-clock time is also present", () => {
    const at = entryStartMs(
      entry({ timer_started_at: "2026-09-02T09:15:00Z", started_time: "07:00" }),
      "UTC",
    );

    expect(at).toBe(Date.parse("2026-09-02T09:15:00Z"));
  });

  it("says it does not know rather than guessing", () => {
    expect(entryStartMs(entry({ timer_started_at: null, started_time: null }), "UTC")).toBeNull();
    expect(entryStartMs(entry({ timer_started_at: "not a date", started_time: null }), "UTC")).toBeNull();
  });
});

describe("entrySeconds", () => {
  // The bug this exists for: a running entry reports hours: null, so anything reading
  // `hours` showed a running timer as 0:00.
  it("measures a running entry from its start, not from its null hours", () => {
    const running = entry({
      is_running: true,
      hours: null,
      ended_time: null,
      timer_started_at: "2026-09-02T11:00:00Z",
    });

    expect(entrySeconds(running, NOW, "UTC")).toBe(1800);
  });

  it("keeps counting as time passes", () => {
    const running = entry({
      is_running: true,
      hours: null,
      ended_time: null,
      timer_started_at: "2026-09-02T11:00:00Z",
    });

    expect(entrySeconds(running, NOW + 60_000, "UTC")).toBe(1860);
  });

  // A clock skewed behind the server would otherwise count backwards.
  it("never reports a negative length", () => {
    const running = entry({
      is_running: true,
      hours: null,
      ended_time: null,
      timer_started_at: "2026-09-02T12:00:00Z",
    });

    expect(entrySeconds(running, NOW, "UTC")).toBe(0);
  });

  it("uses the recorded length once the timer has stopped", () => {
    expect(entrySeconds(entry({ hours: 1.5 }), NOW, "UTC")).toBe(5400);
  });

  it("prefers duration_seconds over the rounded hours", () => {
    expect(entrySeconds(entry({ duration_seconds: 5432, hours: 1.5 }), NOW, "UTC")).toBe(5432);
  });

  it("does not invent a length for a running entry with no start", () => {
    const running = entry({
      is_running: true,
      hours: null,
      ended_time: null,
      timer_started_at: null,
      started_time: null,
    });

    expect(entrySeconds(running, NOW, "UTC")).toBeNull();
  });

  it("nor for a stopped entry that recorded nothing", () => {
    expect(entrySeconds(entry({ hours: null }), NOW, "UTC")).toBeNull();
  });

  // The bug this exists for: Keito's restart endpoint hands a resumed entry back with
  // hours reset to null, same as any running entry, so the stretch worked before pausing
  // used to vanish until the timer stopped again. AppService.resumeEntry writes what had
  // already been logged onto duration_seconds before the reload replaces the entry, so a
  // *running* entry can carry a recorded length too.
  it("adds a running entry's own recorded length to the stretch since it restarted", () => {
    const resumed = entry({
      is_running: true,
      hours: null,
      duration_seconds: 1800, // 30 minutes logged before the pause.
      ended_time: null,
      timer_started_at: "2026-09-02T11:00:00Z", // Resumed 30 minutes before NOW.
    });

    expect(entrySeconds(resumed, NOW, "UTC")).toBe(1800 + 1800);
  });
});

describe("recordedSeconds", () => {
  it("is zero for a freshly running entry, not unknown", () => {
    expect(recordedSeconds(entry({ is_running: true, hours: null, duration_seconds: null }))).toBe(0);
  });

  it("prefers duration_seconds over hours", () => {
    expect(recordedSeconds(entry({ duration_seconds: 100, hours: 1.5 }))).toBe(100);
  });

  it("falls back to hours converted to seconds", () => {
    expect(recordedSeconds(entry({ duration_seconds: null, hours: 1.5 }))).toBe(5400);
  });
});

describe("formatting", () => {
  it("reads a duration as hours and minutes", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(1800)).toBe("0:30");
    expect(formatDuration(5400)).toBe("1:30");
    expect(formatDuration(36_000)).toBe("10:00");
  });

  it("rounds to the nearest minute rather than truncating", () => {
    expect(formatDuration(119)).toBe("0:02");
  });

  it("says nothing rather than zero when the length is unknown", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDecimalHours(null)).toBe("—");
  });

  it("keeps the entries table in decimal hours", () => {
    expect(formatDecimalHours(5400)).toBe("1.50");
    expect(formatDecimalHours(1800)).toBe("0.50");
  });
});
