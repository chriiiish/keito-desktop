/**
 * An in-memory Azure DevOps exposed as a `fetch`, so the real AzureClient can be driven
 * without a network — the same shape as `fake-keito.ts`, and for the same reason: the
 * client is what we want under test, not a mock of it.
 *
 * Mirrors the behaviours that actually bite:
 *   - a bad PAT answers **203** with an HTML sign-in page, not 401
 *   - WIQL returns ids only, so titles need a second call
 *   - the detail call does not promise to return items in the order they were asked for
 */
import type { WorkItem } from "../src/core/azure/types.js";

export interface FakeAzureOptions {
  personalAccessToken?: string;
  organisation?: string;
  workItems?: WorkItem[];
  /** Return detail rows in a deliberately different order to the ids requested. */
  shuffleDetail?: boolean;
  /** Numeric fields the organisation defines. */
  fields?: Array<{ referenceName: string; name: string; type?: string }>;
  /** False answers every PATCH like a read-only token does: 203 and a sign-in page. */
  canWrite?: boolean;
  /** Ids whose work item type has none of the fields — a PATCH to them is a 400. */
  idsWithoutFields?: number[];
}

export interface FakeAzureRequest {
  method: string;
  path: string;
  authorization: string | null;
  query: Record<string, string>;
}

export class FakeAzure {
  readonly requests: FakeAzureRequest[] = [];
  #options: Required<FakeAzureOptions>;

  constructor(options: FakeAzureOptions = {}) {
    this.#options = {
      personalAccessToken: "pat_good",
      organisation: "acme",
      workItems: [],
      shuffleDetail: false,
      fields: [
        { referenceName: "Microsoft.VSTS.Scheduling.Effort", name: "Effort", type: "double" },
        { referenceName: "Microsoft.VSTS.Scheduling.CompletedWork", name: "Completed Work", type: "double" },
        { referenceName: "System.Title", name: "Title", type: "string" },
      ],
      canWrite: true,
      idsWithoutFields: [],
      ...options,
    };
  }

  /** What each work item's fields now hold, as written by PATCH. */
  readonly written = new Map<number, Record<string, unknown>>();

  get items(): WorkItem[] {
    return this.#options.workItems;
  }

  set items(next: WorkItem[]) {
    this.#options.workItems = next;
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const authorization = headers.get("Authorization");
    this.requests.push({
      method,
      path: url.pathname,
      authorization,
      query: Object.fromEntries(url.searchParams),
    });

    if (!this.#authorised(authorization)) return this.#signInPage();

    if (url.pathname === `/${this.#options.organisation}/_apis/wit/wiql` && method === "POST") {
      const top = Number(url.searchParams.get("$top") ?? "200");
      return json({
        queryType: "flat",
        // Ids only — the whole reason a second request exists.
        workItems: this.#options.workItems.slice(0, top).map((item) => ({ id: item.id })),
      });
    }

    if (url.pathname === `/${this.#options.organisation}/_apis/wit/workitems`) {
      const ids = (url.searchParams.get("ids") ?? "")
        .split(",")
        .filter(Boolean)
        .map(Number);
      const found = ids
        .map((id) => this.#options.workItems.find((item) => item.id === id))
        .filter((item): item is WorkItem => item !== undefined)
        .map((item) => ({
          id: item.id,
          fields: {
            "System.Title": item.title,
            "System.TeamProject": item.project,
            "System.State": item.state,
            "System.ChangedDate": item.changedDate,
          },
        }));
      return json({ count: found.length, value: this.#options.shuffleDetail ? found.reverse() : found });
    }

    if (url.pathname === `/${this.#options.organisation}/_apis/wit/fields` && method === "GET") {
      return json({ count: this.#options.fields.length, value: this.#options.fields });
    }

    const patch = new RegExp(`^/${this.#options.organisation}/_apis/wit/workitems/(\\d+)$`).exec(
      url.pathname,
    );
    if (patch && method === "PATCH") {
      // Azure insists on this content type for a JSON Patch and answers 415 otherwise.
      if (headers.get("Content-Type") !== "application/json-patch+json") {
        return json({ message: "Unsupported media type" }, 415);
      }
      // A token without write scope is refused like any other bad token: 203, not 403.
      if (!this.#options.canWrite) return this.#signInPage();

      const id = Number(patch[1]);
      if (!this.#options.workItems.some((item) => item.id === id)) {
        return json({ message: `TF401232: Work item ${id} does not exist.` }, 404);
      }
      const ops = JSON.parse(String(init?.body)) as Array<{ op: string; path: string; value: unknown }>;
      const fields = this.written.get(id) ?? {};
      for (const op of ops) {
        const name = op.path.replace(/^\/fields\//, "");
        const known = this.#options.fields.some((field) => field.referenceName === name);
        if (!known || this.#options.idsWithoutFields.includes(id)) {
          return json({ message: `TF51535: Cannot find field ${name}.` }, 400);
        }
        fields[name] = op.value;
      }
      this.written.set(id, fields);
      return json({ id, fields });
    }

    return json({ message: `No fake route for ${method} ${url.pathname}` }, 404);
  };

  #authorised(authorization: string | null): boolean {
    if (!authorization?.startsWith("Basic ")) return false;
    const decoded = atob(authorization.slice("Basic ".length));
    // Azure takes the PAT as the password with an empty username.
    return decoded === `:${this.#options.personalAccessToken}`;
  }

  /** What Azure DevOps actually sends for a bad PAT: 203 and a sign-in page. */
  #signInPage(): Response {
    return new Response("<html><body>Sign In</body></html>", {
      status: 203,
      headers: { "Content-Type": "text/html" },
    });
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
