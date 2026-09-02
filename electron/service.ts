import { buildPicker } from "../src/core/catalog/picker.js";
import { loadCatalog, loadEntries } from "../src/core/catalog/workspace.js";
import { KeitoClient, type RequestRecord } from "../src/core/keito/client.js";
import { KeitoAuthError, KeitoError, KeitoReadOnlyError } from "../src/core/keito/errors.js";
import type { Identity, Pair, TimeEntry } from "../src/core/keito/types.js";
import { PreferencesStore } from "../src/core/store/preferences.js";
import type { TrayFallback, TrayPrefix } from "../src/core/tray/label.js";
import { TimerSwitcher, type TimerState } from "../src/core/timer/switcher.js";
import { formatWorkspaceTime } from "../src/core/time/workspace-time.js";
import { entryStartMs } from "../src/core/time/elapsed.js";
import type { SecretStore } from "./secrets.js";
import type { Logger } from "./logger.js";

/** Everything the renderer needs to draw either window. */
export interface Snapshot {
  keyStatus: "missing" | "ready" | "rejected";
  identity: Identity | null;
  catalog: Pair[];
  recents: string[];
  /** Entries logged today, newest first — the popover's "already worked on" list. */
  today: TimeEntry[];
  /**
   * Yesterday's, for the popover's second list. Free from the window already fetched for
   * ranking, so it costs no extra request.
   */
  yesterday: TimeEntry[];
  favourites: string[];
  /** Pair ids switched off in settings; favourites and recents override this. */
  hidden: string[];
  workspaceTimezone: string;
  hotkey: string;
  /** False when the OS refused the accelerator — usually another app already has it. */
  hotkeyRegistered: boolean;
  /**
   * Whether the OS is set to launch the app at login. Read back from the OS rather than
   * stored in preferences.json: the login item can be switched off in System Settings or
   * Task Manager, and a copy here would go on claiming otherwise.
   */
  openAtLogin: boolean;
  /**
   * False in a development run, where the login item would be registered against the
   * Electron binary rather than this app — see `setOpenAtLogin`.
   */
  canOpenAtLogin: boolean;
  /** So the renderer can name modifier keys the way this platform's users expect. */
  platform: string;
  /** Shown on the Contribute tab, so a bug report can say which build it came from. */
  appVersion: string;
  /** The company id sent as Keito-Account-Id, once known. */
  accountId: string | null;
  /** A masked stand-in for the stored key, so settings can show one without exposing it. */
  apiKeyHint: string | null;
  /**
   * Bumped whenever anything server-side changed. Windows holding their own derived data
   * (the entries table) reload when this moves, rather than going stale until remounted.
   */
  revision: number;
  timer:
    | { status: "idle" }
    | { status: "running"; pair: Pair; entryId: string; startedAtMs: number; note: string | null }
    | { status: "needs-auth" };
  trayFallback: TrayFallback;
  trayPrefix: TrayPrefix;
  error: string | null;
}

/**
 * Enough of the key to recognise it, and not enough to use it. The plaintext key never
 * leaves the main process — the renderer only ever sees this.
 */
function maskKey(key: string): string {
  return `kto_${"•".repeat(8)}${key.slice(-4)}`;
}

/** Projects and tasks change rarely; the popover is opened constantly. */
const CATALOG_TTL_MS = 15 * 60_000;

/**
 * When a timer began, in epoch ms. Shared with the renderer through `src/core`, so the
 * header clock and the running rows in the lists agree on where a timer started.
 *
 * Falls back to "now" when the entry says nothing, which is wrong but harmless here: the
 * header clock simply restarts rather than rendering a nonsense duration.
 */
function startMsOf(entry: TimeEntry, timeZone: () => string): number {
  return entryStartMs(entry, timeZone()) ?? Date.now();
}

/**
 * Ties the tested core to the OS: holds the client, the switcher and the stores, and
 * renders a single Snapshot the UI can draw without further round trips.
 */
