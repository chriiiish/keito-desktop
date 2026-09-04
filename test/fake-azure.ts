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
      ...options,
    };
  }

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
