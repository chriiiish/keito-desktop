import { describe, expect, it } from "vitest";
import { scrollTopFor } from "./scroll.js";

/** A list showing 100px of rows 25px tall — four at a time. */
const view = (scrollTop: number) => ({ scrollTop, height: 100 });
const row = (index: number) => ({ top: index * 25, height: 25 });

describe("scrollTopFor", () => {
  it("does not move for a row already in view", () => {
    expect(scrollTopFor(row(0), view(0))).toBeNull();
    expect(scrollTopFor(row(3), view(0))).toBeNull();
  });

  it("brings a row below the fold up to the bottom edge", () => {
    // Row 4 spans 100–125 with 0–100 visible: the least that works is scrolling by 25.
    expect(scrollTopFor(row(4), view(0))).toBe(25);
  });

  it("moves one row at a time, rather than leaping", () => {
    // The bug this exists for was the list not moving at all; over-correcting into a
    // half-page jump per keypress would be its own kind of unusable.
    expect(scrollTopFor(row(5), view(25))).toBe(50);
    expect(scrollTopFor(row(6), view(50))).toBe(75);
  });

  it("brings a row above the fold down to the top edge", () => {
    // Arrowing back up: row 1 starts at 25, and the list is scrolled past it.
    expect(scrollTopFor(row(1), view(50))).toBe(25);
  });

  it("shows the top of a row taller than the list, not its bottom", () => {
    expect(scrollTopFor({ top: 0, height: 300 }, view(0))).toBeNull();
    expect(scrollTopFor({ top: 200, height: 300 }, view(0))).toBe(200);
  });

  it("handles the first and last rows without going out of bounds", () => {
    expect(scrollTopFor(row(0), view(75))).toBe(0);
    expect(scrollTopFor(row(9), view(0))).toBe(150);
  });

  it("does nothing for a list with nothing to scroll", () => {
    expect(scrollTopFor({ top: 0, height: 25 }, { scrollTop: 0, height: 500 })).toBeNull();
  });
});
