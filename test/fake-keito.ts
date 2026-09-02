/**
 * An in-memory Keito, exposed as a `fetch` implementation so tests drive the real
 * KeitoClient rather than a mock of it.
 *
 * Shapes here were verified against the live API, not taken from the docs, which differ:
 * there is no GET /time_entries/:id (405), no ETags, no If-Match requirement, and single
 * entries come back unwrapped rather than under a `time_entry` key.
 */
import { KEITO_BASE_URL } from "../src/core/keito/client.js";

export interface FakeEntry {
  id: string;
  project_id: string;
  task_id: string;
  spent_date: string;
  started_time: string | null;
  ended_time: string | null;
  /** ISO instant the timer began — the real API provides this; HH:mm alone cannot. */
  timer_started_at: string | null;
  hours: number | null;
  is_running: boolean;
  notes: string | null;
  source: string | null;
}

export interface FakeKeitoOptions {
  projects?: Array<{ id: string; name: string; client?: { name: string }; tasks?: Array<{ id: string; name: string; is_active?: boolean }> }>;
  /** Convenience: folded into each project's embedded `tasks`, as the live API returns them. */
  tasksByProject?: Record<string, Array<{ id: string; name: string }>>;
  /** Page size the fake enforces, so pagination handling is exercised. */
  pageSize?: number;
  now?: () => Date;
  /** Reject every request, as an expired or wrong key would. */
  rejectAuth?: boolean;
}

export class FakeKeito {
  entries: FakeEntry[] = [];
  requests: Array<{ method: string; path: string; body: unknown; headers: Headers }> = [];
  /** Set to make the next request fail as if the network were down. */
  offline = false;
  /** projectId -> how many more times GET /tasks should answer 503 for it. */
  taskFailures = new Map<string, number>();
  /** The most requests this fake ever had in flight at once. */
  maxConcurrent = 0;
  #inFlight = 0;

