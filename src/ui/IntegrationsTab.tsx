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

  /**
   * Collapsed to start with, like a project in Projects.
   *
   * Almost every visit to this tab is not about setting an integration up — it is already
   * set up, or deliberately off — so the scopes, the instructions and two credential
   * fields are a wall in front of the one thing worth seeing at a glance: whether the
   * thing is working. The row says that; the panel is there when you want it.
   */
  const [open, setOpen] = useState(false);

  /**
   * Switched on but not working: no token yet, or one Azure has stopped accepting.
   *
   * Worth a mark on the collapsed row precisely because it is collapsed — an integration
   * that has quietly stopped feeding the note field would otherwise look identical to one
   * that is fine, and the first you would know is tickets no longer appearing.
   */
  const needsAttention = azure.enabled && (azure.status === "needs-token" || azure.status === "error");

  return (
    <section className="settings integrations">
      {/*
        A card, so an integration reads as one object rather than as a line of controls
        floating on the page — and so that expanding it visibly grows *that* thing rather
        than pushing loose text down the tab. The next integration is another card.
      */}
      <div className="integration-card">
        <div className="integration-row">
          {/*
            The switch leads, because whether this is on is the first thing about it and
            the only control that works while the section is shut. The name and its state
            follow, which is the order the row is read in.
          */}
          <Toggle
            checked={azure.enabled}
            onChange={(next) => keito.setAzureEnabled(next).then(onChange)}
            label="Azure DevOps"
          />
          <button
          type="button"
          className="disclosure"
          aria-expanded={open}
          aria-controls="azure-panel"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
        >
          <span className="chevron" aria-hidden="true">
            ▸
          </span>
          <AzureLogo className={azure.status === "connected" ? "" : "muted"} />
          <span className="integration-name">Azure DevOps</span>
          {needsAttention && (
            <span
              className="integration-alert"
              role="img"
              aria-label={
                azure.status === "error"
                  ? "Azure DevOps is not connected"
                  : "Azure DevOps is not set up"
              }
              title={azure.error ?? "Switched on, but not connected yet."}
            >
              !
            </span>
          )}
        </button>

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

        <div id="azure-panel" hidden={!open}>
          <p className="hint">
            Put a work item in the note without typing it. With this on, the note field
            lists the open work items assigned to you — start typing to search them, or
            press <kbd>↓</kbd> to see the list. A note is still just a note if you would
            rather type one.
          </p>

          {azure.enabled && <AzureConnectionForm snapshot={snapshot} onChange={onChange} />}
        </div>
      </div>
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

  /**
   * One rule for whether Connect can run, used by the button and by the form.
   *
   * Submitting a form is not only pressing its button — Enter in a text field does it too,
   * and that route ignores `disabled`. Without this, Enter on an empty form fired an IPC
   * call and an avoidable error.
   */
  const canConnect = Boolean(token.trim() && url.trim());

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
        if (!canConnect || connecting) return;
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
          disabled={connecting || !canConnect}
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
