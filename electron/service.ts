import { buildPicker } from "../src/core/catalog/picker.js";
import { loadWorkspace, type Workspace } from "../src/core/catalog/workspace.js";
import { KeitoClient } from "../src/core/keito/client.js";
import { KeitoAuthError, KeitoReadOnlyError } from "../src/core/keito/errors.js";
import type { Identity, Pair, TimeEntry } from "../src/core/keito/types.js";
import { PreferencesStore } from "../src/core/store/preferences.js";
import { TimerSwitcher, type TimerState } from "../src/core/timer/switcher.js";
import { formatWorkspaceTime, parseWorkspaceTime } from "../src/core/time/workspace-time.js";
import type { SecretStore } from "./secrets.js";

/** Everything the renderer needs to draw either window. */
export interface Snapshot {
  keyStatus: "missing" | "ready" | "rejected";
  identity: Identity | null;
  catalog: Pair[];
  recents: string[];
  favourites: string[];
  workspaceTimezone: string;
  hotkey: string;
  /** The company id sent as Keito-Account-Id, once known. */
  accountId: string | null;
  timer:
    | { status: "idle" }
    | { status: "running"; pair: Pair; entryId: string; startedAtMs: number }
    | { status: "needs-auth" };
  error: string | null;
}

/**
 * Ties the tested core to the OS: holds the client, the switcher and the stores, and
 * renders a single Snapshot the UI can draw without further round trips.
 */
export class AppService {
  #prefs: PreferencesStore;
  #secrets: SecretStore;
  #client: KeitoClient | null = null;
  #switcher: TimerSwitcher | null = null;
  #identity: Identity | null = null;
  #workspace: Workspace = { catalog: [], recents: [] };
  #keyStatus: Snapshot["keyStatus"] = "missing";
  #error: string | null = null;
  #startedAtMs: number | null = null;

  private constructor(prefs: PreferencesStore, secrets: SecretStore) {
    this.#prefs = prefs;
    this.#secrets = secrets;
  }

  static async create(prefs: PreferencesStore, secrets: SecretStore): Promise<AppService> {
    const service = new AppService(prefs, secrets);
    const key = await secrets.read();
    if (key) await service.#connect(key);
    return service;
  }

  snapshot(): Snapshot {
    const prefs = this.#prefs.get();
    const state: TimerState = this.#switcher?.current() ?? { status: "idle" };
    return {
      keyStatus: this.#keyStatus,
      identity: this.#identity,
      catalog: this.#workspace.catalog,
      recents: this.#workspace.recents,
      favourites: [...prefs.favourites],
      workspaceTimezone: prefs.workspaceTimezone,
      hotkey: prefs.hotkey,
      accountId: prefs.accountId ?? null,
      timer:
        state.status === "running"
          ? {
              status: "running",
              pair: state.pair,
              entryId: state.entry.id,
              startedAtMs: this.#startedAtMs ?? Date.now(),
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
      this.#error =
        error instanceof KeitoReadOnlyError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
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
    try {
      const trimmed = accountId.trim();
      await this.#connect(key, trimmed ? { accountId: trimmed } : { rediscover: true });
      this.#error = null;
    } catch (error) {
      if (error instanceof KeitoAuthError) this.#keyStatus = "rejected";
      this.#error = error instanceof Error ? error.message : String(error);
    }
    return this.snapshot();
  }

  async signOut(): Promise<Snapshot> {
    await this.#secrets.clear();
    this.#client = null;
    this.#switcher = null;
    this.#identity = null;
    this.#workspace = { catalog: [], recents: [] };
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
      this.#startedAtMs = Date.now();
      // A new use changes the ranking, so recents are recomputed on the next refresh.
    });
  }

