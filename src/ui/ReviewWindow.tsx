import { useCallback, useEffect, useState } from "react";
import type { TimeEntry } from "../core/keito/types.js";
import { keito } from "./keito-api.js";
import { useSnapshot } from "./useSnapshot.js";

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

function weekStart(today: Date): Date {
  const date = new Date(today);
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - weekday);
  return date;
}

export function ReviewWindow(): JSX.Element {
  const [snapshot, setSnapshot] = useSnapshot();
  const [tab, setTab] = useState<"entries" | "settings">("entries");

  if (!snapshot) return <div className="window loading">Loading…</div>;

  return (
    <div className="window">
      <nav className="tabs">
        <button className={tab === "entries" ? "on" : ""} onClick={() => setTab("entries")}>
          Entries
        </button>
        <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
          Settings
        </button>
      </nav>
      {snapshot.keyStatus !== "ready" || tab === "settings" ? (
        <Settings snapshot={snapshot} onChange={setSnapshot} />
      ) : (
        <Entries />
      )}
    </div>
  );
}

function Entries(): JSX.Element {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [range, setRange] = useState<"today" | "week">("today");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const today = new Date();
    const from = range === "today" ? isoDate(today) : isoDate(weekStart(today));
    setEntries(await keito.listEntries(from, isoDate(today)));
  }, [range]);

  useEffect(() => void load(), [load]);

  const edit = async (id: string, patch: { notes?: string; startedTime?: string; endedTime?: string }) => {
    try {
      await keito.updateEntry(id, patch);
      setError(null);
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
                    await keito.deleteEntry(entry.id);
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
      <button type="submit" disabled={!dirty || saving}>
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
          Paste a <strong>full-access integration key</strong> from Keito (Settings → Integrations).
          A personal read-only sync key cannot create time entries.
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
          Company ID <span className="optional">optional</span>
          <input
            placeholder="Leave blank to detect automatically"
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
          />
        </label>
        <button type="submit" disabled={!key.trim() || saving}>
          {saving ? "Checking…" : "Connect"}
        </button>
      </form>

      {snapshot.error && <div className="error">{snapshot.error}</div>}

      {snapshot.keyStatus === "ready" && (
        <>
          <h2>Company ID</h2>
          <p className="hint">
            Sent as the <code>Keito-Account-Id</code> header on every request. Change it to point
            the app at a different company on the same key; clear it to detect it again.
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

      <h2>Workspace timezone</h2>
      <p className="hint">
        Only used when you edit a time by hand. Timers themselves are stamped by Keito.
      </p>
      <input value={snapshot.workspaceTimezone} readOnly />
    </section>
  );
}
