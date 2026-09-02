import type { KeitoClient } from "../keito/client.js";
import { KeitoAuthError } from "../keito/errors.js";
import { pairId } from "../catalog/catalog.js";
import type { Pair, TimeEntry } from "../keito/types.js";
import { workspaceDate } from "../time/workspace-time.js";

export type TimerState =
  | { status: "idle" }
  | { status: "running"; pair: Pair; entry: TimeEntry }
  /** The key was rejected. The UI routes this to settings rather than a generic error. */
  | { status: "needs-auth" };

/**
 * The catalog is the source of display names, but a timer can be running against a project
 * that has since been archived or switched off. The entry embeds both names, so fall back
 * to those rather than pretending nothing is running.
 */
function pairFor(entry: TimeEntry, catalog: readonly Pair[]): Pair {
  const known = catalog.find(
    (candidate) => candidate.projectId === entry.project_id && candidate.taskId === entry.task_id,
  );
  if (known) return known;

  return {
    id: pairId(entry.project_id, entry.task_id),
    projectId: entry.project_id,
    projectName: entry.project?.name ?? "Unknown project",
    taskId: entry.task_id,
    taskName: entry.task?.name ?? "Unknown task",
  };
}

export interface TimerSwitcherOptions {
  client: KeitoClient;
  now: () => Date;
  /** The workspace's timezone, read afresh each time — the setting can change. */
  timeZone: () => string;
}

/**
 * Owns "what am I timing right now". Keito is the source of truth; this holds the last
 * answer the server gave so the tray can render it without a round trip.
 */
export class TimerSwitcher {
  #client: KeitoClient;
  #now: () => Date;
  #timeZone: () => string;
  #state: TimerState = { status: "idle" };

  constructor(options: TimerSwitcherOptions) {
    this.#client = options.client;
    this.#now = options.now;
    this.#timeZone = options.timeZone;
  }

  current(): TimerState {
    return this.#state;
  }

  async switchTo(pair: Pair, notes?: string): Promise<void> {
    // On failure the previous state stands: a switch that never reached Keito must not
    // stop the clock on work that is still happening.
    const entry = await this.#guard(() =>
      this.#client.createTimeEntry({
        projectId: pair.projectId,
        taskId: pair.taskId,
        // The workspace's calendar date, not UTC's: they are different days for part of
        // every day almost everywhere, and this one decides which day the work lands on.
        spentDate: workspaceDate(this.#now(), this.#timeZone()),
        isRunning: true,
        // Unconditional: "switch" always means "make this the running timer". This is
        // also race-free if another device started a timer since our last refresh.
        replaceRunning: true,
        ...(notes ? { notes } : {}),
      }),
    );
    this.#state = { status: "running", pair, entry };
  }

  /** Runs a call, downgrading the whole session to needs-auth if the key is refused. */
  async #guard<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof KeitoAuthError) this.#state = { status: "needs-auth" };
      throw error;
    }
  }

  /** Resumes an entry logged earlier today, replacing whatever is running. */
  async restart(entryId: string, pair: Pair): Promise<void> {
    const entry = await this.#guard(() =>
      this.#client.restartTimeEntry(entryId, { replaceRunning: true }),
    );
    this.#state = { status: "running", pair, entry };
  }

  async stop(): Promise<void> {
    const state = this.#state;
    if (state.status !== "running") return;

    // The server sets the end time; there is nothing to send and nothing to read first.
    await this.#guard(() => this.#client.stopTimeEntry(state.entry.id));
    this.#state = { status: "idle" };
  }

  /**
   * Records what Keito says is running, from entries the caller already has. Separate
   * from refresh() so a workspace load does not pay for a second request to learn it.
   */
  adopt(running: TimeEntry | null, catalog: readonly Pair[]): void {
    if (!running) {
      this.#state = { status: "idle" };
      return;
    }
    this.#state = { status: "running", pair: pairFor(running, catalog), entry: running };
  }

  /**
   * Asks Keito what is running — a timer may have been started in the web app or on
   * another machine. Prefer adopt() when the entries are already to hand.
   */
  async refresh(catalog: readonly Pair[]): Promise<void> {
    const [running] = await this.#guard(() => this.#client.listTimeEntries({ isRunning: true }));
    this.adopt(running ?? null, catalog);
  }
}
