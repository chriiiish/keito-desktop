import {
  KeitoAccountIdRequiredError,
  KeitoAuthError,
  KeitoConflictError,
  KeitoError,
  KeitoNetworkError,
  KeitoReadOnlyError,
  KeitoRequestError,
} from "./errors.js";
import type { Identity, Project, TimeEntry } from "./types.js";

export const KEITO_BASE_URL = "https://app.keito.ai/api/v2";

/** Pulls a human-readable reason out of an error response, whatever shape it arrives in. */
async function readErrorDetail(response: Response): Promise<string | null> {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const field of ["message", "error", "detail", "error_description"]) {
      const value = parsed[field];
      if (typeof value === "string" && value) return value;
    }
    return JSON.stringify(parsed).slice(0, 300);
  } catch {
    // HTML error pages and proxy responses land here.
    return text.replace(/\s+/g, " ").trim().slice(0, 200);
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    return code ? `${cause.message} (${code})` : cause.message;
  }
  return String(cause);
}

/** One line of the request log. Deliberately carries no credentials. */
export interface RequestRecord {
  method: string;
  path: string;
  status?: number;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface KeitoClientOptions {
  apiKey: string;
  /** Omitted on first run: validateKey() discovers it from the identity response. */
  accountId?: string;
  baseUrl?: string;
  fetch: typeof fetch;
  /** Called once per request, for logging. Never receives the API key. */
  onRequest?: (record: RequestRecord) => void;
  /** Base backoff between retries of a throttled request. Tests set this to 0. */
  retryDelayMs?: number;
}

/** Statuses worth trying again: Keito throttles /tasks under load with a 503. */
const RETRYABLE = new Set([429, 502, 503, 504]);

/** Keito's maximum page size. Fewer, larger pages means fewer round trips. */
const PAGE_SIZE = 200;
/** A guard against an endpoint that never stops reporting more pages. */
const MAX_PAGES = 25;
const MAX_ATTEMPTS = 3;

/**
 * Single entries come back unwrapped from the live API, though the docs describe a
 * `time_entry` wrapper. Accept either rather than crash on the difference.
 */
function unwrapEntry(body: unknown): TimeEntry {
  const wrapped = body as { time_entry?: TimeEntry };
  return wrapped?.time_entry ?? (body as TimeEntry);
}

export interface CreateTimeEntryInput {
  projectId: string;
  taskId: string;
  /** YYYY-MM-DD in the workspace timezone. */
  spentDate: string;
  isRunning?: boolean;
  /** Atomically stops whatever is running before starting this one. */
  replaceRunning?: boolean;
  /** The client-visible note. */
  notes?: string;
  /** The team-only note. One or the other is sent, never both — see NoteVisibility. */
  internalNotes?: string;
  idempotencyKey?: string;
}

export interface UpdateTimeEntryInput {
  notes?: string;
  internalNotes?: string;
  /** HH:mm in the workspace timezone — see core/time/workspace-time. */
  startedTime?: string;
  endedTime?: string;
  spentDate?: string;
}

export class KeitoClient {
  #apiKey: string;
  #accountId: string | undefined;
  #baseUrl: string;
  #fetch: typeof fetch;
  #onRequest: ((record: RequestRecord) => void) | undefined;
  #retryDelayMs: number;

  constructor(options: KeitoClientOptions) {
    this.#apiKey = options.apiKey;
    this.#accountId = options.accountId;
    this.#baseUrl = options.baseUrl ?? KEITO_BASE_URL;
    this.#fetch = options.fetch;
    this.#onRequest = options.onRequest;
    this.#retryDelayMs = options.retryDelayMs ?? 400;
  }

  async validateKey(): Promise<Identity> {
    const { body: raw } = await this.#request("/users/me");
    const body = raw as {
      id: string;
      first_name: string;
      company?: { id: string; name: string };
    };
    if (!body.company) {
      // Full-access keys always carry `company`; sync keys deliberately omit it.
      throw new KeitoReadOnlyError(
        "This looks like a personal sync key, which is read-only. Ask an administrator for a full-access integration key.",
      );
    }
    const company = body.company;
    return {
      userId: body.id,
      name: body.first_name,
      // A company id the user configured is what the header carries, so it wins.
      accountId: this.#accountId ?? company.id,
      accountName: company.name,
    };
  }

  /**
   * Creates a time entry. For a running timer pass `isRunning` and no hours: the server
   * sets the start time, so the client never converts a timezone.
   */
  async createTimeEntry(input: CreateTimeEntryInput): Promise<TimeEntry> {
    const body: Record<string, unknown> = {
      project_id: input.projectId,
      task_id: input.taskId,
      spent_date: input.spentDate,
      source: "desktop",
    };
    if (input.isRunning) body["is_running"] = true;
    if (input.replaceRunning) body["replace_running"] = true;
    if (input.notes) body["notes"] = input.notes;
    if (input.internalNotes) body["internal_notes"] = input.internalNotes;

    const { body: created } = await this.#request("/time_entries", {
      method: "POST",
      body,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    return unwrapEntry(created);
  }

  /**
   * Active projects, each with its assigned tasks embedded — the live API returns them
   * inline, so the whole catalog costs one paged request rather than one per project.
   */
  async listProjects(): Promise<Project[]> {
    return this.#paged<Project>("/projects", "projects", { is_active: "true" });
  }

