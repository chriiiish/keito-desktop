import { useCallback, useEffect, useState } from "react";
import type { TimeEntry } from "../core/keito/types.js";
import { formatTrayLabel } from "../core/tray/label.js";
import { keito } from "./keito-api.js";
import { VisibleCategories } from "./VisibleCategories.js";
import { useSnapshot } from "./useSnapshot.js";

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** A live example of the menu bar label, using the running timer when there is one. */
function trayPreview(snapshot: NonNullable<ReturnType<typeof useSnapshot>[0]>): string {
  const running = snapshot.timer.status === "running" ? snapshot.timer : null;
  return formatTrayLabel(
    {
      note: running?.note ?? "Sprint planning",
      projectName: running?.pair.projectName ?? "Acme Rebuild",
      taskName: running?.pair.taskName ?? "Development",
    },
    { fallback: snapshot.trayFallback, prefix: snapshot.trayPrefix },
  );
}

function weekStart(today: Date): Date {
  const date = new Date(today);
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - weekday);
  return date;
}

type Tab = "entries" | "visibility" | "settings";

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ["entries", "Entries"],
  ["visibility", "Visible Projects"],
  ["settings", "Settings"],
];

export function ReviewWindow(): JSX.Element {
  const [snapshot, setSnapshot] = useSnapshot();
  const [tab, setTab] = useState<Tab>("entries");

  if (!snapshot) return <div className="window loading">Loading…</div>;

  // Nothing but Settings can do anything useful without a working key.
  const active: Tab = snapshot.keyStatus === "ready" ? tab : "settings";

  return (
    <div className="window">
      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={active === id ? "on" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {active === "entries" && <Entries revision={snapshot.revision} />}
      {active === "visibility" && (
        <section className="settings">
          <h2>Categories in the dropdown</h2>
          <p className="hint">
            Everything is shown by default. Switch off what you never track against.
            Favourites and anything you have used in the last 30 days stay visible regardless.
          </p>
          <VisibleCategories snapshot={snapshot} onChange={setSnapshot} />
        </section>
      )}
      {active === "settings" && <Settings snapshot={snapshot} onChange={setSnapshot} />}
    </div>
  );
}

/**
 * `revision` moves whenever anything changed server-side — a timer started from the
 * popover, a stop, a delete. Reloading on it is what keeps this table from going stale
 * until it happens to be remounted.
 */
function Entries({ revision }: { revision: number }): JSX.Element {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [range, setRange] = useState<"today" | "week">("today");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const today = new Date();
    const from = range === "today" ? isoDate(today) : isoDate(weekStart(today));
    try {
      setEntries(await keito.listEntries(from, isoDate(today)));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [range]);

  useEffect(() => void load(), [load, revision]);

  const edit = async (id: string, patch: { notes?: string; startedTime?: string; endedTime?: string }) => {
    try {
      const next = await keito.updateEntry(id, patch);
      setError(next.error);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="entries">
      <div className="range">
        <button className={range === "today" ? "on" : ""} onClick={() => setRange("today")}>
          Today
        </button>
        <button className={range === "week" ? "on" : ""} onClick={() => setRange("week")}>
          This week
        </button>
        <button className="link" onClick={() => void load()}>
          Reload
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Start</th>
            <th>End</th>
            <th>Hours</th>
            <th>Notes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className={entry.is_running ? "running-row" : ""}>
              <td>{entry.spent_date}</td>
              <td>
                <TimeCell
                  value={entry.started_time}
                  onCommit={(value) => void edit(entry.id, { startedTime: value })}
                />
              </td>
              <td>
                {entry.is_running ? (
                  <em>running</em>
                ) : (
                  <TimeCell
                    value={entry.ended_time}
                    onCommit={(value) => void edit(entry.id, { endedTime: value })}
                  />
                )}
              </td>
              <td>{entry.hours?.toFixed(2) ?? "—"}</td>
              <td>
                <input
                  defaultValue={entry.notes ?? ""}
                  placeholder="—"
                  onBlur={(event) => {
                    if (event.target.value !== (entry.notes ?? "")) {
                      void edit(entry.id, { notes: event.target.value });
                    }
                  }}
                />
              </td>
              <td>
                <button
                  className="link danger"
                  onClick={async () => {
                    // Never leave a failed delete looking like a successful one.
                    try {
                      const next = await keito.deleteEntry(entry.id);
                      setError(next.error);
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : String(cause));
                    }
                    await load();
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                Nothing logged {range === "today" ? "today" : "this week"} yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

/** Edits the company id in place, reconnecting on commit. */
function CompanyIdField({
  current,
  onChange,
}: {
  current: string | null;
  onChange: (next: NonNullable<ReturnType<typeof useSnapshot>[0]>) => void;
}): JSX.Element {
  const [value, setValue] = useState(current ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(current ?? ""), [current]);

  const dirty = value.trim() !== (current ?? "");

  return (
    <form
      className="connect inline"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        onChange(await keito.setCompanyId(value));
        setSaving(false);
      }}
    >
      <input value={value} placeholder="co_…" onChange={(event) => setValue(event.target.value)} />
      <button type="submit" disabled={!dirty || !value.trim() || saving}>
        {saving ? "Checking…" : "Apply"}
      </button>
    </form>
  );
}

/** An HH:mm cell that only commits a well-formed time. */
function TimeCell({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (value: string) => void;
}): JSX.Element {
  return (
    <input
      className="time"
      defaultValue={value ?? ""}
      placeholder="HH:mm"
      onBlur={(event) => {
        const next = event.target.value.trim();
        if (next === (value ?? "")) return;
        if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(next)) {
          event.target.value = value ?? "";
          return;
        }
        onCommit(next);
      }}
    />
  );
}

function Settings({
  snapshot,
  onChange,
}: {
  snapshot: NonNullable<ReturnType<typeof useSnapshot>[0]>;
  onChange: (next: NonNullable<ReturnType<typeof useSnapshot>[0]>) => void;
}): JSX.Element {
  const [key, setKey] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <section className="settings">
      <h2>Connection</h2>
      {snapshot.keyStatus === "ready" ? (
        <p className="connected">
          Connected as <strong>{snapshot.identity?.name}</strong> — {snapshot.identity?.accountName}
          <button className="link danger" onClick={() => void keito.signOut().then(onChange)}>
            Disconnect
          </button>
        </p>
      ) : (
        <p className="hint">
          Paste a <strong>full-access integration key</strong> from Keito (Settings → Integrations)
          and your <strong>Company ID</strong>. Both are required — Keito sends the company id on
          every request, so it cannot be detected for you. A personal read-only sync key will not
          work: it cannot create time entries.
        </p>
      )}

      <form
        className="connect"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          onChange(await keito.setApiKey(key, companyId));
          setSaving(false);
          setKey("");
          setCompanyId("");
        }}
      >
        <label>
          API key
          <input
            type="password"
            placeholder="kto_…"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <label>
          Company ID
          <input
            placeholder="Required — from your Keito account settings"
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
          />
        </label>
        <button type="submit" disabled={!key.trim() || !companyId.trim() || saving}>
          {saving ? "Checking…" : "Connect"}
        </button>
      </form>

      {snapshot.error && (
        <div className="error">
          {snapshot.error}
          <button className="link" onClick={() => void keito.openLog()}>
            Open log
          </button>
        </div>
      )}

      {snapshot.keyStatus === "ready" && (
        <>
          <h2>Company ID</h2>
          <p className="hint">
            Sent as the <code>Keito-Account-Id</code> header on every request. Change it to point
            the app at a different company on the same key.
          </p>
          <CompanyIdField current={snapshot.accountId} onChange={onChange} />
        </>
      )}

      <h2>Shortcut</h2>
      <p className="hint">Press this anywhere to open the switcher.</p>
      <input
        defaultValue={snapshot.hotkey}
        onBlur={(event) => void keito.setHotkey(event.target.value.trim()).then(onChange)}
      />

      <h2>Menu bar label</h2>
      <p className="hint">
        What the tray shows while a timer runs. The note leads by default — it is what says
        what you are doing.
      </p>
      <div className="tray-options">
        <label>
          When there is a note
          <select
            value={snapshot.trayPrefix}
            onChange={(event) =>
              void keito
                .setTrayLabel({ fallback: snapshot.trayFallback, prefix: event.target.value as never })
                .then(onChange)
            }
          >
            <option value="none">Show the note alone</option>
            <option value="project">Prefix it with the project</option>
            <option value="task">Prefix it with the task</option>
          </select>
        </label>
        <label>
          When the note is blank
          <select
            value={snapshot.trayFallback}
            onChange={(event) =>
              void keito
                .setTrayLabel({ fallback: event.target.value as never, prefix: snapshot.trayPrefix })
                .then(onChange)
            }
          >
            <option value="task">Show the task</option>
            <option value="project">Show the project</option>
          </select>
        </label>
      </div>
      <p className="hint preview">
        Now showing: <code>{trayPreview(snapshot)}</code>
      </p>

      <h2>Favourites</h2>
      {snapshot.favourites.length === 0 ? (
        <p className="hint">Star a category in the switcher to pin it to the top.</p>
      ) : (
        <ul className="favourites">
          {snapshot.favourites.map((id) => {
            const pair = snapshot.catalog.find((candidate) => candidate.id === id);
            return (
              <li key={id}>
                {pair ? `${pair.projectName} — ${pair.taskName}` : <em>{id} (no longer available)</em>}
                <button className="link danger" onClick={() => void keito.toggleFavourite(id).then(onChange)}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h2>Diagnostics</h2>
      <p className="hint">
        Every request is logged with its status and timing. API keys are masked.
      </p>
      <button onClick={() => void keito.openLog()}>Open log file</button>

      <h2>Workspace timezone</h2>
      <p className="hint">
        Only used when you edit a time by hand. Timers themselves are stamped by Keito.
      </p>
      <input value={snapshot.workspaceTimezone} readOnly />
    </section>
  );
}
