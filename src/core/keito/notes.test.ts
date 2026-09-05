import { describe, expect, it } from "vitest";
import { noteFor, visibleNote, visibleNoteField } from "./notes.js";

describe("visibleNote", () => {
  it("shows the client-visible note when there is one", () => {
    expect(visibleNote({ notes: "Sprint planning", internal_notes: "Chasing Bob" })).toBe(
      "Sprint planning",
    );
  });

  it("falls back to the internal note when there is no client one", () => {
    expect(visibleNote({ notes: null, internal_notes: "Chasing Bob" })).toBe("Chasing Bob");
  });

  it("treats whitespace as no note at all", () => {
    // Otherwise an entry reads as blank while an internal note sits behind it.
    expect(visibleNote({ notes: "   ", internal_notes: "Chasing Bob" })).toBe("Chasing Bob");
  });

  it("is empty when neither has anything", () => {
    expect(visibleNote({ notes: null })).toBe("");
    expect(visibleNote({ notes: "", internal_notes: "  " })).toBe("");
  });

  it("copes with a response that omits internal notes entirely", () => {
    // An older workspace, or an endpoint that does not return the field.
    expect(visibleNote({ notes: "Sprint planning" })).toBe("Sprint planning");
    expect(visibleNote({ notes: null })).toBe("");
  });
});

describe("visibleNoteField", () => {
  it("says where the shown note came from", () => {
    expect(visibleNoteField({ notes: "Sprint planning", internal_notes: "x" })).toBe("client");
    expect(visibleNoteField({ notes: null, internal_notes: "Chasing Bob" })).toBe("internal");
  });

  it("calls an entry with no note at all client-visible", () => {
    // Typing into an untouched row should produce a client note, which is the default.
    expect(visibleNoteField({ notes: null })).toBe("client");
  });

  it("is what stops an edit republishing an internal note", () => {
    // The entries table edits what it displays. Writing a corrected internal note back as
    // `notes` would hand it to the client, silently.
    const entry = { notes: "", internal_notes: "Chasing Bob about the invoice" };

    expect(visibleNote(entry)).toBe("Chasing Bob about the invoice");
    expect(visibleNoteField(entry)).toBe("internal");
  });
});

describe("noteFor", () => {
  it("sends a client note as notes", () => {
    expect(noteFor("client", "Sprint planning")).toEqual({ notes: "Sprint planning" });
  });

  it("sends an internal note as internal_notes, and never as notes", () => {
    // The failure that actually matters: an internal note reaching `notes` is published.
    const sent = noteFor("internal", "Chasing Bob");

    expect(sent).toEqual({ internalNotes: "Chasing Bob" });
    expect(sent).not.toHaveProperty("notes");
  });

  it("trims what it sends", () => {
    expect(noteFor("client", "  Sprint planning  ")).toEqual({ notes: "Sprint planning" });
  });

  it("sends neither field for an empty note", () => {
    for (const note of ["", "   ", undefined]) {
      expect(noteFor("client", note), String(note)).toEqual({});
      expect(noteFor("internal", note), String(note)).toEqual({});
    }
  });
});
