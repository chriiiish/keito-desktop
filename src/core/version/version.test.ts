import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isNewerVersion,
  normaliseVersion,
  parseVersion,
  pickLatestRelease,
} from "./version.js";

describe("parseVersion", () => {
  it("takes a bare version", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it("takes the v prefix a tag carries", () => {
    expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it("keeps pre-release identifiers, split on the dots", () => {
    expect(parseVersion("v1.2.3-beta.1")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["beta", 1],
    });
  });

  it("discards build metadata, which SemVer says has no bearing on precedence", () => {
    expect(parseVersion("1.2.3+20260903")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
  });

  it("returns null rather than a plausible-looking guess for a non-version", () => {
    for (const raw of ["", "v", "1.2", "1.2.3.4", "latest", "1.2.x", "v1.2.3-", "1.2.3-beta..1"]) {
      expect(parseVersion(raw), raw).toBeNull();
    }
  });

  it("rejects leading zeros, which SemVer's numeric identifiers do not allow", () => {
    expect(parseVersion("1.02.3")).toBeNull();
  });
});

describe("normaliseVersion", () => {
  it("is the one definition of what a tag's version string is", () => {
    // Shared by the parser and by the summary the UI renders, so the two cannot drift
    // into disagreeing about what "0.3.0" is.
    expect(normaliseVersion("v1.2.3")).toBe("1.2.3");
    expect(normaliseVersion(" 1.2.3 ")).toBe("1.2.3");
    expect(normaliseVersion("v1.2.3+build.5")).toBe("1.2.3");
    expect(normaliseVersion("v1.2.3-rc.1")).toBe("1.2.3-rc.1");
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.3.0", "1.2.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.4", "1.2.3")).toBeGreaterThan(0);
  });

  it("compares numerically, not as strings", () => {
    // The whole reason this module exists: "0.10.0" < "0.9.0" lexically.
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.0")).toBeGreaterThan(0);
  });

  it("counts equal versions as equal, however they were written", () => {
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3+build", "1.2.3")).toBe(0);
  });

  it("ranks a pre-release below the release it precedes", () => {
    expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.2.3-beta.1")).toBeGreaterThan(0);
  });

  it("orders pre-release identifiers numerically where they are numbers", () => {
    expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.9")).toBeGreaterThan(0);
  });

  it("ranks a numeric identifier below an alphanumeric one", () => {
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
  });

  it("ranks more pre-release fields above fewer when the leading ones match", () => {
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha")).toBeGreaterThan(0);
  });

  it("walks the whole SemVer precedence example", () => {
    const ascending = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let i = 1; i < ascending.length; i++) {
      expect(compareVersions(ascending[i]!, ascending[i - 1]!), ascending[i]).toBeGreaterThan(0);
    }
  });
});

describe("isNewerVersion", () => {
  it("is true only when the candidate is genuinely ahead", () => {
    expect(isNewerVersion("0.3.0", "0.2.0")).toBe(true);
    expect(isNewerVersion("0.3.0", "0.3.0")).toBe(false);
    expect(isNewerVersion("0.2.0", "0.3.0")).toBe(false);
  });

  it("does not offer a pre-release as an update to the release it precedes", () => {
    expect(isNewerVersion("1.0.0-rc.1", "1.0.0")).toBe(false);
  });

  it("says no when either side is unparseable, rather than nagging about nothing", () => {
    // A tag that does not parse is a release this app cannot reason about. Claiming an
    // update on the strength of one would show a notice pointing at nothing.
    expect(isNewerVersion("not-a-version", "0.3.0")).toBe(false);
    expect(isNewerVersion("0.4.0", "not-a-version")).toBe(false);
  });
});

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  name: tag,
  html_url: `https://github.com/chriiiish/keito-desktop/releases/tag/${tag}`,
  draft: false,
  prerelease: false,
  published_at: "2026-09-03T00:00:00Z",
  ...extra,
});

describe("pickLatestRelease", () => {
  it("takes the highest version, not the first in the list", () => {
    // GitHub orders /releases by creation date, which is not the same as version order
    // once a patch is cut for an older line.
    const picked = pickLatestRelease([release("v0.2.1"), release("v0.3.0"), release("v0.2.0")]);
    expect(picked?.version).toBe("0.3.0");
  });

  it("skips drafts, which are not downloadable by anyone else", () => {
    const picked = pickLatestRelease([release("v0.4.0", { draft: true }), release("v0.3.0")]);
    expect(picked?.version).toBe("0.3.0");
  });

  it("keeps pre-releases, which are what this project actually publishes", () => {
    const picked = pickLatestRelease([release("v0.3.0", { prerelease: true })]);
    expect(picked?.version).toBe("0.3.0");
  });

  it("ignores tags that are not versions rather than failing the whole check", () => {
    const picked = pickLatestRelease([release("nightly"), release("v0.3.0")]);
    expect(picked?.version).toBe("0.3.0");
  });

  it("returns null when nothing is published", () => {
    expect(pickLatestRelease([])).toBeNull();
    expect(pickLatestRelease([release("v0.4.0", { draft: true })])).toBeNull();
  });

  it("carries the page to open and the name to show", () => {
    const picked = pickLatestRelease([release("v0.3.0", { name: "0.3.0" })]);
    expect(picked).toEqual({
      version: "0.3.0",
      tag: "v0.3.0",
      name: "0.3.0",
      url: "https://github.com/chriiiish/keito-desktop/releases/tag/v0.3.0",
      publishedAt: "2026-09-03T00:00:00Z",
      notes: null,
    });
  });

  it("falls back to the tag when a release was published without a name", () => {
    expect(pickLatestRelease([release("v0.3.0", { name: null })])?.name).toBe("v0.3.0");
  });
});
