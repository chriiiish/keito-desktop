import { useState } from "react";
import type { Snapshot } from "../../electron/service.js";
import { AsyncButton, useAsyncAction } from "./AsyncButton.js";
import { AzureLogo } from "./AzureLogo.js";
import { Toggle } from "./Toggle.js";
import { keito } from "./keito-api.js";

/** Other services this app can read from. Azure DevOps is the only one so far. */
export function IntegrationsTab({
  snapshot,
  onChange,
}: {
  snapshot: Snapshot;
  onChange: (next: Snapshot) => void;
}): JSX.Element {
  const azure = snapshot.azure;

  return (
    <section className="settings integrations">
      <h2>Azure DevOps</h2>
      <p className="hint">
        Put a work item in the note without typing it. With this on, the note field lists
        the open work items assigned to you — start typing to search them, or press{" "}
        <kbd>↓</kbd> to see the list. A note is still just a note if you would rather type
        one.
      </p>

      <div className="integration-row">
        <Toggle
          checked={azure.enabled}
          onChange={(next) => keito.setAzureEnabled(next).then(onChange)}
          label="Azure DevOps"
        />
        <AzureLogo className={azure.status === "connected" ? "" : "muted"} />
        <span className={`integration-status ${azure.status}`}>
          {azure.status === "connected"
            ? `Connected${azure.organisationUrl ? ` — ${organisationName(azure.organisationUrl)}` : ""}`
            : azure.status === "error"
              ? "Not connected"
              : azure.status === "needs-token"
                ? "Needs a personal access token"
                : "Off"}
        </span>
      </div>

      {azure.enabled && <AzureConnectionForm snapshot={snapshot} onChange={onChange} />}
    </section>
  );
}

/** "https://dev.azure.com/acme" reads better in a status line as just "acme". */
function organisationName(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

function AzureConnectionForm({
  snapshot,
  onChange,
}: {
  snapshot: Snapshot;
  onChange: (next: Snapshot) => void;
}): JSX.Element {
  const azure = snapshot.azure;
  const [token, setToken] = useState("");
  const [url, setUrl] = useState(azure.organisationUrl ?? "");

  const [connecting, connect] = useAsyncAction(async () => {
    const next = await keito.connectAzure(token.trim(), url.trim());
    onChange(next);
    // A working connection has no further use for the token, and the renderer never gets
    // it back — so the box is emptied rather than left holding a credential.
    if (next.azure.status === "connected") setToken("");
    if (next.azure.organisationUrl) setUrl(next.azure.organisationUrl);
  });

  return (
    <form
      className="connect azure-connect"
      onSubmit={(event) => {
        event.preventDefault();
        void connect();
      }}
    >
      <h3>What the token needs</h3>
      <ul className="scope-list">
        <li>
          <strong>Work Items (Read)</strong> — that is the whole list. Nothing is written
          back to Azure DevOps; this only ever reads.
        </li>
      </ul>
      <p className="hint">
        In Azure DevOps: your profile menu → <strong>User settings</strong> →{" "}
        <strong>Personal access tokens</strong> → <strong>New Token</strong>.
      </p>

      <label>
        Organisation URL
        <input
          placeholder="https://dev.azure.com/your-org"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>

      <label>
        Personal access token
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={azure.hasToken ? "A token is stored — enter a new one to replace it" : ""}
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>

      {azure.error && <p className="error">{azure.error}</p>}

      <div className="connect-actions">
        <button
          type="submit"
          aria-busy={connecting}
          disabled={connecting || !token.trim() || !url.trim()}
        >
          {connecting ? "Connecting…" : "Connect"}
        </button>
        {azure.hasToken && (
          <AsyncButton
            className="link muted"
            onClick={() => keito.disconnectAzure().then(onChange)}
          >
            Disconnect
          </AsyncButton>
        )}
      </div>

      {azure.status === "connected" && (
        <p className="hint">
          {azure.workItems.length === 1
            ? "1 work item assigned to you."
            : `${azure.workItems.length} work items assigned to you.`}{" "}
          The list refreshes every 10 minutes.
        </p>
      )}
    </form>
  );
}
