/**
 * SemVer precedence, and picking the release to offer.
 *
 * Pure and Electron-free, like everything else under `src/core/` — the caller hands in the
 * releases it fetched. Version ordering is the one part of the update notice worth unit
 * testing: `"0.10.0" < "0.9.0"` as strings, and a naive comparison would quietly stop
 * offering updates the moment a minor version reaches double digits.
 */

/** A parsed version. `prerelease` holds SemVer's dot-separated identifiers, numbers kept as numbers. */
export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: ReadonlyArray<string | number>;
}

/** A numeric identifier: no leading zeros, which SemVer's grammar forbids outright. */
const NUMERIC = /^(0|[1-9]\d*)$/;
/** An alphanumeric identifier — at least one non-digit, so it cannot collide with the above. */
const ALPHANUMERIC = /^[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*$/;

/**
 * A tag as the version it names: no leading `v`, no build metadata.
 *
 * One definition, used both to parse and to produce the string the UI shows, so the two
 * cannot drift into disagreeing about what "0.3.0" is.
 */
export function normaliseVersion(raw: string): string {
  return raw.trim().replace(/^v/, "").split("+", 1)[0] ?? "";
}

/**
 * `1.2.3`, `v1.2.3` or `v1.2.3-beta.1` to a comparable Version; null for anything else.
 *
 * Null rather than a lenient best guess, because the only caller is deciding whether to
 * tell the user an update exists. A tag this cannot read is a release the app cannot
 * reason about, and a notice pointing at nothing is worse than no notice.
 *
 * Build metadata is parsed and then dropped: SemVer states it is ignored for precedence,
 * so keeping it would only invite a comparison that shouldn't exist.
 */
export function parseVersion(raw: string): Version | null {
  const [core, ...rest] = normaliseVersion(raw).split("-");
  // split("-") also breaks up a pre-release containing hyphens ("1.0.0-x-y.1"), so the
  // tail is rejoined rather than taken as a single field.
  const prereleaseRaw = rest.join("-");

  const parts = (core ?? "").split(".");
  if (parts.length !== 3 || !parts.every((part) => NUMERIC.test(part))) return null;
  const [major, minor, patch] = parts.map(Number) as [number, number, number];

  let prerelease: Array<string | number> = [];
  if (rest.length > 0) {
    const identifiers = prereleaseRaw.split(".");
    // An empty identifier — a trailing "-" or a doubled dot — is not a pre-release.
    if (identifiers.some((id) => id === "")) return null;
    for (const id of identifiers) {
      if (NUMERIC.test(id)) prerelease.push(Number(id));
      else if (ALPHANUMERIC.test(id)) prerelease.push(id);
      else return null;
    }
  }

  return { major, minor, patch, prerelease };
}

/**
 * SemVer precedence for the pre-release field: numbers below strings, numbers compared as
 * numbers, strings in ASCII order, and — when one runs out — the longer list wins.
 */
function comparePrerelease(
  a: ReadonlyArray<string | number>,
  b: ReadonlyArray<string | number>,
): number {
  // "A pre-release version has lower precedence than the associated normal version."
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i];
    const right = b[i];
    // "A larger set of fields has a higher precedence than a smaller set, if all of the
    // preceding identifiers are equal."
    if (left === undefined) return -1;
    if (right === undefined) return 1;

    const leftIsNumber = typeof left === "number";
    const rightIsNumber = typeof right === "number";
    if (leftIsNumber && rightIsNumber) {
      if (left !== right) return left < right ? -1 : 1;
    } else if (leftIsNumber !== rightIsNumber) {
      // "Numeric identifiers always have lower precedence than non-numeric identifiers."
      return leftIsNumber ? -1 : 1;
    } else if (left !== right) {
      return (left as string) < (right as string) ? -1 : 1;
    }
  }
  return 0;
}

/** Negative, zero or positive, the way a comparator is expected to answer. Throws on nonsense. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`Not a version: ${!left ? a : b}`);

  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

/**
 * Is `candidate` a version worth telling the user about, given they are on `current`?
 *
 * Unparseable on either side means no. The caller is a notice, not a diagnostic: it can
 * do nothing useful with "there might be an update, or that might be a nightly tag".
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  if (!parseVersion(candidate) || !parseVersion(current)) return false;
  return compareVersions(candidate, current) > 0;
}

/** The fields of a GitHub release this app reads. Everything else on the payload is ignored. */
export interface GitHubRelease {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at?: string | null;
}

/** A release reduced to what the notice and the tab actually render. */
export interface ReleaseSummary {
  version: string;
  tag: string;
  name: string;
  url: string;
  publishedAt: string | null;
  notes: string | null;
}

/**
 * The newest release a user could actually install, or null if there isn't one.
 *
 * **Drafts are excluded; pre-releases are not.** `GET /releases/latest` would be the
 * obvious call and it answers 404 here, because it excludes both — and this project
 * publishes every release as a pre-release while its drafts are the unpublished ones. A
 * draft is invisible to anyone without write access, so offering it would point users at
 * a 404; a pre-release is the thing on the download page today.
 *
 * Sorted by version rather than trusting the order GitHub returns: `/releases` is ordered
 * by creation date, which stops matching version order the moment a patch is cut for an
 * older line. Tags that are not versions are skipped rather than failing the check, so one
 * `nightly` tag cannot switch the feature off.
 */
export function pickLatestRelease(releases: readonly GitHubRelease[]): ReleaseSummary | null {
  let best: ReleaseSummary | null = null;
  for (const release of releases) {
    if (release.draft) continue;
    const parsed = parseVersion(release.tag_name);
    if (!parsed) continue;
    const version = normaliseVersion(release.tag_name);
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = {
      version,
      tag: release.tag_name,
      // A release published without a name shows its tag, which is what GitHub does too.
      name: release.name || release.tag_name,
      url: release.html_url,
      publishedAt: release.published_at ?? null,
      notes: release.body || null,
    };
  }
  return best;
}