  async stopTimer(): Promise<Snapshot> {
    if (!this.#switcher) return this.snapshot();
    return this.#run(async () => {
      await this.#switcher!.stop();
      this.#startedAtMs = null;
    });
  }

  async toggleFavourite(pairId: string): Promise<Snapshot> {
    const isFavourite = this.#prefs.get().favourites.includes(pairId);
    await (isFavourite ? this.#prefs.removeFavourite(pairId) : this.#prefs.addFavourite(pairId));
    return this.snapshot();
  }

  async setHotkey(hotkey: string): Promise<Snapshot> {
    await this.#prefs.update({ hotkey });
    return this.snapshot();
  }

  async refresh(): Promise<Snapshot> {
    if (!this.#client || !this.#switcher) return this.snapshot();
    return this.#run(async () => {
      this.#workspace = await loadWorkspace(this.#client!, new Date());
      const before = this.#switcher!.current();
      await this.#switcher!.refresh(this.#workspace.catalog);
      const after = this.#switcher!.current();
      if (after.status === "running" && before.status !== "running") {
        // Adopted a timer started elsewhere; we only know the date and HH:mm it began.
        this.#startedAtMs = this.#adoptedStartMs(after.entry);
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
  ): Promise<TimeEntry | null> {
    if (!this.#client) return null;
    const { etag } = await this.#client.getTimeEntry(id);
    return this.#client.updateTimeEntry(id, patch, etag ?? "");
  }

  async deleteEntry(id: string): Promise<void> {
    if (!this.#client) return;
    const { etag } = await this.#client.getTimeEntry(id);
    await this.#client.deleteTimeEntry(id, etag ?? "");
  }

  /** Trims the running entry back to when the user went idle, then stops it. */
  async discardIdleSince(awaySince: Date): Promise<Snapshot> {
    const state = this.#switcher?.current();
    if (!state || state.status !== "running" || !this.#client) return this.snapshot();

    const zone = this.#prefs.get().workspaceTimezone;
    return this.#run(async () => {
      const { etag } = await this.#client!.getTimeEntry(state.entry.id);
      await this.#client!.updateTimeEntry(
        state.entry.id,
        { endedTime: formatWorkspaceTime(awaySince, zone) },
        etag ?? "",
      );
      await this.#switcher!.refresh(this.#workspace.catalog);
      this.#startedAtMs = null;
    });
  }

  async #connect(
    key: string,
    options: { persist?: boolean; accountId?: string; rediscover?: boolean } = {},
  ): Promise<void> {
    // Explicit beats remembered; `rediscover` deliberately sends no header so the server
    // reports the token's own company.
    const stored = this.#prefs.get().accountId;
    const accountId = options.accountId ?? (options.rediscover ? undefined : stored);

    const probe = new KeitoClient({
      apiKey: key,
      ...(accountId ? { accountId } : {}),
      fetch,
    });
    const identity = await probe.validateKey();

    this.#client = new KeitoClient({ apiKey: key, accountId: identity.accountId, fetch });
    this.#switcher = new TimerSwitcher({ client: this.#client, now: () => new Date() });
    this.#identity = identity;
    this.#keyStatus = "ready";

    if (options.persist) await this.#secrets.write(key);
    if (stored !== identity.accountId) await this.#prefs.update({ accountId: identity.accountId });

    await this.refresh();
  }

  /** Reconstructs an adopted timer's start from its spent_date and HH:mm start. */
  #adoptedStartMs(entry: TimeEntry): number {
    if (!entry.started_time) return Date.now();
    try {
      const zone = this.#prefs.get().workspaceTimezone;
      return parseWorkspaceTime(entry.spent_date, entry.started_time, zone).getTime();
    } catch {
      return Date.now();
    }
  }

  /** Runs an action, capturing the failure for the UI instead of crashing the app. */
  async #run(action: () => Promise<void>): Promise<Snapshot> {
    try {
      await action();
      this.#error = null;
    } catch (error) {
      if (error instanceof KeitoAuthError) this.#keyStatus = "rejected";
      this.#error = error instanceof Error ? error.message : String(error);
    }
    return this.snapshot();
  }
}
