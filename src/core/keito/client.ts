import { KeitoAuthError, KeitoConflictError, KeitoNetworkError, KeitoReadOnlyError } from "./errors.js";
import type { Identity, Project, Task, TimeEntry } from "./types.js";

export const KEITO_BASE_URL = "https://app.keito.ai/api/v2";

export interface KeitoClientOptions {
  apiKey: string;
  /** Omitted on first run: validateKey() discovers it from the identity response. */
  accountId?: string;
  baseUrl?: string;
  fetch: typeof fetch;
}

/** An entity plus the ETag Keito handed back, needed as If-Match on the next mutation. */
export interface Versioned<T> {
  entry: T;
  etag: string | null;
}

export interface CreateTimeEntryInput {
  projectId: string;
  taskId: string;
  /** YYYY-MM-DD in the workspace timezone. */
  spentDate: string;
  isRunning?: boolean;
  /** Atomically stops whatever is running before starting this one. */
  replaceRunning?: boolean;
  notes?: string;
  idempotencyKey?: string;
}

export interface UpdateTimeEntryInput {
  notes?: string;
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

  constructor(options: KeitoClientOptions) {
    this.#apiKey = options.apiKey;
    this.#accountId = options.accountId;
    this.#baseUrl = options.baseUrl ?? KEITO_BASE_URL;
    this.#fetch = options.fetch;
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
  async createTimeEntry(input: CreateTimeEntryInput): Promise<Versioned<TimeEntry>> {
    const body: Record<string, unknown> = {
      project_id: input.projectId,
      task_id: input.taskId,
      spent_date: input.spentDate,
      source: "desktop",
    };
    if (input.isRunning) body["is_running"] = true;
    if (input.replaceRunning) body["replace_running"] = true;
    if (input.notes) body["notes"] = input.notes;

    const { body: created, etag } = await this.#request("/time_entries", {
      method: "POST",
      body,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    return { entry: (created as { time_entry: TimeEntry }).time_entry, etag };
  }

  async listProjects(): Promise<Project[]> {
    const { body } = await this.#request("/projects?is_active=true&per_page=200");
    return (body as { projects: Project[] }).projects;
  }

  /** Tasks assigned to a project. Tasks are workspace-global; assignment is per project. */
  async listTasks(projectId: string): Promise<Task[]> {
    const { body } = await this.#request(`/tasks?project_id=${encodeURIComponent(projectId)}`);
    return (body as { tasks: Task[] }).tasks;
  }

  /** Lists time entries. `isRunning` narrows to the one active timer. */
  async listTimeEntries(filter: { isRunning?: boolean; from?: string; to?: string } = {}): Promise<TimeEntry[]> {
    const params = new URLSearchParams();
    if (filter.isRunning !== undefined) params.set("is_running", String(filter.isRunning));
    if (filter.from) params.set("from", filter.from);
    if (filter.to) params.set("to", filter.to);
    const query = params.size > 0 ? `?${params}` : "";

    const { body } = await this.#request(`/time_entries${query}`);
    const entries = (body as { time_entries: TimeEntry[] }).time_entries;
    // A read tells us the current ETag for each entry; remember it so a later stop or
    // patch can satisfy Keito's If-Match requirement without an extra round trip.
    return entries;
  }

  /** Reads one entry, primarily to obtain its current ETag before a mutation. */
  async getTimeEntry(id: string): Promise<Versioned<TimeEntry>> {
    const { body, etag } = await this.#request(`/time_entries/${id}`);
    return { entry: (body as { time_entry: TimeEntry }).time_entry, etag };
  }

  /** Applies a correction to an entry. `etag` comes from the read the edit was based on. */
  async updateTimeEntry(id: string, patch: UpdateTimeEntryInput, etag: string): Promise<TimeEntry> {
    const body: Record<string, unknown> = {};
    if (patch.notes !== undefined) body["notes"] = patch.notes;
    if (patch.startedTime !== undefined) body["started_time"] = patch.startedTime;
    if (patch.endedTime !== undefined) body["ended_time"] = patch.endedTime;
    if (patch.spentDate !== undefined) body["spent_date"] = patch.spentDate;

    const { body: updated } = await this.#request(`/time_entries/${id}`, {
      method: "PATCH",
      body,
      ifMatch: etag,
    });
    return (updated as { time_entry: TimeEntry }).time_entry;
  }

  async deleteTimeEntry(id: string, etag: string): Promise<void> {
    await this.#request(`/time_entries/${id}`, { method: "DELETE", ifMatch: etag });
  }

  /** Stops a running entry. The server sets the end time. */
  async stopTimeEntry(id: string, etag: string): Promise<TimeEntry> {
    const { body } = await this.#request(`/time_entries/${id}/stop`, {
      method: "PATCH",
      body: {},
      ifMatch: etag,
    });
    return (body as { time_entry: TimeEntry }).time_entry;
  }

  async #request(
    path: string,
    options: { method?: string; body?: unknown; idempotencyKey?: string; ifMatch?: string } = {},
  ): Promise<{ body: unknown; etag: string | null }> {
    const headers = new Headers({ Authorization: `Bearer ${this.#apiKey}` });
    if (this.#accountId) headers.set("Keito-Account-Id", this.#accountId);
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
    if (options.ifMatch) headers.set("If-Match", options.ifMatch);

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (cause) {
      throw new KeitoNetworkError("Could not reach Keito.", { cause });
    }

    if (response.status === 401 || response.status === 403) {
      throw new KeitoAuthError("Keito rejected this API key.");
    }
    if (response.status === 409) {
      throw new KeitoConflictError("A timer is already running in Keito.");
    }
    if (response.status === 412 || response.status === 428) {
      throw new KeitoConflictError("This entry changed in Keito since it was loaded. Reload and try again.");
    }
    if (!response.ok) {
      throw new KeitoNetworkError(`Keito returned ${response.status} for ${path}.`);
    }

    const etag = response.headers.get("ETag");
    const body = response.status === 204 ? undefined : await response.json();
    return { body, etag };
  }
}
