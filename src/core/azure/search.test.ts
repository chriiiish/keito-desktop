import { describe, expect, it } from "vitest";
import { searchWorkItems, WORK_ITEM_SUGGESTIONS } from "./search.js";
import type { WorkItem } from "./types.js";

const item = (id: number, title: string): WorkItem => ({ id, title, type: "Task", state: "Active" });

const items: WorkItem[] = [
  item(1234, "Fix the login redirect"),
  item(1240, "Login page copy"),
  item(88, "Rework the timesheet export"),
  item(91, "Add a login audit trail"),
];

describe("searchWorkItems", () => {
  it("shows the most recent items when nothing has been typed", () => {
    // The list arrives newest-changed first, so untouched it is already the right answer.
    expect(searchWorkItems(items, "").map((i) => i.id)).toEqual([1234, 1240, 88, 91]);
  });

  it("finds a work item by the id someone typed", () => {
    expect(searchWorkItems(items, "1234").map((i) => i.id)).toEqual([1234]);
  });

  it("puts an id match above a title match, since a bare number means the id", () => {
    // "88" is the id of one item; nothing else should outrank it.
    expect(searchWorkItems(items, "88").map((i) => i.id)[0]).toBe(88);
  });

  it("matches a partial id from the start", () => {
    expect(searchWorkItems(items, "12").map((i) => i.id)).toEqual([1234, 1240]);
  });

  it("matches titles case-insensitively", () => {
    expect(searchWorkItems(items, "LOGIN").map((i) => i.id)).toEqual([1240, 1234, 91]);
  });

  it("ranks a title that starts with the query above one that merely contains it", () => {
    const results = searchWorkItems(items, "login");
    expect(results[0]!.id).toBe(1240);
  });

  it("keeps the server's order within a rank", () => {
    // 1234 and 91 both merely contain "login"; 1234 came back first and stays first.
    const results = searchWorkItems(items, "login").map((i) => i.id);
    expect(results.indexOf(1234)).toBeLessThan(results.indexOf(91));
  });

  it("says nothing rather than guessing when nothing matches", () => {
    expect(searchWorkItems(items, "kubernetes")).toEqual([]);
  });

  it("ignores surrounding whitespace", () => {
    expect(searchWorkItems(items, "  1234  ").map((i) => i.id)).toEqual([1234]);
  });

  it("caps the list so the dropdown cannot run off the popover", () => {
    const many = Array.from({ length: 50 }, (_, i) => item(i + 1, `Item ${i + 1}`));
    expect(searchWorkItems(many, "")).toHaveLength(WORK_ITEM_SUGGESTIONS);
    expect(searchWorkItems(many, "item")).toHaveLength(WORK_ITEM_SUGGESTIONS);
  });
});
