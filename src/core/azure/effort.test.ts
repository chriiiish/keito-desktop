import { describe, expect, it } from "vitest";
import type { TimeEntry } from "../keito/types.js";
import { effortValue, roundUpEffort, syncWindowStart, ticketSeconds } from "./effort.js";

describe("roundUpEffort", () => {
  it.each([
    [0, 0],
    [1, 1],
    [1.01, 1.1],
    [1.1, 1.1],
    [1.21, 1.25],
    [1.25, 1.25],
    [1.26, 1.3],
    [1.31, 1.4],
    [1.71, 1.75],
    [1.76, 1.8],
    [1.91, 2],
    [2.99, 3],
    [0.3, 0.3],
  ])("%s becomes %s", (input, expected) => {
    expect(roundUpEffort(input)).toBe(expected);
  });

  it("is not pushed up a step by float noise", () => {
    expect(roundUpEffort(0.1 * 3)).toBe(0.3);
  });

  it("treats nonsense as nothing", () => {
    expect(roundUpEffort(-1)).toBe(0);
    expect(roundUpEffort(Number.NaN)).toBe(0);
  });
});

describe("effortValue", () => {
  it("writes decimal hours", () => {
    expect(effortValue(90 * 60, "hours", 6.2)).toBe(1.5);
  });

  it("divides by the length of a day", () => {
    // 12.4 hours at 6.2 hours a day is exactly two days.
    expect(effortValue(12.4 * 3600, "days", 6.2)).toBe(2);
    // 3.1 hours is half a day.
    expect(effortValue(3.1 * 3600, "days", 6.2)).toBe(0.5);
  });
});

const entry = (over: Partial<TimeEntry>): TimeEntry => ({
  id: "e",
  project_id: "p",
  task_id: "t",
  spent_date: "2026-10-12",
  started_time: null,
  ended_time: null,
  hours: 1,
  is_running: false,
  notes: "1842: Login redirect",
  ...over,
});

const NOW = new Date("2026-10-12T12:00:00Z");

describe("syncWindowStart", () => {
  it("is 14 days including today, in workspace dates", () => {
    expect(syncWindowStart(NOW, "UTC")).toBe("2026-09-29");
    // 08:00 in Sydney on the 13th is still the 12th in UTC; the window follows Sydney.
    expect(syncWindowStart(new Date("2026-10-12T22:00:00Z"), "Australia/Sydney")).toBe("2026-09-30");
  });
});

describe("ticketSeconds", () => {
  it("totals every entry for the ticket across the window", () => {
    const entries = [
      entry({ id: "a", spent_date: "2026-10-12", hours: 1 }),
      entry({ id: "b", spent_date: "2026-10-05", hours: 2 }),
      entry({ id: "c", spent_date: "2026-09-29", hours: 0.5 }),
    ];
    expect(ticketSeconds(entries, 1842, NOW, "UTC")).toBe(3.5 * 3600);
  });

  it("leaves out entries older than the window", () => {
    const entries = [entry({ spent_date: "2026-09-28", hours: 5 })];
    expect(ticketSeconds(entries, 1842, NOW, "UTC")).toBe(0);
  });

  it("leaves out other tickets, plain notes and look-alikes", () => {
    const entries = [
      entry({ notes: "1843: Other ticket" }),
      entry({ notes: "just a note" }),
      entry({ notes: "see 1842: later" }),
    ];
    expect(ticketSeconds(entries, 1842, NOW, "UTC")).toBe(0);
  });

  it("reads the internal note when there is no client note", () => {
    const entries = [entry({ notes: null, internal_notes: "1842: Login redirect", hours: 2 })];
    expect(ticketSeconds(entries, 1842, NOW, "UTC")).toBe(2 * 3600);
  });

  it("counts a running entry for its elapsed time", () => {
    const entries = [
      entry({
        is_running: true,
        hours: null,
        timer_started_at: "2026-10-12T11:00:00Z",
      }),
    ];
    expect(ticketSeconds(entries, 1842, NOW, "UTC")).toBe(3600);
  });
});
