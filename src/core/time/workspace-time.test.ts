import { describe, expect, it } from "vitest";
import { formatWorkspaceTime, parseWorkspaceTime } from "./workspace-time.js";

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
