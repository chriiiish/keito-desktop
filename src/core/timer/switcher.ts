import type { KeitoClient } from "../keito/client.js";
import { KeitoAuthError } from "../keito/errors.js";
import type { Pair, TimeEntry } from "../keito/types.js";

export type TimerState =
  | { status: "idle" }
  | { status: "running"; pair: Pair; entry: TimeEntry }
  /** The key was rejected. The UI routes this to settings rather than a generic error. */
  | { status: "needs-auth" };

export interface TimerSwitcherOptions {
  client: KeitoClient;
  now: () => Date;
}

/**
 * Owns "what am I timing right now". Keito is the source of truth; this holds the last
 * answer the server gave so the tray can render it without a round trip.
 */
export class TimerSwitcher {
  #client: KeitoClient;
  #now: () => Date;
  #state: TimerState = { status: "idle" };

  constructor(options: TimerSwitcherOptions) {
    this.#client = options.client;
    this.#now = options.now;
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
        spentDate: this.#now().toISOString().slice(0, 10),
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

    // A timer we adopted from another client has no ETag yet; read it to get one.
    await this.#guard(() => this.#client.stopTimeEntry(state.entry.id));
    this.#state = { status: "idle" };
  }

  /**
   * Asks Keito what is running — which may be a timer started in the web app or on
   * another machine — and matches it back to a pair in the catalog.
   */
  async refresh(catalog: readonly Pair[]): Promise<void> {
    const [running] = await this.#guard(() => this.#client.listTimeEntries({ isRunning: true }));
    if (!running) {
      this.#state = { status: "idle" };
      return;
    }

    const pair = catalog.find(
      (candidate) => candidate.projectId === running.project_id && candidate.taskId === running.task_id,
    );
    this.#state = pair ? { status: "running", pair, entry: running } : { status: "idle" };
  }
}
