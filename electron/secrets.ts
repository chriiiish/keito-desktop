import { safeStorage } from "electron";
import { readFile, writeFile, rm } from "node:fs/promises";

/**
 * The Keito API key, encrypted at rest by the OS (Keychain on macOS, DPAPI on Windows).
 * Kept out of preferences.json deliberately — that file is plain text.
 */
export class SecretStore {
  #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async read(): Promise<string | null> {
    try {
      const encrypted = await readFile(this.#path);
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(encrypted);
    } catch {
      return null;
    }
  }

  async write(value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("This system has no secure storage available for the API key.");
    }
    await writeFile(this.#path, safeStorage.encryptString(value));
  }

  async clear(): Promise<void> {
    await rm(this.#path, { force: true });
  }
}
