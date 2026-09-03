import type { Snapshot, UpdateStatus } from "../../electron/service.js";
import { releaseHighlights } from "../core/version/notes.js";
import { AsyncButton } from "./AsyncButton.js";
import { keito } from "./keito-api.js";

const REPO = "https://github.com/chriiiish/keito-desktop";

/** What the user is running, what is out, and where to get it. */
export function UpdateTab({
  snapshot,
  update,
}: {
  snapshot: Snapshot;
  update: UpdateStatus;
}): JSX.Element {
  // Only the "What's Changed" list — the rest of the body is the download table and
  // install instructions the workflow writes, which this tab replaces rather than repeats.
  const highlights = releaseHighlights(update.notes);

  const published = update.publishedAt
    ? new Date(update.publishedAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <section className="settings update-tab">
      <h2>Keito Timer {update.name} is available</h2>
      <p className="hint">
        You are running {snapshot.appVersion}
        {published ? `. ${update.name} was published on ${published}.` : "."}
      </p>

      <AsyncButton className="primary" onClick={() => keito.openExternal(update.url)}>
        Download {update.name} ↗
      </AsyncButton>

      <p className="hint">
        {/*
          Not an auto-updater, and saying so is kinder than leaving the user to wonder why
          nothing installed itself. These builds are ad-hoc signed rather than notarised,
          and macOS refuses to apply an update to an app it cannot verify — so the download
          page is where this honestly ends.
        */}
        Downloading replaces the app by hand: the installer overwrites the copy you have,
        and your settings, favourites and API key are kept. Keito Timer does not update
        itself.
      </p>

      {highlights.length > 0 && (
        <>
          <h2>What changed</h2>
          {/*
            The lines are shown as text rather than Markdown. The release body is content
            this app did not write, and rendering arbitrary remote markup is a bigger
            commitment than a notice warrants — the release page is one click away for the
            formatted version.
          */}
          <ul className="release-notes">
            {highlights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}

      <h2>All releases</h2>
      <p className="hint">
        Every release, including older ones and their installers, is on the releases page.
      </p>
      <AsyncButton className="link" onClick={() => keito.openExternal(`${REPO}/releases`)}>
        Browse all releases ↗
      </AsyncButton>
    </section>
  );
}
