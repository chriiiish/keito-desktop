/**
 * An in-memory Keito, exposed as a `fetch` implementation so tests drive the real
 * KeitoClient rather than a mock of it. Honours the behaviours we depend on:
 * single running timer, 409 without `replace_running`, ETag/If-Match, 401.
 */
import { KEITO_BASE_URL } from "../src/core/keito/client.js";

export interface FakeEntry {
  id: string;
  project_id: string;
  task_id: string;
  spent_date: string;
  started_time: string | null;
  ended_time: string | null;
  hours: number | null;
  is_running: boolean;
  notes: string | null;
  source: string | null;
}

export interface FakeKeitoOptions {
  projects?: Array<{ id: string; name: string; client_name?: string }>;
  tasksByProject?: Record<string, Array<{ id: string; name: string }>>;
  now?: () => Date;
  /** Reject every request, as an expired or wrong key would. */
  rejectAuth?: boolean;
}

export class FakeKeito {
  entries: FakeEntry[] = [];
  requests: Array<{ method: string; path: string; body: unknown; headers: Headers }> = [];
  /** Set to make the next request fail as if the network were down. */
  offline = false;

  #options: Required<Pick<FakeKeitoOptions, "projects" | "tasksByProject" | "now">> & {
    rejectAuth: boolean;
  };
  #seq = 0;
  #version = new Map<string, number>();

  constructor(options: FakeKeitoOptions = {}) {
    this.#options = {
      projects: options.projects ?? [],
      tasksByProject: options.tasksByProject ?? {},
      now: options.now ?? (() => new Date()),
      rejectAuth: options.rejectAuth ?? false,
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
      return this.#json({ projects: this.#options.projects });
    }
    if (method === "GET" && path === "/tasks") {
      const projectId = url.searchParams.get("project_id") ?? "";
      return this.#json({ tasks: this.#options.tasksByProject[projectId] ?? [] });
    }
    if (method === "GET" && path === "/time_entries") {
      let entries = this.entries;
      if (url.searchParams.get("is_running") === "true") entries = entries.filter((e) => e.is_running);
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (from) entries = entries.filter((e) => e.spent_date >= from);
      if (to) entries = entries.filter((e) => e.spent_date <= to);
      return this.#json({ time_entries: entries });
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
      return this.#json({ time_entry: created }, 201, created.id);
    }

    const stopMatch = /^\/time_entries\/([^/]+)\/stop$/.exec(path);
    if (method === "PATCH" && stopMatch) {
      const entry = this.entries.find((e) => e.id === stopMatch[1]);
      if (!entry) return this.#json({ message: "Not found" }, 404);
      const precondition = this.#checkIfMatch(entry.id, headers);
      if (precondition) return precondition;
      this.#stop(entry);
      return this.#json({ time_entry: entry }, 200, entry.id);
    }

    const idMatch = /^\/time_entries\/([^/]+)$/.exec(path);
    if (idMatch) {
      const index = this.entries.findIndex((e) => e.id === idMatch[1]);
      if (index === -1) return this.#json({ message: "Not found" }, 404);
      const entry = this.entries[index]!;
      if (method === "GET") return this.#json({ time_entry: entry }, 200, entry.id);
      const precondition = this.#checkIfMatch(entry.id, headers);
      if (precondition) return precondition;
      if (method === "DELETE") {
        this.entries.splice(index, 1);
        return new Response(null, { status: 204 });
      }
      if (method === "PATCH") {
        Object.assign(entry, body);
        this.#version.set(entry.id, (this.#version.get(entry.id) ?? 0) + 1);
        return this.#json({ time_entry: entry }, 200, entry.id);
      }
    }

    return this.#json({ message: `Unhandled ${method} ${path}` }, 404);
  }

  #checkIfMatch(id: string, headers: Headers): Response | undefined {
    const ifMatch = headers.get("If-Match");
    if (!ifMatch) return this.#json({ message: "If-Match required" }, 428);
    if (ifMatch !== this.#etag(id)) return this.#json({ message: "Stale" }, 412);
    return undefined;
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
      hours: running ? null : (body.hours ?? null),
      is_running: running,
      notes: body.notes ?? null,
      source: body.source ?? null,
    };
    this.entries.push(entry);
    this.#version.set(entry.id, 1);
    return entry;
  }

  #stop(entry: FakeEntry): void {
    entry.is_running = false;
    entry.ended_time = this.#options.now().toISOString().slice(11, 16);
    this.#version.set(entry.id, (this.#version.get(entry.id) ?? 0) + 1);
  }

  #etag(id: string): string {
    return `"v${this.#version.get(id) ?? 0}"`;
  }

  #json(body: unknown, status = 200, etagFor?: string): Response {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (etagFor) headers.ETag = this.#etag(etagFor);
    return new Response(JSON.stringify(body), { status, headers });
  }
}
