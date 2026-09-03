import type { Snapshot } from "../../electron/service.js";
import { AsyncButton } from "./AsyncButton.js";
import { keito } from "./keito-api.js";

const REPO = "https://github.com/chriiiish/keito-desktop";
const LICENCE = `${REPO}/blob/main/LICENSE`;
const COFFEE = "https://buymeacoffee.com/chris.lloyd";

const LINKS: ReadonlyArray<readonly [string, string, string]> = [
  ["Browse the source", REPO, "Every line of this app, including the tests."],
  [
    "Report a bug or ask for a feature",
    `${REPO}/issues`,
    "Issues are the best place for anything that is broken or missing.",
  ],
  [
    "Open a pull request",
    `${REPO}/pulls`,
    "Fixes and features are welcome — see the README for how to run it locally.",
  ],
];

/**
 * What this app is, what you may do with it, and the two ways to help.
 *
 * Licence first, then money, then code, then the build details.
 *
 * The licence leads because it is the question a stranger arrives with — what am I allowed
 * to do with this? — and because a GPL app that never says so anywhere in its own interface
 * is asking to be misunderstood. It is also the shortest section, so it costs the asks
 * below it almost nothing.
 *
 * Money leads because it is the ask almost everyone reading this can actually act on:
 * putting something in the tip jar takes one click, whereas opening a pull request takes
 * an afternoon. Ordering the page by how many people can say yes puts the smallest ask at
 * the top. The build details go last because they are not a contribution at all — they are
 * what you copy into a bug report once you have decided to file one.
 *
 * "Not an official Keito product" sits under the licence heading rather than in a section
 * of its own: what this app is and what you may do with it are the same question, and the
 * disclaimer has to be read before either ask below makes sense.
 */
export function AboutTab({ snapshot }: { snapshot: Snapshot }): JSX.Element {
  const open = (url: string) => keito.openExternal(url);

  return (
    <section className="settings contribute">
      <h2>Licence</h2>
      <p className="hint">
        Released under the <strong>GNU General Public License v3.0</strong>. Use it at home
        or at work, including work you bill for. Share a modified version and you share your
        source under the same licence, so whoever gets it has the freedoms you did.
      </p>
      <AsyncButton className="link contribute-link" onClick={() => open(LICENCE)}>
        Read the licence ↗
      </AsyncButton>
      <p className="hint">
        Keito Timer is free and open source. It is not an official Keito product — it is a
        small app built on Keito’s public API, and anyone is welcome to read it, change it,
        or take it apart to see how it works.
      </p>

      <h2>Say thanks</h2>
      <p className="hint">
        Keito Timer is free. If it saves you the daily fight with a
        browser tab, you can put something in the tip jar.
      </p>
      <AsyncButton className="coffee" onClick={() => open(COFFEE)}>
        ☕ Buy me a hot chocolate
      </AsyncButton>

      <h2>Open source</h2>
      <ul className="contribute-links">
        {LINKS.map(([label, url, blurb]) => (
          <li key={url}>
            <AsyncButton className="link contribute-link" onClick={() => open(url)}>
              {label} ↗
            </AsyncButton>
            <span className="hint">{blurb}</span>
          </li>
        ))}
      </ul>
      <p className="hint">
        Bug reports are much easier to act on with a log attached. API keys are masked in it.
      </p>
      <AsyncButton onClick={() => keito.openLog()}>Open log file</AsyncButton>

      <h2>About this build</h2>
      <dl className="build-info">
        <dt>Version</dt>
        <dd>{snapshot.appVersion}</dd>
        <dt>Platform</dt>
        <dd>{snapshot.platform}</dd>
      </dl>
    </section>
  );
}
