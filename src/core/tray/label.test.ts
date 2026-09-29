import { describe, expect, it } from "vitest";
import { formatTrayLabel, TRAY_LABEL_MAX } from "./label.js";

const running = { note: "Sprint planning", projectName: "Acme Rebuild", taskName: "Development" };
const noNote = { ...running, note: null };

describe("formatTrayLabel", () => {
  it("shows the note by default, since that is what says what you're doing", () => {
    expect(formatTrayLabel(running, { fallback: "task", prefix: "none", showElapsed: false })).toBe(
      "Sprint planning",
    );
  });

  it("falls back to the task when there is no note", () => {
    expect(formatTrayLabel(noNote, { fallback: "task", prefix: "none", showElapsed: false })).toBe(
      "Development",
    );
  });

  it("can fall back to the project instead", () => {
    expect(formatTrayLabel(noNote, { fallback: "project", prefix: "none", showElapsed: false })).toBe(
      "Acme Rebuild",
    );
  });

  it("can prefix a note with the project", () => {
    expect(formatTrayLabel(running, { fallback: "task", prefix: "project", showElapsed: false })).toBe(
      "Acme Rebuild: Sprint planning",
    );
  });

  it("can prefix a note with the task", () => {
    expect(formatTrayLabel(running, { fallback: "task", prefix: "task", showElapsed: false })).toBe(
      "Development: Sprint planning",
    );
  });

  it("does not prefix the fallback, which would read as a label repeated twice", () => {
    expect(formatTrayLabel(noNote, { fallback: "task", prefix: "task", showElapsed: false })).toBe(
      "Development",
    );
    expect(formatTrayLabel(noNote, { fallback: "project", prefix: "project", showElapsed: false })).toBe(
      "Acme Rebuild",
    );
  });

  it("treats whitespace-only notes as blank", () => {
    expect(
      formatTrayLabel(
        { ...running, note: "   " },
        { fallback: "task", prefix: "none", showElapsed: false },
      ),
    ).toBe("Development");
  });

  it("truncates to keep the menu bar usable", () => {
    const long = { ...running, note: "x".repeat(TRAY_LABEL_MAX + 20) };

    const label = formatTrayLabel(long, { fallback: "task", prefix: "none", showElapsed: false });

    expect(label).toHaveLength(TRAY_LABEL_MAX);
    expect(label.endsWith("…")).toBe(true);
  });

  it("collapses newlines, which would otherwise break the tray title", () => {
    expect(
      formatTrayLabel(
        { ...running, note: "line one\nline two" },
        { fallback: "task", prefix: "none", showElapsed: false },
      ),
    ).toBe("line one line two");
  });
});

describe("formatTrayLabel elapsed time", () => {
  it("appends nothing when showElapsed is off, even with elapsedSeconds present", () => {
    expect(
      formatTrayLabel(
        { ...running, elapsedSeconds: 83 * 60 },
        { fallback: "task", prefix: "none", showElapsed: false },
      ),
    ).toBe("Sprint planning");
  });

  it("appends the elapsed time, h:mm, to the end of the label", () => {
    expect(
      formatTrayLabel(
        { ...running, elapsedSeconds: 83 * 60 },
        { fallback: "task", prefix: "none", showElapsed: true },
      ),
    ).toBe("Sprint planning 1:23");
  });

  it("appends to the fallback too, when there is no note", () => {
    expect(
      formatTrayLabel(
        { ...noNote, elapsedSeconds: 83 * 60 },
        { fallback: "task", prefix: "none", showElapsed: true },
      ),
    ).toBe("Development 1:23");
  });

  it("shows nothing extra when elapsedSeconds is unknown, even with showElapsed on", () => {
    expect(
      formatTrayLabel(
        { ...running, elapsedSeconds: null },
        { fallback: "task", prefix: "none", showElapsed: true },
      ),
    ).toBe("Sprint planning");
  });

  // The one thing this label cannot silently drop: the message shrinks around it instead.
  it("keeps the elapsed time whole and truncates the message when the total is too long", () => {
    const long = { ...running, note: "x".repeat(TRAY_LABEL_MAX), elapsedSeconds: 83 * 60 };

    const label = formatTrayLabel(long, { fallback: "task", prefix: "none", showElapsed: true });

    expect(label).toHaveLength(TRAY_LABEL_MAX);
    expect(label.endsWith(" 1:23")).toBe(true);
    expect(label).toContain("…");
  });

  it("does not truncate at all once the elapsed time already fits", () => {
    const label = formatTrayLabel(
      { ...running, elapsedSeconds: 83 * 60 },
      { fallback: "task", prefix: "none", showElapsed: true },
    );

    expect(label).toBe(`${running.note} 1:23`);
    expect(label).not.toContain("…");
  });
});
