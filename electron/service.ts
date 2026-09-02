import { buildPicker } from "../src/core/catalog/picker.js";
import { loadWorkspace, type Workspace } from "../src/core/catalog/workspace.js";
import { KeitoClient, type RequestRecord } from "../src/core/keito/client.js";
import { KeitoAuthError, KeitoError, KeitoReadOnlyError } from "../src/core/keito/errors.js";
import type { Identity, Pair, TimeEntry } from "../src/core/keito/types.js";
import { PreferencesStore } from "../src/core/store/preferences.js";
import type { TrayFallback, TrayPrefix } from "../src/core/tray/label.js";
import { TimerSwitcher, type TimerState } from "../src/core/timer/switcher.js";
import { formatWorkspaceTime, parseWorkspaceTime } from "../src/core/time/workspace-time.js";
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
  favourites: string[];
  /** Pair ids switched off in settings; favourites and recents override this. */
  hidden: string[];
  workspaceTimezone: string;
  hotkey: string;
  /** The company id sent as Keito-Account-Id, once known. */
  accountId: string | null;
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
 * When a timer began, in epoch ms. The live API supplies `timer_started_at` as a real
 * instant; the spent_date + HH:mm reconstruction is only a fallback for entries without it.
 */
function startMsOf(entry: TimeEntry, timeZone: () => string): number {
  if (entry.timer_started_at) {
    const parsed = Date.parse(entry.timer_started_at);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (entry.started_time) {
    try {
      return parseWorkspaceTime(entry.spent_date, entry.started_time, timeZone()).getTime();
    } catch {
      // Falls through to "now", which is wrong but harmless: the clock just restarts.
    }
  }
  return Date.now();
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
  #workspace: Workspace = { catalog: [], recents: [], today: [] };
  #keyStatus: Snapshot["keyStatus"] = "missing";
  #error: string | null = null;
  #startedAtMs: number | null = null;
  #revision = 0;

  private constructor(prefs: PreferencesStore, secrets: SecretStore, log: Logger) {
    this.#prefs = prefs;
    this.#secrets = secrets;
    this.#log = log;
  }

  static async create(
    prefs: PreferencesStore,
    secrets: SecretStore,
    log: Logger,
  ): Promise<AppService> {
    const service = new AppService(prefs, secrets, log);
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
      catalog: this.#workspace.catalog,
      recents: this.#workspace.recents,
      today: this.#workspace.today,
      favourites: [...prefs.favourites],
      hidden: [...prefs.hidden],
      workspaceTimezone: prefs.workspaceTimezone,
      hotkey: prefs.hotkey,
      accountId: prefs.accountId ?? null,
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
    this.#client = null;
    this.#switcher = null;
    this.#identity = null;
    this.#workspace = { catalog: [], recents: [], today: [] };
    this.#keyStatus = "missing";
    this.#error = null;
    await this.#prefs.update({ accountId: undefined });
    return this.snapshot();
  }

  async switchTo(pairId: string, notes?: string): Promise<Snapshot> {
    const pair = this.#workspace.catalog.find((candidate) => candidate.id === pairId);
    if (!pair || !this.#switcher) return this.snapshot();
    return this.#run(async () => {
      await this.#switcher!.switchTo(pair, notes);
      const state = this.#switcher!.current();
      this.#startedAtMs =
        state.status === "running"
          ? startMsOf(state.entry, () => this.#prefs.get().workspaceTimezone)
          : Date.now();
      await this.#reloadToday();
      // A new use changes the ranking, so recents are recomputed on the next refresh.
    });
  }

  /**
   * Resumes an entry logged earlier today. Uses Keito's restart endpoint so the time
   * accumulates on the existing entry instead of creating a second one for the same task.
   */
  async resumeEntry(entryId: string): Promise<Snapshot> {
    const entry = this.#workspace.today.find((candidate) => candidate.id === entryId);
    const pair = entry
      ? this.#workspace.catalog.find(
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
      await this.#reloadToday();
    });
  }

  async stopTimer(): Promise<Snapshot> {
    if (!this.#switcher) return this.snapshot();
    return this.#run(async () => {
      await this.#switcher!.stop();
      this.#startedAtMs = null;
      await this.#reloadToday();
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

  async refresh(): Promise<Snapshot> {
    if (!this.#client || !this.#switcher) return this.snapshot();
    return this.#run(async () => {
      this.#workspace = await loadWorkspace(this.#client!, new Date(), (project, error) => {
        this.#log.warn(`Skipped project "${project.name}": its tasks would not load`, {
          projectId: project.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      const before = this.#switcher!.current();
      await this.#switcher!.refresh(this.#workspace.catalog);
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
      await this.#reloadToday();
    });
  }

  async deleteEntry(id: string): Promise<Snapshot> {
    if (!this.#client) return this.snapshot();
    return this.#run(async () => {
      await this.#client!.deleteTimeEntry(id);
      // A deleted entry may have been the running one; re-read what Keito now says.
      await this.#switcher?.refresh(this.#workspace.catalog);
      await this.#reloadToday();
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
      await this.#switcher!.refresh(this.#workspace.catalog);
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
    this.#switcher = new TimerSwitcher({ client: this.#client, now: () => new Date() });
    this.#identity = identity;
    this.#keyStatus = "ready";

    if (options.persist) await this.#secrets.write(key);
    if (stored !== identity.accountId) await this.#prefs.update({ accountId: identity.accountId });

    await this.refresh();
  }

  /** One cheap request, so today's list stays honest after a mutation. */
  async #reloadToday(): Promise<void> {
    if (!this.#client) return;
    const day = new Date().toISOString().slice(0, 10);
    this.#workspace = { ...this.#workspace, today: await this.#client.listTimeEntries({ from: day, to: day }) };
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
