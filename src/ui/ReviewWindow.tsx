import { useCallback, useEffect, useState } from "react";
import type { TimeEntry } from "../core/keito/types.js";
import type { Snapshot } from "../../electron/service.js";
import { keito } from "./keito-api.js";
import { AsyncButton, Spinner, useAsyncAction } from "./AsyncButton.js";
import { HotkeyRecorder } from "./HotkeyRecorder.js";
import { TrayLabelSettings } from "./TrayLabelSettings.js";
import { ContributeTab } from "./ContributeTab.js";
import { ProjectsTab } from "./ProjectsTab.js";
import { useSnapshot } from "./useSnapshot.js";

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

function weekStart(today: Date): Date {
  const date = new Date(today);
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - weekday);
  return date;
}

type Tab = "entries" | "projects" | "connection" | "settings" | "contribute";

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ["entries", "Time Entries"],
  ["projects", "Projects"],
  ["connection", "Keito Connection"],
  ["settings", "Settings"],
  ["contribute", "Contribute"],
];

export function ReviewWindow(): JSX.Element {
  const [snapshot, setSnapshot] = useSnapshot();
  const [tab, setTab] = useState<Tab>("entries");

  if (!snapshot) return <div className="window loading">Loading…</div>;

  // Nothing else can do anything useful until the connection works.
  const active: Tab = snapshot.keyStatus === "ready" ? tab : "connection";

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
      {active === "projects" && <ProjectsTab snapshot={snapshot} onChange={setSnapshot} />}
      {active === "connection" && <Connection snapshot={snapshot} onChange={setSnapshot} />}
      {active === "settings" && <Settings snapshot={snapshot} onChange={setSnapshot} />}
      {active === "contribute" && <ContributeTab snapshot={snapshot} />}
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const today = new Date();
    const from = range === "today" ? isoDate(today) : isoDate(weekStart(today));
    setLoading(true);
    try {
      setEntries(await keito.listEntries(from, isoDate(today)));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
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
        <AsyncButton className="link" onClick={load}>
          Reload
        </AsyncButton>
      </div>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <p className="loading-entries">
          <Spinner />
          Oh my gosh, look at the time
        </p>
      ) : (
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
                <AsyncButton
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
                </AsyncButton>
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
      )}
    </section>
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

function Connection({
  snapshot,
  onChange,
}: {
  snapshot: Snapshot;
  onChange: (next: Snapshot) => void;
}): JSX.Element {
  const connected = snapshot.keyStatus === "ready";
  // Pre-filled with the masked key when one is stored. Left untouched, it means "keep it";
  // the real key never reaches this process.
  const [key, setKey] = useState(snapshot.apiKeyHint ?? "");
  const [companyId, setCompanyId] = useState(snapshot.accountId ?? "");
  useEffect(() => setKey(snapshot.apiKeyHint ?? ""), [snapshot.apiKeyHint]);
  useEffect(() => setCompanyId(snapshot.accountId ?? ""), [snapshot.accountId]);

  const keyChanged = key !== (snapshot.apiKeyHint ?? "");
  const companyChanged = companyId.trim() !== (snapshot.accountId ?? "");
  const canSave = keyChanged ? key.trim() !== "" && companyId.trim() !== "" : companyChanged;

  const [saving, save] = useAsyncAction(async () => {
    onChange(
      keyChanged
        ? await keito.setApiKey(key.trim(), companyId.trim())
        : await keito.setCompanyId(companyId.trim()),
    );
  });

  return (
    <section className="settings connection">
      {connected ? (
        <p className="connected">
          <strong>You’re connected!</strong>
          <span className="muted">
            {snapshot.identity?.name} · {snapshot.identity?.accountName}
          </span>
        </p>
      ) : (
        <p className="hint">
          Paste a <strong>full-access integration key</strong> from Keito (Settings →
          Integrations) and your <strong>Company ID</strong>. Both are required — Keito sends
          the company id on every request, so it cannot be detected for you. A personal
          read-only sync key will not work: it cannot create time entries.
        </p>
      )}

      <form
        className="connect"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label>
          API key
          <input
            type={keyChanged ? "password" : "text"}
            placeholder="kto_…"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <label>
          Company ID
          <input
            placeholder="From your Keito account settings"
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
          />
        </label>
        <div className="connect-actions">
          <button type="submit" aria-busy={saving} disabled={!canSave || saving}>
            {saving ? <Spinner /> : connected ? "Update" : "Connect"}
          </button>
          {connected && (
            <AsyncButton className="link muted" onClick={() => keito.signOut().then(onChange)}>
              Disconnect
            </AsyncButton>
          )}
        </div>
      </form>

      {snapshot.error && (
        <div className="error">
          {snapshot.error}
          <button className="link" onClick={() => void keito.openLog()}>
            Open log
          </button>
        </div>
      )}
    </section>
  );
}

function Settings({
  snapshot,
  onChange,
}: {
  snapshot: Snapshot;
  onChange: (next: Snapshot) => void;
}): JSX.Element {
  return (
    <section className="settings">
      <h2>Shortcut</h2>
      <p className="hint">Press this anywhere to open the switcher.</p>
      <HotkeyRecorder
        hotkey={snapshot.hotkey}
        platform={snapshot.platform}
        registered={snapshot.hotkeyRegistered}
        onRecord={(accelerator) => keito.setHotkey(accelerator).then(onChange)}
      />

      <h2>Menu bar label</h2>
      <p className="hint">
        What the menu bar shows while a timer runs. The note leads by default — it is what
        says what you are doing.
      </p>
      <TrayLabelSettings snapshot={snapshot} onChange={onChange} />

      <h2>Workspace timezone</h2>
      <p className="hint">
        Only used when you edit a time by hand. Timers themselves are stamped by Keito.
      </p>
      <input value={snapshot.workspaceTimezone} readOnly />

      <h2>Diagnostics</h2>
      <p className="hint">
        Every request is logged with its status and timing. API keys are masked.
      </p>
      <AsyncButton onClick={() => keito.openLog()}>Open log file</AsyncButton>
    </section>
  );
}