export class AppService {
  #prefs: PreferencesStore;
  #secrets: SecretStore;
  #log: Logger;
  #client: KeitoClient | null = null;
  #switcher: TimerSwitcher | null = null;
  #identity: Identity | null = null;
  #catalog: Pair[] = [];
  #catalogLoadedAt = 0;
  #recents: string[] = [];
  #today: TimeEntry[] = [];
  #yesterday: TimeEntry[] = [];
  #keyStatus: Snapshot["keyStatus"] = "missing";
  #error: string | null = null;
  #startedAtMs: number | null = null;
  #revision = 0;
  #apiKeyHint: string | null = null;
  #hotkeyRegistered = true;
  #openAtLogin = false;
  #canOpenAtLogin = false;
  #appVersion: string;

  private constructor(
    prefs: PreferencesStore,
    secrets: SecretStore,
    log: Logger,
    appVersion: string,
  ) {
    this.#prefs = prefs;
    this.#secrets = secrets;
    this.#log = log;
    this.#appVersion = appVersion;
  }

  static async create(
    prefs: PreferencesStore,
    secrets: SecretStore,
    log: Logger,
    appVersion = "0.0.0",
  ): Promise<AppService> {
    const service = new AppService(prefs, secrets, log, appVersion);
    const key = await secrets.read();
    log.info("Starting", { hasStoredKey: Boolean(key), accountId: prefs.get().accountId ?? null });
    if (key) {
      try {
        await service.#connect(key);
      } catch (error) {
        // A bad stored key must not stop the app; the settings window explains it.
        service.#recordFailure(error);
      }
    }
    return service;
  }

  /** The log file, so Settings can offer to open it. */
  get logPath(): string {
    return this.#log.path;
  }

  snapshot(): Snapshot {
    const prefs = this.#prefs.get();
    const state: TimerState = this.#switcher?.current() ?? { status: "idle" };
    return {
      keyStatus: this.#keyStatus,
      identity: this.#identity,
      catalog: this.#catalog,
      recents: this.#recents,
      today: this.#today,
      yesterday: this.#yesterday,
      favourites: [...prefs.favourites],
      hidden: [...prefs.hidden],
      workspaceTimezone: prefs.workspaceTimezone,
      hotkey: prefs.hotkey,
      hotkeyRegistered: this.#hotkeyRegistered,
      openAtLogin: this.#openAtLogin,
      canOpenAtLogin: this.#canOpenAtLogin,
      platform: process.platform,
      appVersion: this.#appVersion,
      accountId: prefs.accountId ?? null,
      apiKeyHint: this.#apiKeyHint,
      trayFallback: prefs.trayFallback,
      trayPrefix: prefs.trayPrefix,
      revision: this.#revision,
      timer:
        state.status === "running"
          ? {
              status: "running",
              pair: state.pair,
              entryId: state.entry.id,
              startedAtMs: this.#startedAtMs ?? Date.now(),
              note: state.entry.notes ?? null,
            }
          : { status: state.status },
      error: this.#error,
    };
  }

