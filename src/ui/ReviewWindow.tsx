import { useCallback, useEffect, useState } from "react";
import type { TimeEntry } from "../core/keito/types.js";
import type { Snapshot } from "../../electron/service.js";
import { keito } from "./keito-api.js";
import { AsyncButton, Spinner, useAsyncAction } from "./AsyncButton.js";
import { HotkeyRecorder } from "./HotkeyRecorder.js";
import { TrayLabelSettings } from "./TrayLabelSettings.js";
import { AboutTab } from "./AboutTab.js";
import { UpdateTab } from "./UpdateTab.js";
import { ProjectsTab } from "./ProjectsTab.js";
import { Toggle } from "./Toggle.js";
import { useSnapshot } from "./useSnapshot.js";
import { shiftDate, workspaceDate } from "../core/time/workspace-time.js";
import { entrySeconds, formatDecimalHours } from "../core/time/elapsed.js";
import { useNow } from "./useNow.js";

/** The Monday of the week a YYYY-MM-DD date falls in. */
function weekStart(today: string): string {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return shiftDate(today, -weekday);
}

type Tab = "entries" | "projects" | "connection" | "settings" | "about" | "update";

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ["entries", "Time Entries"],
  ["projects", "Projects"],
  ["connection", "Keito Connection"],
  ["settings", "Settings"],
  ["about", "About"],
];

/**
 * The update tab exists only while there is something to update to, so it is appended
 * rather than living in TABS. A permanent tab that says "you are up to date" is a tab
 * nobody opens twice; this one is only ever there when it has something to say.
 *
 * Dismissing the popover notice does not remove it — dismissal quietens the timer, it does
 * not decide that the release is no longer worth finding.
 */
const UPDATE_TAB: readonly [Tab, string] = ["update", "Update Available"];

/** Every tab this window can render, update included. */
const ALL_TABS: ReadonlyArray<readonly [Tab, string]> = [...TABS, UPDATE_TAB];

/**
 * Is this one of the tabs this window renders?
 *
 * `show-tab` arrives over IPC as an arbitrary string, so it is checked rather than cast.
 * An id with no matching pane would leave the window blank with nothing in the tab bar
 * highlighted — a dead end a user could not click their way out of, since the state is
 * only reachable through the event and no tab button sets it. Derived from the tab list
 * itself so a tab added later cannot be forgotten here.
 */
function isTab(value: string): value is Tab {
  return ALL_TABS.some(([id]) => id === value);
}

export function ReviewWindow(): JSX.Element {
  const [snapshot, setSnapshot] = useSnapshot();
  const [tab, setTab] = useState<Tab>("entries");

  /**
   * Connecting opens the entries table, whatever the tabs were last clicked.
   *
   * Until a key works every tab renders the connection form, but the click is
   * still recorded — so a new user who poked at the tabs while setting up would
   * land on whichever one they poked, usually About. The first thing to
   * see after connecting is the work you have logged.
   *
   * Adjusted during render rather than in an effect. An effect runs *after* the commit,
   * so the first render with a working key would still use the old tab — mounting, say,
   * the About tab for a frame before replacing it. Setting state during render makes
   * React re-run this function before it commits anything, so that frame never exists.
   */
  const ready = snapshot?.keyStatus === "ready";
  const [wasReady, setWasReady] = useState(ready);
  if (ready !== wasReady) {
    setWasReady(ready);
    if (ready) setTab("entries");
  }

  /**
   * The window title carries the workspace once there is one to name — several Keito
   * accounts is the case where two identical windows are worth telling apart.
   *
   * Set through `document.title` rather than `BrowserWindow.setTitle`: index.html carries
   * a <title>, so Electron syncs the window title from the document and would overwrite
   * anything the main process set as soon as the page loaded. This also makes it
   * something the component tests can actually read.
   */
  /**
   * The popover's update notice opens this window on the update tab. An event rather than
   * Snapshot state, so clicking away from the tab afterwards actually sticks.
   */
  useEffect(
    () =>
      keito.onShowTab((requested) => {
        if (isTab(requested)) setTab(requested);
      }),
    [],
  );

  const company = ready ? snapshot?.identity?.accountName?.trim() : undefined;
  useEffect(() => {
    document.title = company ? `Keito Timer - ${company}` : "Keito Timer";
  }, [company]);

  if (!snapshot) return <div className="window loading">Loading…</div>;

  const update = snapshot.update;
  const tabs = update ? ALL_TABS : TABS;

  // The update tab is gone the moment the update is installed, so a window left open on
  // it must fall back rather than render an empty pane.
  const selected: Tab = tab === "update" && !update ? "entries" : tab;

  /**
   * Nothing else can do anything useful until the connection works — with one exception.
   *
   * The update tab is about the app, not the workspace: it needs no key, no catalog and no
   * network beyond the check that already happened. Falling it back to the connection form
   * would leave a tab in the bar that visibly does nothing when clicked, and would hide a
   * release from the very user most likely to want it — someone whose key has just stopped
   * working, for whom the newer version might be the fix.
   */
  const active: Tab =
    snapshot.keyStatus === "ready" || selected === "update" ? selected : "connection";

  return (
    <div className="window">
      <nav className="tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={`${active === id ? "on" : ""}${id === "update" ? " has-update" : ""}`.trim()}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {active === "entries" && (
        <Entries revision={snapshot.revision} timeZone={snapshot.workspaceTimezone} />
      )}
      {active === "projects" && <ProjectsTab snapshot={snapshot} onChange={setSnapshot} />}
      {active === "connection" && <Connection snapshot={snapshot} onChange={setSnapshot} />}
      {active === "settings" && <Settings snapshot={snapshot} onChange={setSnapshot} />}
      {active === "about" && <AboutTab snapshot={snapshot} />}
      {active === "update" && update && <UpdateTab snapshot={snapshot} update={update} />}
    </div>
  );
}

