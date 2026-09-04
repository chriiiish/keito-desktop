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
      {/*
        A real heading rather than a `.settings h2`, which is a small uppercase section
        label — as one, the most important sentence on the tab rendered smaller and fainter
        than the body text under it. The h2s below keep that label role for the sections.
      */}
      <h1 className="update-lead">Keito Timer {update.name} is available</h1>
      <p className="hint">
        You are running {snapshot.appVersion}
        {published ? `. ${update.name} was published on ${published}.` : "."}<br/>
        Click below to be taken to the latest download page
      </p>

      <AsyncButton className="primary" onClick={() => keito.openExternal(update.url)}>
        Download {update.name} ↗
      </AsyncButton>

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