  /**
   * Validates and stores a pasted key, then loads the workspace. A company id may be
   * supplied explicitly — Keito's docs require the Keito-Account-Id header on every
   * request, including the /users/me call that would otherwise discover it.
   */
  async setApiKey(key: string, accountId?: string): Promise<Snapshot> {
    try {
      await this.#connect(key.trim(), {
        persist: true,
        ...(accountId?.trim() ? { accountId: accountId.trim() } : {}),
      });
      this.#error = null;
    } catch (error) {
      this.#keyStatus = error instanceof KeitoAuthError ? "rejected" : "missing";
      this.#recordFailure(error, "Connecting with a new key failed");
      if (error instanceof KeitoReadOnlyError) this.#error = error.message;
    }
    return this.snapshot();
  }

  /** Changes the company id without re-pasting the key, and reconnects with it. */
  async setCompanyId(accountId: string): Promise<Snapshot> {
    const key = await this.#secrets.read();
    if (!key) {
      this.#error = "Enter an API key first.";
      return this.snapshot();
    }
    const trimmed = accountId.trim();
    if (!trimmed) {
      this.#error = "A Company ID is required — Keito sends it on every request.";
      return this.snapshot();
    }
    try {
      await this.#connect(key, { accountId: trimmed });
      this.#error = null;
    } catch (error) {
      if (error instanceof KeitoAuthError) this.#keyStatus = "rejected";
      this.#recordFailure(error, "Changing the company id failed");
    }
    return this.snapshot();
  }

  async signOut(): Promise<Snapshot> {
    await this.#secrets.clear();
    this.#forgetConnection();
    await this.#prefs.update({ accountId: undefined });
    return this.snapshot();
  }

  /**
   * Everything the user has configured, gone: the API key, the account id, favourites,
   * hidden categories, the shortcut, the tray label. Deliberately more than `signOut`,
   * which keeps preferences so that signing back in lands you where you were.
   *
   * The caller re-registers the global shortcut afterwards — the hotkey is back at its
   * default, and only the main process can tell the OS about that.
   */
  async resetAll(): Promise<Snapshot> {
    this.#log.info("Clearing all configuration at the user's request");
    await this.#secrets.clear();
    this.#forgetConnection();
    await this.#prefs.reset();
    // The entries table and both windows derive from this; without a bump they would
    // keep rendering favourites that no longer exist.
    this.#revision++;
    return this.snapshot();
  }

  /** Drops the live connection and everything derived from it. Preferences are untouched. */
  #forgetConnection(): void {
    this.#client = null;
    this.#switcher = null;
    this.#identity = null;
    this.#catalog = [];
    this.#catalogLoadedAt = 0;
    this.#recents = [];
    this.#today = [];
    this.#yesterday = [];
    this.#keyStatus = "missing";
    this.#error = null;
    this.#apiKeyHint = null;
    this.#startedAtMs = null;
  }

  async switchTo(pairId: string, notes?: string): Promise<Snapshot> {
    const pair = this.#catalog.find((candidate) => candidate.id === pairId);
    if (!pair || !this.#switcher) return this.snapshot();
    return this.#run(async () => {
      await this.#switcher!.switchTo(pair, notes);
      const state = this.#switcher!.current();
      this.#startedAtMs =
        state.status === "running"
          ? startMsOf(state.entry, () => this.#prefs.get().workspaceTimezone)
          : Date.now();
      await this.#reloadEntries();
      // A new use changes the ranking, so recents are recomputed on the next refresh.
    });
  }

  /**
   * Resumes an entry logged earlier today. Uses Keito's restart endpoint so the time
   * accumulates on the existing entry instead of creating a second one for the same task.
   */
  async resumeEntry(entryId: string): Promise<Snapshot> {
    const entry = this.#today.find((candidate) => candidate.id === entryId);
    const pair = entry
      ? this.#catalog.find(
          (candidate) =>
            candidate.projectId === entry.project_id && candidate.taskId === entry.task_id,
        )
      : undefined;
    if (!entry || !pair || !this.#switcher) return this.snapshot();

    return this.#run(async () => {
      await this.#switcher!.restart(entryId, pair);
      const state = this.#switcher!.current();
      this.#startedAtMs =
        state.status === "running"
          ? startMsOf(state.entry, () => this.#prefs.get().workspaceTimezone)
          : Date.now();
      await this.#reloadEntries();
    });
  }

  async stopTimer(): Promise<Snapshot> {
    if (!this.#switcher) return this.snapshot();
    return this.#run(async () => {
      await this.#switcher!.stop();
      this.#startedAtMs = null;
      await this.#reloadEntries();
    });
  }

  async toggleFavourite(pairId: string): Promise<Snapshot> {
    const isFavourite = this.#prefs.get().favourites.includes(pairId);
    await (isFavourite ? this.#prefs.removeFavourite(pairId) : this.#prefs.addFavourite(pairId));
    this.#revision++;
    return this.snapshot();
  }

  /** Switches categories on or off in the dropdown. Takes a list so a whole project is one call. */
  async setHidden(pairIds: readonly string[], hidden: boolean): Promise<Snapshot> {
    for (const pairId of pairIds) await this.#prefs.setHidden(pairId, hidden);
    this.#revision++;
    return this.snapshot();
  }

  async setTrayLabel(options: { fallback: TrayFallback; prefix: TrayPrefix }): Promise<Snapshot> {
    await this.#prefs.update({ trayFallback: options.fallback, trayPrefix: options.prefix });
    return this.snapshot();
  }

  async setHotkey(hotkey: string): Promise<Snapshot> {
    await this.#prefs.update({ hotkey });
    return this.snapshot();
  }

  /** Told by the main process whether the OS actually accepted the accelerator. */
  setHotkeyRegistered(registered: boolean): void {
    this.#hotkeyRegistered = registered;
    if (!registered) this.#log.warn(`The shortcut ${this.#prefs.get().hotkey} was refused`);
  }

  /**
   * Told by the main process what the OS reports, since only it can ask. Kept here the
   * same way as the hotkey rather than imported directly, so this file stays free of
   * Electron and the value on the Snapshot is always one the OS confirmed.
   *
   * `available` is false in a development run. macOS names a login item after the bundle
   * that registered it, and under `npm run dev` that bundle is Electron.app — so the
   * system notification reads "Electron" and the stray item outlives the dev session.
   * There is no way to rename it: Electron's `path` and `name` overrides are Windows-only.
   */
  setOpenAtLogin(openAtLogin: boolean, available: boolean): void {
    this.#openAtLogin = openAtLogin;
    this.#canOpenAtLogin = available;
  }

  /**
   * Reloads what the UI shows. Normally one request: the catalog is cached, because
   * projects and tasks change far more slowly than the popover is opened.
   */
  async refresh(options: { force?: boolean } = {}): Promise<Snapshot> {
    if (!this.#client || !this.#switcher) return this.snapshot();
    return this.#run(async () => {
      const now = new Date();

      const stale = now.getTime() - this.#catalogLoadedAt > CATALOG_TTL_MS;
      if (options.force || stale || this.#catalog.length === 0) {
        try {
          this.#catalog = await loadCatalog(this.#client!, now);
          this.#catalogLoadedAt = now.getTime();
        } catch (error) {
          // A stale catalog beats an empty one; the client has already logged why.
          if (this.#catalog.length === 0) throw error;
          this.#log.warn("Kept the previous catalog: reloading it failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const { recents, today, yesterday, running } = await loadEntries(
        this.#client!,
        now,
        this.#prefs.get().workspaceTimezone,
      );
      this.#recents = recents;
      this.#today = today;
      this.#yesterday = yesterday;

      const before = this.#switcher!.current();
      this.#switcher!.adopt(running, this.#catalog);
      const after = this.#switcher!.current();
      if (after.status === "running" && before.status !== "running") {
        this.#startedAtMs = startMsOf(after.entry, () => this.#prefs.get().workspaceTimezone);
      }
    });
  }

  /** Entries for the review window, newest first. */
  async listEntries(from: string, to: string): Promise<TimeEntry[]> {
    if (!this.#client) return [];
    return this.#client.listTimeEntries({ from, to });
  }

  async updateEntry(
    id: string,
    patch: { notes?: string; startedTime?: string; endedTime?: string },
  ): Promise<Snapshot> {
    if (!this.#client) return this.snapshot();
    return this.#run(async () => {
      await this.#client!.updateTimeEntry(id, patch);
      await this.#reloadEntries();
    });
  }

  async deleteEntry(id: string): Promise<Snapshot> {
    if (!this.#client) return this.snapshot();
    return this.#run(async () => {
      await this.#client!.deleteTimeEntry(id);
      // A deleted entry may have been the running one; re-read what Keito now says.
      await this.#switcher?.refresh(this.#catalog);
      await this.#reloadEntries();
    });
  }

  /** Trims the running entry back to when the user went idle, then stops it. */
  async discardIdleSince(awaySince: Date): Promise<Snapshot> {
    const state = this.#switcher?.current();
    if (!state || state.status !== "running" || !this.#client) return this.snapshot();

    const zone = this.#prefs.get().workspaceTimezone;
    return this.#run(async () => {
      await this.#client!.updateTimeEntry(state.entry.id, {
        endedTime: formatWorkspaceTime(awaySince, zone),
      });
      await this.#switcher!.refresh(this.#catalog);
      this.#startedAtMs = null;
    });
  }

  async #connect(
    key: string,
    options: { persist?: boolean; accountId?: string } = {},
  ): Promise<void> {
    // Explicit beats remembered. Keito rejects any request without this header, so there
    // is no discovery path to fall back to.
    const stored = this.#prefs.get().accountId;
    const accountId = options.accountId ?? stored;

    this.#log.info("Connecting", { accountId: accountId ?? null });

    const probe = new KeitoClient({
      apiKey: key,
      ...(accountId ? { accountId } : {}),
      fetch,
      onRequest: this.#logRequest,
    });
    const identity = await probe.validateKey();

    this.#log.info("Connected", { accountId: identity.accountId, user: identity.userId });

    this.#client = new KeitoClient({
      apiKey: key,
      accountId: identity.accountId,
      fetch,
      onRequest: this.#logRequest,
    });
    this.#switcher = new TimerSwitcher({
      client: this.#client,
      now: () => new Date(),
      timeZone: () => this.#prefs.get().workspaceTimezone,
    });
    this.#identity = identity;
    this.#keyStatus = "ready";
    this.#apiKeyHint = maskKey(key);

    if (options.persist) await this.#secrets.write(key);
    if (stored !== identity.accountId) await this.#prefs.update({ accountId: identity.accountId });

    await this.refresh();
  }

  /**
   * One request after a mutation, so today's list and the recents ranking both stay
   * honest. The catalog is untouched — nothing a timer does changes the project list.
   *
   * Deliberately does not touch the timer state: the mutation's own response is
   * authoritative, and re-deriving it here would race with it.
   */
  async #reloadEntries(): Promise<void> {
    if (!this.#client) return;
    const { recents, today, yesterday } = await loadEntries(
      this.#client,
      new Date(),
      this.#prefs.get().workspaceTimezone,
    );
    this.#recents = recents;
    this.#today = today;
    this.#yesterday = yesterday;
  }

  readonly #logRequest = (record: RequestRecord): void => {
    const line = `${record.method} ${record.path} -> ${record.status ?? "no response"} (${record.durationMs}ms)`;
    if (record.ok) this.#log.info(line);
    else this.#log.warn(line, record.error ? { error: record.error } : undefined);
  };

  /** Runs an action, capturing the failure for the UI instead of crashing the app. */
  async #run(action: () => Promise<void>): Promise<Snapshot> {
    try {
      await action();
      this.#revision++;
      this.#error = null;
    } catch (error) {
      if (error instanceof KeitoAuthError) this.#keyStatus = "rejected";
      this.#recordFailure(error);
    }
    return this.snapshot();
  }

  /** Puts a failure in front of the user and in the log, with the detail the log needs. */
  #recordFailure(error: unknown, context = "Request failed"): void {
    const message = error instanceof Error ? error.message : String(error);
    this.#error = message;
    this.#log.error(`${context}: ${message}`, {
      type: error instanceof Error ? error.constructor.name : typeof error,
      ...(error instanceof KeitoError && error.status !== undefined ? { status: error.status } : {}),
      ...(error instanceof KeitoError && error.path !== undefined ? { path: error.path } : {}),
      ...(error instanceof Error && error.cause ? { cause: String(error.cause) } : {}),
    });
  }
}
