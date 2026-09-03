import { pickLatestRelease, type GitHubRelease, type ReleaseSummary } from "../src/core/version/version.js";
import type { Logger } from "./logger.js";

/**
 * Asks GitHub what the newest release is.
 *
 * Deliberately thin: every decision this feature makes — which release counts, whether it
 * is newer than what is installed — lives in `src/core/version`, where it is unit tested.
 * What is left here is the I/O, which CLAUDE.md keeps out of `src/core/` and verifies by
 * running rather than by mocking a `fetch`.
 *
 * This is a notice, not an updater. `electron-updater` is not a dependency and the release
 * workflow deliberately does not upload the `.blockmap` and `latest*.yml` files that exist
 * only to feed it. Auto-update on macOS needs a Developer ID signature whichever library
 * does it, and these builds are ad-hoc signed — so pointing the user at the download page
 * is the honest ceiling here.
 */

const RELEASES_URL = "https://api.github.com/repos/chriiiish/keito-desktop/releases?per_page=30";

/**
 * Once a day. The app is a tray app that runs for weeks, so a launch-only check would
 * never see a release cut after startup; anything more frequent spends requests on a page
 * that changes a handful of times a year. GitHub allows 60 unauthenticated requests an
 * hour per IP and this asks for one a day.
 */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60_000;

/** Long enough for a slow connection, short enough that startup is never held up by it. */
const TIMEOUT_MS = 10_000;

/**
 * The newest installable release, or null if the check could not answer.
 *
 * Never throws. A missing update is indistinguishable from a failed lookup as far as the
 * UI is concerned — both mean "show nothing" — and an unreachable GitHub must not surface
 * as an error banner over a timer that is working perfectly well.
 */
export async function fetchLatestRelease(log: Logger): Promise<ReleaseSummary | null> {
  try {
    const response = await fetch(RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        // GitHub answers 403 to an API request with no User-Agent. A browser sets one;
        // `fetch` in the main process does not.
        "User-Agent": "keito-timer",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // 403 with a rate-limit body is the expected failure on a shared IP. Logged rather
      // than shown: there is nothing the user can do about it and nothing is broken.
      log.warn(`Update check: GitHub answered ${response.status}`);
      return null;
    }

    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      log.warn("Update check: /releases did not answer with a list");
      return null;
    }

    return pickLatestRelease(body as GitHubRelease[]);
  } catch (error) {
    log.warn(`Update check failed: ${String(error)}`);
    return null;
  }
}
