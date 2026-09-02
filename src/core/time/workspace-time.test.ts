import { describe, expect, it } from "vitest";
import {
  daysBetween,
  formatWorkspaceTime,
  parseWorkspaceTime,
  shiftDate,
  workspaceDate,
} from "./workspace-time.js";

describe("workspaceDate", () => {
  it("gives the calendar date in the workspace zone, which is not always UTC's", () => {
    // 22:00 UTC on the 1st: already the 2nd in Sydney, still the 1st in Los Angeles.
    const instant = new Date("2026-09-01T22:00:00Z");

    expect(workspaceDate(instant, "Australia/Sydney")).toBe("2026-09-02");
    expect(workspaceDate(instant, "America/Los_Angeles")).toBe("2026-09-01");
    expect(workspaceDate(instant, "UTC")).toBe("2026-09-01");
  });

  it("follows the zone across a daylight-saving change", () => {
    // The same wall-clock instant, 22:30 UTC, straddles midnight in Paris only in summer:
    // CEST is UTC+2 so it is already the next day, while CET is UTC+1 so it is not.
    expect(workspaceDate(new Date("2026-07-31T22:30:00Z"), "Europe/Paris")).toBe("2026-08-01");
    expect(workspaceDate(new Date("2026-01-31T22:30:00Z"), "Europe/Paris")).toBe("2026-01-31");
  });

  it("pads to the YYYY-MM-DD Keito expects", () => {
    expect(workspaceDate(new Date("2026-01-05T12:00:00Z"), "UTC")).toBe("2026-01-05");
  });
});

describe("daysBetween and shiftDate", () => {
  it("counts whole days between two dates", () => {
    expect(daysBetween("2026-09-02", "2026-09-02")).toBe(0);
    expect(daysBetween("2026-08-03", "2026-09-02")).toBe(30);
    expect(daysBetween("2026-09-03", "2026-09-02")).toBe(-1);
  });

  it("is unaffected by a daylight-saving change inside the span", () => {
    // 25 Oct 2026 is when the UK goes back an hour; counted in days it changes nothing.
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("shifts a date by whole days, across month and year ends", () => {
    expect(shiftDate("2026-09-02", -30)).toBe("2026-08-03");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("round-trips against daysBetween", () => {
    expect(daysBetween(shiftDate("2026-09-02", -30), "2026-09-02")).toBe(30);
  });
});

describe("formatWorkspaceTime", () => {
  it("renders an instant as HH:mm in the workspace zone, not the machine's", () => {
    const instant = new Date("2026-09-02T09:30:00Z");

    expect(formatWorkspaceTime(instant, "Europe/London")).toBe("10:30"); // BST, UTC+1
    expect(formatWorkspaceTime(instant, "America/New_York")).toBe("05:30"); // EDT, UTC-4
    expect(formatWorkspaceTime(instant, "UTC")).toBe("09:30");
  });

  it("follows the zone across a daylight-saving change", () => {
    const winter = new Date("2026-01-15T09:30:00Z");

    expect(formatWorkspaceTime(winter, "Europe/London")).toBe("09:30"); // GMT, UTC+0
  });

  it("zero-pads, because Keito wants HH:mm", () => {
    expect(formatWorkspaceTime(new Date("2026-09-02T06:05:00Z"), "UTC")).toBe("06:05");
  });
});

describe("parseWorkspaceTime", () => {
  it("turns a spent_date and HH:mm in the workspace zone back into an instant", () => {
    expect(parseWorkspaceTime("2026-09-02", "10:30", "Europe/London").toISOString()).toBe(
      "2026-09-02T09:30:00.000Z",
    );
    expect(parseWorkspaceTime("2026-09-02", "05:30", "America/New_York").toISOString()).toBe(
      "2026-09-02T09:30:00.000Z",
    );
  });

  it("round-trips every value it formats", () => {
    const instant = new Date("2026-11-20T14:45:00Z");
    const zone = "Australia/Sydney";

    const formatted = formatWorkspaceTime(instant, zone);

    expect(parseWorkspaceTime("2026-11-21", formatted, zone).toISOString()).toBe(
      "2026-11-20T14:45:00.000Z",
    );
  });

  it("rejects a time that is not HH:mm", () => {
    expect(() => parseWorkspaceTime("2026-09-02", "half nine", "UTC")).toThrow();
    expect(() => parseWorkspaceTime("2026-09-02", "25:00", "UTC")).toThrow();
  });
});