/**
 * `revision` moves whenever anything changed server-side — a timer started from the
 * popover, a stop, a delete. Reloading on it is what keeps this table from going stale
 * until it happens to be remounted.
 *
 * "Today" and "this week" are the workspace's days, matching the `spent_date` the rows
 * carry — from UTC they would be off by one for most of the world for part of each day.
 */
function Entries({ revision, timeZone }: { revision: number; timeZone: string }): JSX.Element {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [range, setRange] = useState<"today" | "week">("today");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const today = workspaceDate(new Date(), timeZone);
    const from = range === "today" ? today : weekStart(today);
    setLoading(true);
    try {
      setEntries(await keito.listEntries(from, today));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [range, timeZone]);

  useEffect(() => void load(), [load, revision]);

  // The running row's hours climb rather than sitting at "—", which is what a null
  // `hours` from the API renders as. Ticking only while a timer is actually going.
  const now = useNow(1000, entries.some((entry) => entry.is_running));

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
              <td className={entry.is_running ? "ticking" : ""}>
                {formatDecimalHours(entrySeconds(entry, now, timeZone))}
              </td>
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
        /* A welcome, not a form with a paragraph above it: this is the first screen the
           app ever shows. An <ol> rather than written-out numbers, so hiding the startup
           step in a build that cannot offer it renumbers the rest by itself. */
        <div className="welcome">
          <h2>Welcome to Keito Timer</h2>
          <p className="welcome-lead">Two things and you’re tracking time.</p>

          <ol className="welcome-steps">
            {/* Shown even when the login item is unavailable, disabled and with the
                reason — the same way Settings handles it. Hiding the step instead reads
                as a missing feature, and a welcome that silently drops a step in some
                builds is a welcome nobody can trust to be complete. */}
            <li>
              <div className="setting-row">
                <span className="setting-label">
                  <strong>
                    Start Keito Timer when you{" "}
                    {snapshot.platform === "darwin" ? "log in" : "sign in"}
                  </strong>
                  <span className="hint">
                    {snapshot.canOpenAtLogin
                      ? "You can change this in Settings later."
                      : "Available once Keito Timer is installed — this is a development build."}
                  </span>
                </span>
                <Toggle
                  checked={snapshot.openAtLogin}
                  label="Run at startup"
                  disabled={!snapshot.canOpenAtLogin}
                  onChange={(next) => keito.setOpenAtLogin(next).then(onChange)}
                />
              </div>
            </li>
            <li>
              <strong>Connect to Keito</strong>
              <span className="hint">
                Ask your Keito administrator for a <strong>write-enabled API key</strong> and
                your <strong>Company ID</strong>. If you look after Keito yourself, both are
                under Settings → Integrations.
              </span>
            </li>
          </ol>
        </div>
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
      <p className="hint">Press this anywhere to open the timer.</p>
      <HotkeyRecorder
        hotkey={snapshot.hotkey}
        platform={snapshot.platform}
        registered={snapshot.hotkeyRegistered}
        onRecord={(accelerator) => keito.setHotkey(accelerator).then(onChange)}
      />

      <h2>{snapshot.platform === "darwin" ? "Menu bar label" : "Tray label"}</h2>
      <p className="hint">
        {snapshot.platform === "darwin"
          ? "What the menu bar shows while a timer runs."
          : "What the tray tooltip leads with while a timer runs."}{" "}
        The note leads by default — it is what says what you are doing.
      </p>
      <TrayLabelSettings snapshot={snapshot} onChange={onChange} />

      <h2>Startup</h2>
      <p className="hint">
        {snapshot.platform === "darwin"
          ? "Open Keito Timer when you log in, so the menu bar icon is there before you think to look for it."
          : "Open Keito Timer when you sign in, so the tray icon is there before you think to look for it."}
      </p>
      <div className="setting-row">
        <span className="setting-label">Run at startup</span>
        <Toggle
          checked={snapshot.openAtLogin}
          label="Run at startup"
          disabled={!snapshot.canOpenAtLogin}
          onChange={(next) => keito.setOpenAtLogin(next).then(onChange)}
        />
      </div>
      {!snapshot.canOpenAtLogin && (
        <p className="hint">
          Unavailable in a development run: the login item would be registered against the
          Electron binary rather than Keito Timer, and would say so. Try it from an
          installed build.
        </p>
      )}

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

      <DangerZone onChange={onChange} />
    </section>
  );
}

/**
 * Clearing everything is irreversible and one click away from the log button, so it asks
 * first. The confirmation is a second step rather than a `window.confirm`: it can say
 * exactly what is about to go, and it is reachable from the component tests.
 */
function DangerZone({ onChange }: { onChange: (next: Snapshot) => void }): JSX.Element {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="danger-zone">
      <h2>Danger Zone</h2>
      {confirming ? (
        <>
          <p className="hint">
            This clears your API key, the Company ID, favourites, hidden categories, the
            shortcut, the tray label and the run-at-startup setting — everything this app
            has stored. Time already tracked stays in Keito and is not touched.
          </p>
          <div className="danger-actions">
            <AsyncButton
              className="danger-confirm"
              onClick={() => keito.resetAll().then(onChange)}
            >
              Yes, clear everything
            </AsyncButton>
            <button type="button" className="link" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            Removes everything stored on this computer and returns the app to a fresh
            install. It cannot be undone.
          </p>
          <button type="button" className="danger-confirm" onClick={() => setConfirming(true)}>
            Clear all configuration…
          </button>
        </>
      )}
    </div>
  );
}
