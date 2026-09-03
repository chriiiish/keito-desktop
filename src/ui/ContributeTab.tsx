import type { Snapshot } from "../../electron/service.js";
import { AsyncButton } from "./AsyncButton.js";
import { keito } from "./keito-api.js";

const REPO = "https://github.com/chriiiish/keito-desktop";
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
 * Where to find the project, and the two ways to help with it.
 *
 * Money first, then code, then the build details.
 *
 * Money leads because it is the ask almost everyone reading this can actually act on:
 * putting something in the tip jar takes one click, whereas opening a pull request takes
 * an afternoon. Ordering the page by how many people can say yes puts the smallest ask at
 * the top. The build details go last because they are not a contribution at all — they are
 * what you copy into a bug report once you have decided to file one.
 *
 * The lead paragraph carries no heading of its own. "Not an official Keito product" is
 * context for the whole tab rather than a section of it, and it has to be read before
 * either ask makes sense.
 */
export function ContributeTab({ snapshot }: { snapshot: Snapshot }): JSX.Element {
  const open = (url: string) => keito.openExternal(url);

  return (
    <section className="settings contribute">
      <p className="hint">
        Keito Timer is free and open source. It is not an official Keito product — it is a
        small app built on Keito’s public API, and anyone is welcome to read it, change it,
        or take it apart to see how it works.
      </p>

      <h2>Say thanks</h2>
      <p className="hint">
        Keito Timer is free, and will stay that way. If it saves you the daily fight with a
        browser tab, you can put something in the tip jar.
      </p>
      <AsyncButton className="coffee" onClick={() => open(COFFEE)}>
        ☕ Buy me a coffee
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
        The domain logic lives in <code>src/core/</code> and runs under <code>npm test</code>{" "}
        in seconds, with no window and no network — so a change is quick to make and quick to
        prove. There is a separate contract suite that runs against the real Keito API when
        you have a key.
      </p>
      <p className="hint">
        Bug reports are much easier to act on with a log attached. API keys are masked in it.
      </p>
      <AsyncButton onClick={() => keito.openLog()}>Open log file</AsyncButton>

      <h2>This build</h2>
      <dl className="build-info">
        <dt>Version</dt>
        <dd>{snapshot.appVersion}</dd>
        <dt>Platform</dt>
        <dd>{snapshot.platform}</dd>
      </dl>
    </section>
  );
}
