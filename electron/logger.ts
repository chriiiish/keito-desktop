import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

const MAX_BYTES = 512 * 1024;

/**
 * Append-only log for diagnosing connection problems. Synchronous on purpose: a crash
 * during startup must not lose the line that explains it.
 *
 * Nothing here is allowed to see the API key — the client's RequestRecord carries only
 * method, path, status and timing, and `redact` is a second line of defence for messages
 * that pass through free-form.
 */
export class Logger {
  #path: string;

  constructor(path: string) {
    this.#path = path;
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      // A logger that cannot start must not stop the app from starting.
    }
  }

  get path(): string {
    return this.#path;
  }

  info(message: string, detail?: Record<string, unknown>): void {
    this.#write("INFO", message, detail);
  }

  warn(message: string, detail?: Record<string, unknown>): void {
    this.#write("WARN", message, detail);
  }

  error(message: string, detail?: Record<string, unknown>): void {
    this.#write("ERROR", message, detail);
  }

  #write(level: string, message: string, detail?: Record<string, unknown>): void {
    const parts = [new Date().toISOString(), level, redact(message)];
    if (detail && Object.keys(detail).length > 0) parts.push(redact(JSON.stringify(detail)));

    try {
      this.#rotate();
      appendFileSync(this.#path, `${parts.join(" ")}\n`, "utf8");
    } catch {
      // Disk full, read-only volume: never let logging take the app down.
    }
  }

  #rotate(): void {
    try {
      if (statSync(this.#path).size > MAX_BYTES) renameSync(this.#path, `${this.#path}.1`);
    } catch {
      // No file yet, which is the normal first-write case.
    }
  }
}

/** Masks anything that looks like a Keito key, wherever it came from. */
export function redact(text: string): string {
  return text.replace(/kto_[A-Za-z0-9_-]+/g, "kto_***");
}