  #options: Required<Pick<FakeKeitoOptions, "projects" | "tasksByProject" | "now">> & {
    rejectAuth: boolean;
    pageSize: number;
  };
  #seq = 0;

  constructor(options: FakeKeitoOptions = {}) {
    this.#options = {
      projects: options.projects ?? [],
      tasksByProject: options.tasksByProject ?? {},
      now: options.now ?? (() => new Date()),
      rejectAuth: options.rejectAuth ?? false,
      pageSize: options.pageSize ?? 200,
    };
  }

  get running(): FakeEntry | undefined {
    return this.entries.find((entry) => entry.is_running);
  }

  seedRunning(entry: Partial<FakeEntry> & Pick<FakeEntry, "project_id" | "task_id">): FakeEntry {
    const created = this.#create(entry, true);
    return created;
  }

  /** The `fetch` to hand to KeitoClient. */
  readonly fetch: typeof fetch = async (input, init) => {
    if (this.offline) throw new TypeError("fetch failed");

    this.#inFlight++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.#inFlight);
    // Yield so genuinely parallel callers overlap here, making the count meaningful.
    await Promise.resolve();
    try {
      return await this.#handle(input, init);
    } finally {
      this.#inFlight--;
    }
  };

  async #handle(input: RequestInfo | URL, init: RequestInit | undefined): Promise<Response> {

    const request = new Request(input as string, init);
    const url = new URL(request.url);
    const path = url.pathname.replace(new URL(KEITO_BASE_URL).pathname, "");
    const body = request.method === "GET" ? undefined : await request.clone().json().catch(() => undefined);
    this.requests.push({ method: request.method, path, body, headers: request.headers });

    if (this.#options.rejectAuth) return this.#json({ message: "Invalid token" }, 401);

    return this.#route(request.method, path, url, body, request.headers);
  };

  #route(method: string, path: string, url: URL, body: any, headers: Headers): Response {
    if (method === "GET" && path === "/users/me") {
      return this.#json({ id: "u_1", first_name: "Chris", company: { id: "co_9", name: "Acme" } });
    }
    if (method === "GET" && path === "/projects") {
      // Tasks arrive embedded, exactly as the live API returns them.
      const withTasks = this.#options.projects.map((project) => ({
        ...project,
        tasks: project.tasks ?? this.#options.tasksByProject[project.id] ?? [],
      }));
      return this.#page(withTasks, "projects", url);
    }
    if (method === "GET" && path === "/tasks") {
      const projectId = url.searchParams.get("project_id") ?? "";
      const failures = this.taskFailures.get(projectId) ?? 0;
      if (failures > 0) {
        this.taskFailures.set(projectId, failures - 1);
        // The message Keito actually returns under load.
        return this.#json(
          { error: "Task reference data is temporarily at capacity. Retry shortly." },
          503,
        );
      }
      return this.#json({ tasks: this.#options.tasksByProject[projectId] ?? [] });
    }
    if (method === "GET" && path === "/time_entries") {
      let entries = this.entries;
      if (url.searchParams.get("is_running") === "true") entries = entries.filter((e) => e.is_running);
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (from) entries = entries.filter((e) => e.spent_date >= from);
      if (to) entries = entries.filter((e) => e.spent_date <= to);
      return this.#page(entries, "time_entries", url);
    }
    if (method === "POST" && path === "/time_entries") {
      const wantsRunning = body?.is_running === true;
      if (wantsRunning && this.running) {
        if (body?.replace_running !== true) {
          return this.#json({ message: "A timer is already running" }, 409);
        }
        this.#stop(this.running);
      }
      const created = this.#create(body, wantsRunning);
      return this.#json(created, 201);
    }

    const restartMatch = /^\/time_entries\/([^/]+)\/restart$/.exec(path);
    if (method === "PATCH" && restartMatch) {
      const entry = this.entries.find((e) => e.id === restartMatch[1]);
      if (!entry) return this.#json({ message: "Not found" }, 404);
      if (this.running && this.running.id !== entry.id) {
        if (body?.replace_running !== true) {
          // Shape observed from the live API, which returns more than a bare message.
          return this.#json(
            {
              error: "conflict",
              error_description: "A timer is already running",
              message: "A timer is already running",
              running_entry: this.running,
              running_entry_count: 1,
            },
            409,
          );
        }
        this.#stop(this.running);
      }
      entry.is_running = true;
      entry.ended_time = null;
      entry.timer_started_at = this.#options.now().toISOString();
      return this.#json(entry, 200);
    }

    const stopMatch = /^\/time_entries\/([^/]+)\/stop$/.exec(path);
    if (method === "PATCH" && stopMatch) {
      const entry = this.entries.find((e) => e.id === stopMatch[1]);
      if (!entry) return this.#json({ message: "Not found" }, 404);
      this.#stop(entry);
      return this.#json(entry, 200);
    }

    const idMatch = /^\/time_entries\/([^/]+)$/.exec(path);
    if (idMatch) {
      const index = this.entries.findIndex((e) => e.id === idMatch[1]);
      if (index === -1) return this.#json({ message: "Not found" }, 404);
      const entry = this.entries[index]!;
      // The live API has no single-entry GET; it answers 405.
      if (method === "GET") return this.#json({ message: "Method Not Allowed" }, 405);
      if (method === "DELETE") {
        this.entries.splice(index, 1);
        return new Response(null, { status: 204 });
      }
      if (method === "PATCH") {
        Object.assign(entry, body);
        return this.#json(entry, 200);
      }
    }

    return this.#json({ message: `Unhandled ${method} ${path}` }, 404);
  }

  #create(body: any, running: boolean): FakeEntry {
    const now = this.#options.now();
    const entry: FakeEntry = {
      id: body.id ?? `te_${++this.#seq}`,
      project_id: body.project_id,
      task_id: body.task_id,
      spent_date: body.spent_date ?? now.toISOString().slice(0, 10),
      started_time: body.started_time ?? (running ? now.toISOString().slice(11, 16) : null),
      ended_time: body.ended_time ?? null,
      timer_started_at: running ? now.toISOString() : null,
      hours: running ? null : (body.hours ?? null),
      is_running: running,
      notes: body.notes ?? null,
      source: body.source ?? null,
    };
    this.entries.push(entry);
    return entry;
  }

  #stop(entry: FakeEntry): void {
    entry.is_running = false;
    entry.ended_time = this.#options.now().toISOString().slice(11, 16);
  }

  /** Paginates like the live API: a named array plus page/total metadata. */
  #page(items: readonly unknown[], key: string, url: URL): Response {
    const perPage = Math.min(Number(url.searchParams.get("per_page")) || 25, this.#options.pageSize);
    const page = Number(url.searchParams.get("page")) || 1;
    const slice = items.slice((page - 1) * perPage, page * perPage);
    return this.#json({
      [key]: slice,
      page,
      per_page: perPage,
      total_entries: items.length,
      total_pages: Math.max(1, Math.ceil(items.length / perPage)),
    });
  }

  /** The live API sends no ETag on any response. */
  #json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
