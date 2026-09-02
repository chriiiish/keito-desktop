import { describe, expect, it } from "vitest";
import { formatTrayLabel, TRAY_LABEL_MAX } from "./label.js";

const running = { note: "Sprint planning", projectName: "Acme Rebuild", taskName: "Development" };
const noNote = { ...running, note: null };

describe("formatTrayLabel", () => {
  it("shows the note by default, since that is what says what you're doing", () => {
    expect(formatTrayLabel(running, { fallback: "task", prefix: "none" })).toBe("Sprint planning");
  });

  it("falls back to the task when there is no note", () => {
    expect(formatTrayLabel(noNote, { fallback: "task", prefix: "none" })).toBe("Development");
  });

  it("can fall back to the project instead", () => {
    expect(formatTrayLabel(noNote, { fallback: "project", prefix: "none" })).toBe("Acme Rebuild");
  });

  it("can prefix a note with the project", () => {
    expect(formatTrayLabel(running, { fallback: "task", prefix: "project" })).toBe(
      "Acme Rebuild: Sprint planning",
    );
  });

  it("can prefix a note with the task", () => {
    expect(formatTrayLabel(running, { fallback: "task", prefix: "task" })).toBe(
      "Development: Sprint planning",
    );
  });

  it("does not prefix the fallback, which would read as a label repeated twice", () => {
    expect(formatTrayLabel(noNote, { fallback: "task", prefix: "task" })).toBe("Development");
    expect(formatTrayLabel(noNote, { fallback: "project", prefix: "project" })).toBe("Acme Rebuild");
  });

  it("treats whitespace-only notes as blank", () => {
    expect(formatTrayLabel({ ...running, note: "   " }, { fallback: "task", prefix: "none" })).toBe(
      "Development",
    );
  });

  it("truncates to keep the menu bar usable", () => {
    const long = { ...running, note: "x".repeat(TRAY_LABEL_MAX + 20) };

    const label = formatTrayLabel(long, { fallback: "task", prefix: "none" });

    expect(label).toHaveLength(TRAY_LABEL_MAX);
    expect(label.endsWith("…")).toBe(true);
  });

  it("collapses newlines, which would otherwise break the tray title", () => {
    expect(
      formatTrayLabel({ ...running, note: "line one\nline two" }, { fallback: "task", prefix: "none" }),
    ).toBe("line one line two");
  });
});
