import { describe, expect, it } from "vitest";
import { noteWorkItemId, workItemNote } from "./note.js";

describe("workItemNote", () => {
  it("leads with the id, which survives the tray label truncating the title", () => {
    expect(workItemNote({ id: 1234, title: "Fix the login redirect" })).toBe(
      "1234: Fix the login redirect",
    );
  });

  it("trims a title that arrives padded", () => {
    expect(workItemNote({ id: 7, title: "  Tidy up  " })).toBe("7: Tidy up");
  });

  it("is just the id when a work item has no title worth showing", () => {
    // Never "1234: " with a dangling separator.
    expect(workItemNote({ id: 1234, title: "   " })).toBe("1234");
  });
});

describe("noteWorkItemId", () => {
  it("reads back the id it wrote", () => {
    expect(noteWorkItemId("1234: Fix the login redirect")).toBe(1234);
  });

  it("is null for a note nobody wrote from a ticket", () => {
    for (const note of ["Fix the login redirect", "", "1234", "1234:no space", "#1234: x"]) {
      expect(noteWorkItemId(note), note).toBeNull();
    }
  });
});
