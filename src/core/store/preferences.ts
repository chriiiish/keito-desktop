import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DEFAULT_HOTKEY = "CommandOrControl+Shift+K";

export interface Preferences {
  /** Pair ids, in the order the user favourited them — the order the popover lists them. */
  favourites: string[];
  /** Discovered from /users/me at setup, so it is not re-derived every launch. */
  accountId?: string;
  /**
   * Only used to render and parse the HH:mm times Keito exchanges. The switching path
   * never touches it, because the server sets those timestamps.
   */
  workspaceTimezone: string;
  hotkey: string;
}

const defaults = (): Preferences => ({
  favourites: [],
  workspaceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  hotkey: DEFAULT_HOTKEY,
});

/** Favourites and settings on disk. The API key is not here — that lives in the OS keychain. */
export class PreferencesStore {
  #path: string;
  #value: Preferences;

  private constructor(path: string, value: Preferences) {
    this.#path = path;
    this.#value = value;
  }

  static async open(path: string): Promise<PreferencesStore> {
    let value = defaults();
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<Preferences>;
      value = { ...value, ...parsed, favourites: parsed.favourites ?? [] };
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

  async addFavourite(pairId: string): Promise<void> {
    if (this.#value.favourites.includes(pairId)) return;
    await this.update({ favourites: [...this.#value.favourites, pairId] });
  }

  async removeFavourite(pairId: string): Promise<void> {
    await this.update({ favourites: this.#value.favourites.filter((id) => id !== pairId) });
  }

  async #flush(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    // Write-then-rename: a crash mid-write must not leave unreadable preferences.
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, JSON.stringify(this.#value, null, 2), "utf8");
    await rename(temporary, this.#path);
  }
}