  /** Lists time entries. `isRunning` narrows to the one active timer. */
  async listTimeEntries(
    filter: { isRunning?: boolean; from?: string; to?: string } = {},
  ): Promise<TimeEntry[]> {
    const params: Record<string, string> = {};
    if (filter.isRunning !== undefined) params["is_running"] = String(filter.isRunning);
    if (filter.from) params["from"] = filter.from;
    if (filter.to) params["to"] = filter.to;
    return this.#paged<TimeEntry>("/time_entries", "time_entries", params);
  }

  /**
   * Reads every page of a list endpoint. Without this a busy month would be ranked from
   * the first page alone, which is silently wrong rather than visibly broken.
   */
  async #paged<T>(path: string, key: string, params: Record<string, string> = {}): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page++) {
      const query = new URLSearchParams({ ...params, per_page: String(PAGE_SIZE), page: String(page) });
      const { body } = await this.#request(`${path}?${query}`);
      const parsed = body as Record<string, unknown> & { total_pages?: number };
      items.push(...((parsed[key] as T[] | undefined) ?? []));
      if (page >= (parsed.total_pages ?? 1) || page >= MAX_PAGES) return items;
    }
  }

  /** Applies a correction to an entry. */
  async updateTimeEntry(id: string, patch: UpdateTimeEntryInput): Promise<TimeEntry> {
    const body: Record<string, unknown> = {};
    if (patch.notes !== undefined) body["notes"] = patch.notes;
    if (patch.internalNotes !== undefined) body["internal_notes"] = patch.internalNotes;
    if (patch.startedTime !== undefined) body["started_time"] = patch.startedTime;
    if (patch.endedTime !== undefined) body["ended_time"] = patch.endedTime;
    if (patch.spentDate !== undefined) body["spent_date"] = patch.spentDate;

    const { body: updated } = await this.#request(`/time_entries/${id}`, {
      method: "PATCH",
      body,
    });
    return unwrapEntry(updated);
  }

  async deleteTimeEntry(id: string): Promise<void> {
    await this.#request(`/time_entries/${id}`, { method: "DELETE" });
  }

  /**
   * Resumes an existing entry, so a task picked up again accumulates on the entry it
   * already has rather than spawning a duplicate. Verified against the live API.
   */
  async restartTimeEntry(id: string, options: { replaceRunning?: boolean } = {}): Promise<TimeEntry> {
    const { body } = await this.#request(`/time_entries/${id}/restart`, {
      method: "PATCH",
      body: options.replaceRunning ? { replace_running: true } : {},
    });
    return unwrapEntry(body);
  }

  /** Stops a running entry. The server sets the end time. */
  async stopTimeEntry(id: string): Promise<TimeEntry> {
    const { body } = await this.#request(`/time_entries/${id}/stop`, { method: "PATCH", body: {} });
    return unwrapEntry(body);
  }

  /**
   * Retries a throttled request a couple of times before giving up. Keito answers 503
   * for /tasks when its reference data is at capacity, and a single blip should not sink
   * a whole catalog load.
   */
  async #request(
    path: string,
    options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<{ body: unknown }> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.#attempt(path, options);
      } catch (error) {
        const retryable = error instanceof KeitoError && RETRYABLE.has(error.status ?? 0);
        if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
        // Linear backoff: brief, since this runs while the popover waits.
        await new Promise((resolve) => setTimeout(resolve, this.#retryDelayMs * attempt));
      }
    }
  }

  async #attempt(
    path: string,
    options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<{ body: unknown }> {
    const headers = new Headers({ Authorization: `Bearer ${this.#apiKey}` });
    if (this.#accountId) headers.set("Keito-Account-Id", this.#accountId);
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);

    const method = options.method ?? "GET";
    const startedAt = Date.now();
    const report = (record: Omit<RequestRecord, "method" | "path" | "durationMs">) => {
      this.#onRequest?.({ method, path, durationMs: Date.now() - startedAt, ...record });
    };

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (cause) {
      const error = new KeitoNetworkError(
        `Could not reach Keito at ${this.#baseUrl}${path}: ${describeCause(cause)}`,
        { path, cause },
      );
      report({ ok: false, error: error.message });
      throw error;
    }

    if (!response.ok) {
      // Keito puts the actual reason in the body. Losing it turns every failure into a
      // shrug, so read it first and fold it into the message.
      const detail = await readErrorDetail(response);
      const context = { status: response.status, path };
      const suffix = detail ? `: ${detail}` : "";
      report({ ok: false, status: response.status, ...(detail ? { error: detail } : {}) });

      if (response.status === 400 && /account-id/i.test(detail ?? "")) {
        throw new KeitoAccountIdRequiredError(
          "Keito needs a Company ID. Enter it in Settings — it is required on every request, so it cannot be detected automatically.",
          context,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new KeitoAuthError(`Keito rejected this request (${response.status})${suffix}`, context);
      }
      if (response.status === 409) {
        throw new KeitoConflictError(`A timer is already running in Keito${suffix}`, context);
      }
      throw new KeitoRequestError(`Keito returned ${response.status} for ${path}${suffix}`, context);
    }

    report({ ok: true, status: response.status });

    const body = response.status === 204 ? undefined : await response.json();
    return { body };
  }
}
