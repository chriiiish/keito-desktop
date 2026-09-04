import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TrayFallback, TrayPrefix } from "../tray/label.js";

export const DEFAULT_HOTKEY = "CommandOrControl+Shift+K";

export interface Preferences {
  /** Pair ids, in the order the user favourited them — the order the popover lists them. */
  favourites: string[];
  /**
   * Sent as the Keito-Account-Id header. Either entered by the user or discovered from
   * /users/me at setup. Explicitly undefined-able so disconnecting can clear it.
   */
  accountId?: string | undefined;
  /**
   * Only used to render and parse the HH:mm times Keito exchanges. The switching path
   * never touches it, because the server sets those timestamps.
   */
  workspaceTimezone: string;
  hotkey: string;
  /** Pair ids switched off in settings. Exclusions, so new categories appear by default. */
  hidden: string[];
  /** What the tray shows when the running entry has no note. */
  trayFallback: TrayFallback;
  /** What, if anything, precedes the note in the tray. */
  trayPrefix: TrayPrefix;
  /**
   * The version of an update notice the user has dismissed, e.g. "0.3.0".
   *
   * Per version rather than a boolean, so dismissing 0.3.0 silences that release and
   * nothing else: the notice returns of its own accord when 0.4.0 ships, instead of
   * staying off forever because it was waved away once. Undefined means nothing dismissed.
   *
   * Only the popover notice honours it — the Update Available tab stays, so a dismissed
   * update is still somewhere to be found rather than gone.
   */
  dismissedUpdate?: string | undefined;
  /**
   * Whether update checks look at pre-releases as well as stable ones.
   *
   * Off by default: a release the project has flagged as not ready is not something to
   * push at someone who never asked for it.
   */
  includePrereleases: boolean;
}

const defaults = (): Preferences => ({
  favourites: [],
  hidden: [],
  workspaceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  hotkey: DEFAULT_HOTKEY,
  trayFallback: "task",
  trayPrefix: "none",
  includePrereleases: false,
});

/** Favourites and settings on disk. The API key is not here — that lives in the OS keychain. */
export class PreferencesStore {
  #path: string;
  #value: Preferences;
  /** Tail of the write queue — see #flush. */
  #writing: Promise<void> = Promise.resolve();

  private constructor(path: string, value: Preferences) {
    this.#path = path;
    this.#value = value;
  }

  static async open(path: string): Promise<PreferencesStore> {
    let value = defaults();
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<Preferences>;
      value = {
        ...value,
        ...parsed,
        favourites: parsed.favourites ?? [],
        hidden: parsed.hidden ?? [],
      };
    } catch {
      // Missing or corrupt: a fresh set of defaults beats refusing to start.
    }
    return new PreferencesStore(path, value);
  }

  get(): Readonly<Preferences> {
    return this.#value;
  }

  async update(patch: Partial<Preferences>): Promise<void> {
    this.#value = { ...this.#value, ...patch };
    await this.#flush();
  }

  /** Switches a category off (or back on) in the dropdown. */
  async setHidden(pairId: string, hidden: boolean): Promise<void> {
    const current = this.#value.hidden;
    if (hidden === current.includes(pairId)) return;
    await this.update({
      hidden: hidden ? [...current, pairId] : current.filter((id) => id !== pairId),
    });
  }

  async addFavourite(pairId: string): Promise<void> {
    if (this.#value.favourites.includes(pairId)) return;
    await this.update({ favourites: [...this.#value.favourites, pairId] });
  }

  async removeFavourite(pairId: string): Promise<void> {
    await this.update({ favourites: this.#value.favourites.filter((id) => id !== pairId) });
  }

  /**
   * Back to a fresh install. Whole-value, not a patch, so a preference added later is
   * cleared by having been forgotten rather than by someone remembering to list it here.
   * The file is rewritten rather than deleted: `open()` tolerates a missing file, but
   * leaving one behind that says nothing is clearer than leaving none at all.
   */
  async reset(): Promise<void> {
    this.#value = defaults();
    await this.#flush();
  }

  /**
   * Serialised, because two writes overlapping would race for the same temporary file:
   * the second `writeFile` would land under the first's `rename` and the loser would fail
   * with ENOENT. Windows is stricter about this than macOS, and starring a category in the
   * popover while toggling one in the settings window is enough to hit it.
   */
  async #flush(): Promise<void> {
    this.#writing = this.#writing.then(() => this.#writeNow()).catch(() => this.#writeNow());
    return this.#writing;
  }

  async #writeNow(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    // Write-then-rename: a crash mid-write must not leave unreadable preferences.
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, JSON.stringify(this.#value, null, 2), "utf8");
    await rename(temporary, this.#path);
  }
}
