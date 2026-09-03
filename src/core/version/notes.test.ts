import { describe, expect, it } from "vitest";
import { releaseHighlights } from "./notes.js";

/** The real v0.3.0 body, which is what this function was written against. */
const REAL_BODY = `## Download

| | File |
| --- | --- |
| **macOS** — Apple Silicon (M1 and later) | [\`Keito-Timer-0.3.0-Apple-Silicon.dmg\`](https://github.com/chriiiish/keito-desktop/releases/download/v0.3.0/Keito-Timer-0.3.0-Apple-Silicon.dmg) |
| **Windows** | [\`Keito-Timer-0.3.0-Windows.exe\`](https://github.com/chriiiish/keito-desktop/releases/download/v0.3.0/Keito-Timer-0.3.0-Windows.exe) |

The *Source code* archives below are added by GitHub to every release and are not needed to install the app.

## First launch

**macOS** — drag the app to Applications.

## What's Changed
* feat(ci): write the released version back to package.json by @chriiiish in https://github.com/chriiiish/keito-desktop/pull/15
* feat(ci): take the bare version, and name each release run after it by @chriiiish in https://github.com/chriiiish/keito-desktop/pull/16


**Full Changelog**: https://github.com/chriiiish/keito-desktop/compare/v0.2.0...v0.3.0`;

describe("releaseHighlights", () => {
  it("takes only what actually changed, not the download boilerplate", () => {
    // The workflow prepends a download table and first-launch instructions to every
    // release body. The tab has its own download button, so repeating that as raw
    // Markdown would be noise where the changelog should be.
    expect(releaseHighlights(REAL_BODY)).toEqual([
      "feat(ci): write the released version back to package.json",
      "feat(ci): take the bare version, and name each release run after it",
    ]);
  });

  it("drops the by-whom-in-which-PR tail, which is a link the app cannot follow", () => {
    const body = "## What's Changed\n* fix: a thing by @someone in https://example.com/pull/1";
    expect(releaseHighlights(body)).toEqual(["fix: a thing"]);
  });

  it("keeps a line that carries no attribution", () => {
    expect(releaseHighlights("## What's Changed\n* fix: a plain line")).toEqual([
      "fix: a plain line",
    ]);
  });

  it("takes hyphen bullets as well as asterisks", () => {
    expect(releaseHighlights("## What's Changed\n- fix: hyphenated")).toEqual(["fix: hyphenated"]);
  });

  it("stops at the next heading, so a later section is not swept in", () => {
    const body = "## What's Changed\n* fix: kept\n\n## New Contributors\n* @someone made their first contribution";
    expect(releaseHighlights(body)).toEqual(["fix: kept"]);
  });

  it("stops at the Full Changelog line", () => {
    const body = "## What's Changed\n* fix: kept\n\n**Full Changelog**: https://example.com/compare";
    expect(releaseHighlights(body)).toEqual(["fix: kept"]);
  });

  it("is empty when the release has no changelog section to read", () => {
    // Hand-written notes with no "What's Changed" heading, an empty body, or none at all.
    expect(releaseHighlights("## Download\n\nJust the table.")).toEqual([]);
    expect(releaseHighlights("")).toEqual([]);
    expect(releaseHighlights(null)).toEqual([]);
  });

  it("ignores an empty bullet rather than rendering a blank row", () => {
    expect(releaseHighlights("## What's Changed\n* \n* fix: real")).toEqual(["fix: real"]);
  });
});
