import type { Snapshot } from "../../electron/service.js";
import { AsyncButton } from "./AsyncButton.js";
import { keito } from "./keito-api.js";

const REPO = "https://github.com/chriiiish/kieto-desktop";
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

/** Where to find the project, and how to help with it. */
export function ContributeTab({ snapshot }: { snapshot: Snapshot }): JSX.Element {
  const open = (url: string) => keito.openExternal(url);

  return (
    <section className="settings contribute">
      <h2>Open source</h2>
      <p className="hint">
        Keito Timer is free and open source. It is not an official Keito product — it is a
        small app built on Keito’s public API, and anyone is welcome to read it, change it,
        or take it apart to see how it works.
      </p>

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

      <h2>Say thanks</h2>
      <p className="hint">
        Keito Timer is free, and will stay that way. If it saves you the daily fight with a
        browser tab, you can put something in the tip jar.
      </p>
      <AsyncButton className="coffee" onClick={() => open(COFFEE)}>
        ☕ Buy me a coffee
      </AsyncButton>

      <h2>Helping out</h2>
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
