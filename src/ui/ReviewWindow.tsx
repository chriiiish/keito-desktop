import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TimeEntry } from "../core/keito/types.js";
import type { EntryPatch, Snapshot } from "../../electron/service.js";
import { keito } from "./keito-api.js";
import { AsyncButton, Spinner, useAsyncAction } from "./AsyncButton.js";
import { CategoryPicker } from "./CategoryPicker.js";
import { HotkeyRecorder } from "./HotkeyRecorder.js";
import { TrayLabelSettings } from "./TrayLabelSettings.js";
import { AboutTab } from "./AboutTab.js";
import { IntegrationsTab } from "./IntegrationsTab.js";
import { UpdateTab } from "./UpdateTab.js";
import { ProjectsTab } from "./ProjectsTab.js";
import { Toggle } from "./Toggle.js";
import { InfoTip } from "./InfoTip.js";
import { useSnapshot } from "./useSnapshot.js";
import { pairId } from "../core/catalog/catalog.js";
import type { Pair } from "../core/keito/types.js";
import { shiftDate, workspaceDate } from "../core/time/workspace-time.js";
import { entrySeconds, formatDecimalHours } from "../core/time/elapsed.js";
import { visibleNote, visibleNoteField } from "../core/keito/notes.js";
import { useNow } from "./useNow.js";

/** The Monday of the week a YYYY-MM-DD date falls in. */
function weekStart(today: string): string {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return shiftDate(today, -weekday);
}

