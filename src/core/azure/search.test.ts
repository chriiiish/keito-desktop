import { describe, expect, it } from "vitest";
import { searchWorkItems } from "./search.js";
import type { WorkItem } from "./types.js";

/** `day` is the September date it last changed, so recency is readable in the fixtures. */
const item = (id: number, title: string, day: number | null = 1): WorkItem => ({
  id,
  title,
  project: "Acme Web",
  state: "Active",
  changedDate: day === null ? null : `2026-09-${String(day).padStart(2, "0")}T09:00:00Z`,
});

// Deliberately not in date order, so nothing can pass by preserving the input.
const items: WorkItem[] = [
  item(1234, "Fix the login redirect", 2),
  item(1240, "Login page copy", 5),
  item(88, "Rework the timesheet export", 9),
  item(91, "Add a login audit trail", 7),
];

describe("searchWorkItems", () => {
  it("lists everything most recently updated first when nothing has been typed", () => {
    expect(searchWorkItems(items, "").map((i) => i.id)).toEqual([88, 91, 1240, 1234]);
  });

  it("orders matches by most recently updated, not by how well they matched", () => {
    // An earlier version ranked id matches above title-prefix matches above substring
    // matches, so typing reshuffled the list into an order that changed with every
    // keystroke. One rule beats a cleverer one nobody can predict.
    expect(searchWorkItems(items, "login").map((i) => i.id)).toEqual([91, 1240, 1234]);
  });

  it("finds a work item by the id someone typed", () => {
    expect(searchWorkItems(items, "1234").map((i) => i.id)).toEqual([1234]);
  });

  it("matches a partial id", () => {
    expect(searchWorkItems(items, "12").map((i) => i.id)).toEqual([1240, 1234]);
  });

  it("matches titles case-insensitively", () => {
    expect(searchWorkItems(items, "LOGIN").map((i) => i.id)).toEqual([91, 1240, 1234]);
  });

  it("ignores surrounding whitespace", () => {
    expect(searchWorkItems(items, "  1234  ").map((i) => i.id)).toEqual([1234]);
  });

  it("says nothing rather than guessing when nothing matches", () => {
    expect(searchWorkItems(items, "kubernetes")).toEqual([]);
  });

  it("puts an item with no date last rather than at the top", () => {
    const withUndated = [item(1, "Undated", null), item(2, "Dated", 1)];

    expect(searchWorkItems(withUndated, "").map((i) => i.id)).toEqual([2, 1]);
  });

  it("does not reorder the list it was given", () => {
    // A pure function that sorts its argument in place would quietly reorder the Snapshot.
    const original = [...items];

    searchWorkItems(items, "");

    expect(items).toEqual(original);
  });

  it("offers everything that matches, because the list is for browsing", () => {
    // Truncating is right for a shortcut to something you already know the name of, and
    // wrong for the only way to see what is assigned to you. The list scrolls instead.
    const many = Array.from({ length: 50 }, (_, i) => item(i + 1, `Item ${i + 1}`));

    expect(searchWorkItems(many, "")).toHaveLength(50);
    expect(searchWorkItems(many, "item")).toHaveLength(50);
  });

  it("still honours a limit when one is asked for", () => {
    const many = Array.from({ length: 50 }, (_, i) => item(i + 1, `Item ${i + 1}`));

    expect(searchWorkItems(many, "", 5)).toHaveLength(5);
  });
});