type Tab = "entries" | "projects" | "connection" | "settings" | "integrations" | "about" | "update";

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ["entries", "Time Entries"],
  ["projects", "Projects"],
  ["connection", "Keito Connection"],
  ["settings", "Settings"],
  ["integrations", "Integrations"],
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
  /** A tab the main process asked for that the first-snapshot reset must not overwrite. */
  const requestedTab = useRef<Tab | null>(null);

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
   *
   * **Unless the main process asked for a tab.** Opening this window from the popover's
   * update notice creates it, tells it which tab to show as its page loads, and only then
   * delivers the first snapshot — so this reset fired *after* the request and threw it
   * away. The notice landed on Time Entries, and appeared to work only when the window
   * happened to be open already. A pending request is consumed here, so it survives
   * exactly the one reset that would have overwritten it and a later sign-out still
   * returns to the entries table.
   */
  const ready = snapshot?.keyStatus === "ready";
  const [wasReady, setWasReady] = useState(ready);
  if (ready !== wasReady) {
    setWasReady(ready);
    if (ready && !requestedTab.current) setTab("entries");
    requestedTab.current = null;
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
        if (!isTab(requested)) return;
        // Remembered as well as applied: the connecting-opens-entries reset above runs on
        // the first snapshot, which arrives after this, and would otherwise discard it.
        requestedTab.current = requested;
        setTab(requested);
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

      {active === "entries" && <Entries snapshot={snapshot} onChange={setSnapshot} />}
      {active === "projects" && <ProjectsTab snapshot={snapshot} onChange={setSnapshot} />}
      {active === "connection" && <Connection snapshot={snapshot} onChange={setSnapshot} />}
      {active === "settings" && <Settings snapshot={snapshot} onChange={setSnapshot} />}
      {active === "integrations" && <IntegrationsTab snapshot={snapshot} onChange={setSnapshot} />}
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
 *
 * Takes the whole snapshot, the way the other tabs do, rather than the three fields it
 * used to: reassigning a row's category needs the catalog, favourites and recents that the
 * embedded CategoryPicker takes, and threading those in one at a time as the feature grew
 * would have left this the one tab still passed apart from its siblings.
 */
function Entries({
  snapshot,
  onChange,
}: {
  snapshot: Snapshot;
  onChange: (next: Snapshot) => void;
}): JSX.Element {
  const catalog = snapshot.catalog;
  const timeZone = snapshot.workspaceTimezone;
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

  useEffect(() => void load(), [load, snapshot.revision]);

  /**
   * The client name isn't on a time entry, only on a project — `pairId` joins back to the
   * catalog's Pair for it, the same key `ProjectsTab` and the picker use for a project/task.
   * Purely derived: Keito has no client resource of its own to edit, so reassigning the
   * project (below) is the only way this column ever changes.
   */
  const clientName = (entry: TimeEntry): string =>
    catalog.find((pair) => pair.id === pairId(entry.project_id, entry.task_id))?.clientName ?? "—";

  /**
   * The Pair each row's picker should show as selected, plus the catalog to show it
   * against — one lookup per entry, not recomputed on every render. `CategoryPicker` keys
   * its own memoization off the `catalog` array's identity, and a fresh `[...catalog, x]`
   * built inline in the render would look like a changed catalog on every keystroke in the
   * still-open dropdown, even when nothing about it actually changed.
   *
   * `Timer.pairFor` faces the same problem for the running-entry label: a timer left going
   * against a project that was since archived or hidden from the catalog would otherwise
   * resolve to nothing and the picker would fall back to "Choose a category…", which reads
   * as the row having lost its assignment rather than merely predating it. The entry's own
   * embedded `project`/`task` names cover that case; injected only into that one row's own
   * catalog copy, so every other row still sees the real one.
   */
  const categories = useMemo(() => {
    const map = new Map<string, { id: string; catalog: Pair[] }>();
    for (const entry of entries) {
      const id = pairId(entry.project_id, entry.task_id);
      if (catalog.some((pair) => pair.id === id)) {
        map.set(entry.id, { id, catalog });
        continue;
      }
      const archived: Pair = {
        id,
        projectId: entry.project_id,
        projectName: entry.project?.name ?? "Unknown project",
        taskId: entry.task_id,
        taskName: entry.task?.name ?? "Unknown task",
      };
      map.set(entry.id, { id, catalog: [...catalog, archived] });
    }
    return map;
  }, [entries, catalog]);

  // The running row's hours climb rather than sitting at "—", which is what a null
  // `hours` from the API renders as. Ticking only while a timer is actually going.
  const now = useNow(1000, entries.some((entry) => entry.is_running));

  /**
   * `noteField` travels with a note edit because only this table knows which of the two
   * notes it put on screen. The main process caches today and yesterday alone, so for a
   * row from earlier in the week it would have to guess — and its guess is the client
   * note, which would publish an internal one the table was merely falling back to.
   */
  const edit = async (id: string, patch: EntryPatch) => {
    try {
      const next = await keito.updateEntry(id, patch);
      setError(next.error);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /**
   * The category picker isn't wrapped in `AsyncButton`/`useAsyncAction` like the rest of
   * this table's controls — it's a whole combobox, not a single click — so it needs its own
   * re-entry guard. Tracks a *set* of in-flight ids, not one flag: a single slot meant one
   * row's save completing cleared the guard for every row, so editing two rows at once let
   * the second row's trigger re-enable while its own PATCH was still in flight, reopening
   * the exact race this exists to prevent.
   *
   * Membership is checked against the ref, not the state, the same reason
   * `useAsyncAction`'s guard is a ref: two picks on the same row in one tick would both read
   * a stale membership from state and both fire before either update lands.
   */
  const savingCategoryRef = useRef<Set<string>>(new Set());
  const [savingCategoryIds, setSavingCategoryIds] = useState<ReadonlySet<string>>(new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const editCategory = async (id: string, projectId: string, taskId: string) => {
    if (savingCategoryRef.current.has(id)) return;
    savingCategoryRef.current.add(id);
    setSavingCategoryIds(new Set(savingCategoryRef.current));
    try {
      await edit(id, { projectId, taskId });
    } finally {
      savingCategoryRef.current.delete(id);
      // The entries tab unmounts when another tab is selected; a save that outlives that
      // must not set state into the void, the same rule useAsyncAction follows.
      if (mountedRef.current) setSavingCategoryIds(new Set(savingCategoryRef.current));
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
            {range === "week" && <th>Date</th>}
            <th>Client</th>
            <th colSpan={2}>Project / Task</th>
            <th>Start</th>
            <th>End</th>
            <th>Hours</th>
            <th>Notes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const category = categories.get(entry.id)!;
            const selectedPair = category.catalog.find((candidate) => candidate.id === category.id);
            return (
            <tr key={entry.id} className={entry.is_running ? "running-row" : ""}>
              {range === "week" && <td>{entry.spent_date}</td>}
              <td>{clientName(entry)}</td>
              {/*
                One cell spanning both columns rather than one picker per column: Keito has
                no notion of a project without a task, so "change the project" and "change
                the task" are the same action — the same (project, task) pair the popover's
                own CategoryPicker starts a new entry from. Two separate triggers editing
                the same identity would need to stay in lock-step by hand.
              */}
              <td colSpan={2} className="category-cell">
                <CategoryPicker
                  catalog={category.catalog}
                  favourites={snapshot.favourites}
                  recents={snapshot.recents}
                  // Not snapshot.hidden: hiding a category declutters where you start new
                  // work, and must never stand in the way of correcting where old work
                  // landed. Every category is reachable here regardless of that setting.
                  hidden={[]}
                  selectedId={category.id}
                  // A plain "Category" label is fine for the popover's one picker; a table
                  // with one per row needs something that actually names the row, or every
                  // trigger announces the same to assistive tech.
                  ariaLabel={
                    selectedPair
                      ? `Category for ${selectedPair.taskName} — ${selectedPair.projectName}`
                      : "Category"
                  }
                  disabled={savingCategoryIds.has(entry.id)}
                  onSelect={(nextId) => {
                    const pair = category.catalog.find((candidate) => candidate.id === nextId);
                    if (pair) void editCategory(entry.id, pair.projectId, pair.taskId);
                  }}
                  onToggleFavourite={(id) => keito.toggleFavourite(id).then(onChange)}
                />
              </td>
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
                  defaultValue={visibleNote(entry)}
                  placeholder="—"
                  onBlur={(event) => {
                    if (event.target.value !== visibleNote(entry)) {
                      void edit(entry.id, {
                        notes: event.target.value,
                        noteField: visibleNoteField(entry),
                      });
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
            );
          })}
          {entries.length === 0 && (
            <tr>
              <td colSpan={range === "week" ? 9 : 8} className="empty">
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

/**
 * One row of a settings table: what it is on the left, the control that changes it on the
 * right, and the explanation folded into the "i" rather than printed underneath.
 */
function SettingRow({
  name,
  about,
  children,
  note,
}: {
  name: string;
  about?: ReactNode;
  children: ReactNode;
  note?: ReactNode;
}): JSX.Element {
  return (
    <tr>
      <th scope="row">
        <span className="setting-name">
          {name}
          {about && <InfoTip label={name}>{about}</InfoTip>}
        </span>
        {/*
          A note stays on the page instead of going into the "i". These explain why a
          control is disabled or unavailable, and an explanation you have to go looking for
          is no use when the thing you just tried to click did not work.
        */}
        {note && <p className="hint">{note}</p>}
      </th>
      <td>{children}</td>
    </tr>
  );
}

/** A titled group of settings. The heading is the table's own caption. */
function SettingGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <table className="settings-table">
      <caption>{title}</caption>
      <tbody>{children}</tbody>
    </table>
  );
}

/**
 * Preferences only — the connection lives on its own tab and project visibility on
 * another.
 *
 * Grouped into tables rather than a run of headings each trailing a paragraph. There were
 * six such headings, and the prose between them was most of the page's height while being
 * the part you least often needed: the explanations now sit behind an "i" beside the name
 * they explain.
 *
 * The menu bar label is its own group rather than a row, because it is five radios and a
 * live preview rather than a single control, and squeezing that into a right-hand cell
 * would make the one setting people actually change the hardest to read.
 */
function Settings({
  snapshot,
  onChange,
}: {
  snapshot: Snapshot;
  onChange: (next: Snapshot) => void;
}): JSX.Element {
  const trayHeading = snapshot.platform === "darwin" ? "Menu bar label" : "Tray label";

  return (
    <section className="settings">
      <SettingGroup title="General">
        <SettingRow name="Shortcut" about="Press this anywhere to open the timer.">
          <HotkeyRecorder
            hotkey={snapshot.hotkey}
            platform={snapshot.platform}
            registered={snapshot.hotkeyRegistered}
            onRecord={(accelerator) => keito.setHotkey(accelerator).then(onChange)}
          />
        </SettingRow>

        <SettingRow
          name="Run at startup"
          about={
            snapshot.platform === "darwin"
              ? "Open Keito Timer when you log in, so the menu bar icon is there before you think to look for it."
              : "Open Keito Timer when you sign in, so the tray icon is there before you think to look for it."
          }
          note={
            !snapshot.canOpenAtLogin &&
            "Unavailable in a development run: the login item would be registered against the Electron binary rather than Keito Timer, and would say so. Try it from an installed build."
          }
        >
          <Toggle
            checked={snapshot.openAtLogin}
            label="Run at startup"
            disabled={!snapshot.canOpenAtLogin}
            onChange={(next) => keito.setOpenAtLogin(next).then(onChange)}
          />
        </SettingRow>

        <SettingRow
          name="Include pre-releases"
          about="Offer builds marked as pre-releases when checking for updates. They arrive earlier and have had less use."
        >
          <Toggle
            checked={snapshot.includePrereleases}
            label="Include pre-releases"
            onChange={(next) => keito.setIncludePrereleases(next).then(onChange)}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Notes">
        <SettingRow
          name="My plan has Internal Notes"
          about="Internal Notes are a Keito plan feature, and the API gives no way to tell whether yours has them — so this is the one setting you have to answer for yourself. With it on, the popover gets a switch that keeps a note to your team."
        >
          <Toggle
            checked={snapshot.internalNotesAvailable}
            label="My plan has Internal Notes"
            onChange={(next) => keito.setInternalNotesAvailable(next).then(onChange)}
          />
        </SettingRow>
      </SettingGroup>

      <div className="settings-group">
        <h2>
          <span className="setting-name">
            {trayHeading}
            <InfoTip label={trayHeading}>
              {snapshot.platform === "darwin"
                ? "What the menu bar shows while a timer runs."
                : "What the tray tooltip leads with while a timer runs."}{" "}
              The note leads by default — it is what says what you are doing.
            </InfoTip>
          </span>
        </h2>
        <TrayLabelSettings snapshot={snapshot} onChange={onChange} />
      </div>

      <SettingGroup title="Workspace and diagnostics">
        <SettingRow
          name="Workspace timezone"
          about="Only used when you edit a time by hand. Timers themselves are stamped by Keito."
        >
          <span className="setting-value">{snapshot.workspaceTimezone}</span>
        </SettingRow>

        <SettingRow
          name="Log file"
          about="Every request is logged with its status and timing. API keys are masked."
        >
          <AsyncButton onClick={() => keito.openLog()}>Open log file</AsyncButton>
        </SettingRow>
      </SettingGroup>

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
