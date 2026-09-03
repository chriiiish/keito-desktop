import {
  AzureAuthError,
  AzureError,
  AzureNetworkError,
  AzureOrganisationUnknownError,
  AzureRequestError,
} from "./errors.js";
import type { OrganisationDiscovery, WorkItem } from "./types.js";

/** Where cross-organisation identity lives. Not on dev.azure.com — a different host entirely. */
const PROFILE_HOST = "https://app.vssps.visualstudio.com";

const API_VERSION = "7.1";

/**
 * Most a single `workitems?ids=` call accepts. Also the cap on how many work items the
 * dropdown will ever hold: a list longer than this is not a list anyone scrolls.
 */
export const MAX_WORK_ITEMS = 200;

/**
 * Assigned to me, still open, most recently touched first.
 *
 * `@Me` resolves to whoever the PAT belongs to, which is why no user id is needed. The
 * excluded states are the three Azure's own process templates use for "finished" — Agile
 * says Closed, Scrum says Done, and Removed is shared. A board with custom states will
 * show a little more than it strictly needs to, which is the safe direction to be wrong in:
 * showing a closed ticket costs a glance, hiding an open one costs the feature.
 */
const ASSIGNED_TO_ME = `SELECT [System.Id] FROM WorkItems
WHERE [System.AssignedTo] = @Me
  AND [System.State] NOT IN ('Closed', 'Removed', 'Done')
ORDER BY [System.ChangedDate] DESC`;

/** The fields the note field needs. Asking for fewer keeps the response small. */
const FIELDS = [
  "System.Id",
  "System.Title",
  "System.TeamProject",
  "System.State",
  "System.ChangedDate",
];

export interface AzureClientOptions {
  personalAccessToken: string;
  /** Injected so `src/core/` performs no I/O it isn't handed. */
  fetch: typeof globalThis.fetch;
  /** e.g. "https://dev.azure.com/acme". Optional: `discoverOrganisation` can find it. */
  organisationUrl?: string | undefined;
  /** Called with method, path, status and duration, so the main process can log it. */
  onRequest?: (record: AzureRequestRecord) => void;
}

export interface AzureRequestRecord {
  method: string;
  path: string;
  status?: number | undefined;
  durationMs: number;
  ok: boolean;
  error?: string | undefined;
}

/** A trailing slash and a trailing `/_apis` are both things people paste. */
export function normaliseOrganisationUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "").replace(/\/_apis$/i, "");
}

/**
 * Reads work items assigned to whoever owns the PAT.
 *
 * Pure of Electron and of I/O it isn't handed, like `KeitoClient` — `fetch` is a
 * constructor argument, so the whole thing runs under Vitest against a fake with no
 * network. Read-only: this never writes to Azure DevOps.
 */
export class AzureClient {
  #pat: string;
  #fetch: typeof globalThis.fetch;
  #organisationUrl: string | null;
  #onRequest: ((record: AzureRequestRecord) => void) | undefined;

  constructor(options: AzureClientOptions) {
    this.#pat = options.personalAccessToken;
    this.#fetch = options.fetch;
    this.#organisationUrl = options.organisationUrl
      ? normaliseOrganisationUrl(options.organisationUrl)
      : null;
    this.#onRequest = options.onRequest;
  }

  get organisationUrl(): string | null {
    return this.#organisationUrl;
  }

  /**
   * Which organisation the token belongs to, and — when that cannot be settled — which of
   * the four reasons applies.
   *
   * Two requests against a different host to the work item API, needing **User Profile
   * (Read)** on top of Work Items (Read). A token scoped to a single organisation, or one
   * without that scope, cannot answer at all. None of that is an error worth throwing over:
   * every outcome ends in asking the user something, and the point of naming them
   * separately is that the four questions are different.
   */
  async discoverOrganisation(): Promise<OrganisationDiscovery> {
    let profile: { id?: string; publicAlias?: string };
    try {
      profile = await this.#json(
        "GET",
        `${PROFILE_HOST}/_apis/profile/profiles/me?api-version=${API_VERSION}`,
      );
    } catch (error) {
      return {
        outcome: "no-access",
        reason: error instanceof AzureError ? error.message : String(error),
      };
    }

    // Both are the same value in Microsoft's own example, but publicAlias is what the
    // accounts API is documented to take, so it leads and `id` is the fallback.
    const memberId = profile.publicAlias ?? profile.id;
    if (!memberId) return { outcome: "no-access", reason: "That token cannot read your profile." };

    let accounts: { value?: Array<{ accountName?: string }> };
    try {
      accounts = await this.#json(
        "GET",
        `${PROFILE_HOST}/_apis/accounts?memberId=${encodeURIComponent(memberId)}&api-version=${API_VERSION}`,
      );
    } catch (error) {
      return {
        outcome: "no-access",
        reason: error instanceof AzureError ? error.message : String(error),
      };
    }

    const names = (accounts.value ?? [])
      .map((account) => account.accountName)
      .filter((name): name is string => Boolean(name));

    if (names.length === 0) return { outcome: "none" };
    // Choosing for someone in several organisations could silently pick the wrong
    // workplace, so the names go back for them to choose between.
    if (names.length > 1) return { outcome: "several", organisations: names };

    const url = `https://dev.azure.com/${names[0]}`;
    this.#organisationUrl = url;
    return { outcome: "found", organisationUrl: url };
  }

  /**
   * The open work items assigned to the PAT's owner.
   *
   * **Two requests, not one.** A WIQL query answers with ids and nothing else, so the
   * titles need a second call. That is a property of the API rather than a choice, and it
   * is why the list is cached rather than fetched whenever the popover opens.
   */
  async listAssignedWorkItems(): Promise<WorkItem[]> {
    const base = this.#requireOrganisation();

    const query = await this.#json<{ workItems?: Array<{ id?: number }> }>(
      "POST",
      `${base}/_apis/wit/wiql?$top=${MAX_WORK_ITEMS}&api-version=${API_VERSION}`,
      { query: ASSIGNED_TO_ME },
    );

    const ids = (query.workItems ?? [])
      .map((item) => item.id)
      .filter((id): id is number => typeof id === "number")
      .slice(0, MAX_WORK_ITEMS);

    // Nothing assigned is a perfectly good answer, and asking for zero ids is a 400.
    if (ids.length === 0) return [];

    const detail = await this.#json<{ value?: AzureWorkItemResponse[] }>(
      "GET",
      `${base}/_apis/wit/workitems?ids=${ids.join(",")}&fields=${FIELDS.join(",")}` +
        `&errorPolicy=omit&api-version=${API_VERSION}`,
    );

    // WIQL decides the order; the detail call does not promise to preserve it, so the ids
    // are re-imposed on the result rather than trusting the order it came back in.
    const byId = new Map<number, WorkItem>();
    for (const raw of detail.value ?? []) {
      const item = toWorkItem(raw);
      if (item) byId.set(item.id, item);
    }
    const items = ids
      .map((id) => byId.get(id))
      .filter((item): item is WorkItem => item !== undefined);

    // WIQL already asks for most-recently-changed first, but the sort is repeated on the
    // field itself so the order holds even if the query or the endpoint's ordering changes.
    return items.sort((a, b) => changedAt(b) - changedAt(a));
  }

  /** Round-trips the credentials, so Connect fails at setup rather than silently later. */
  async verify(): Promise<WorkItem[]> {
    return this.listAssignedWorkItems();
  }

  #requireOrganisation(): string {
    if (!this.#organisationUrl) {
      throw new AzureOrganisationUnknownError(
        "No Azure DevOps organisation URL — enter it, for example https://dev.azure.com/your-org.",
      );
    }
    return this.#organisationUrl;
  }

  async #json<T>(method: string, url: string, body?: unknown): Promise<T> {
    const startedAt = Date.now();
    const path = safePath(url);
    let response: Response;

    try {
      response = await this.#fetch(url, {
        method,
        headers: {
          // Basic auth with an empty username is how Azure DevOps takes a PAT.
          Authorization: `Basic ${base64(`:${this.#pat}`)}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      this.#record({ method, path, durationMs: Date.now() - startedAt, ok: false, error: String(error) });
      throw new AzureNetworkError(`Could not reach Azure DevOps: ${String(error)}`, {
        path,
        cause: error,
      });
    }

    const durationMs = Date.now() - startedAt;
    const status = response.status;

    /**
     * 203 is the one that catches people out. Azure DevOps answers a bad, expired or
     * under-scoped PAT with 203 and an HTML sign-in page, not 401 — so `response.ok` is
     * true and the next line parses HTML as JSON, failing far from the real cause.
     */
    if (status === 203 || status === 401 || status === 403) {
      this.#record({ method, path, status, durationMs, ok: false });
      throw new AzureAuthError(
        status === 203
          ? "Azure DevOps did not accept the personal access token. It may have expired, or it may be missing the Work Items (Read) scope."
          : "Azure DevOps refused the personal access token.",
        { status, path },
      );
    }

    if (!response.ok) {
      this.#record({ method, path, status, durationMs, ok: false });
      throw new AzureRequestError(await describe(response, status), { status, path });
    }

    this.#record({ method, path, status, durationMs, ok: true });

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new AzureError("Azure DevOps sent something that was not JSON.", {
        status,
        path,
        cause: error,
      });
    }
  }

  #record(record: AzureRequestRecord): void {
    this.#onRequest?.(record);
  }
}

/**
 * When a work item last changed, as something sortable.
 *
 * A missing or unreadable date is `-Infinity` so it sorts *last*. Subtracting `NaN` — which
 * is what `Date.parse(null)` gives — makes every comparison NaN, and a comparator returning
 * NaN leaves the order untouched rather than putting the undated item anywhere in
 * particular.
 */
function changedAt(item: WorkItem): number {
  const parsed = item.changedDate ? Date.parse(item.changedDate) : NaN;
  return Number.isNaN(parsed) ? -Infinity : parsed;
}

interface AzureWorkItemResponse {
  id?: number;
  fields?: Record<string, unknown>;
}

function toWorkItem(raw: AzureWorkItemResponse): WorkItem | null {
  if (typeof raw.id !== "number") return null;
  const fields = raw.fields ?? {};
  const text = (key: string): string => {
    const value = fields[key];
    return typeof value === "string" ? value : "";
  };
  return {
    id: raw.id,
    title: text("System.Title"),
    project: text("System.TeamProject"),
    state: text("System.State"),
    changedDate: text("System.ChangedDate") || null,
  };
}

/** Azure's own message where there is one, since it says more than the status does. */
async function describe(response: Response, status: number): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body?.message) return `Azure DevOps: ${body.message}`;
  } catch {
    // An error page rather than an error object. The status is what we have.
  }
  return `Azure DevOps answered ${status}.`;
}

/**
 * Path only, for the log. A full URL is fine here — none of these carry the PAT, which
 * travels in a header — but logging paths keeps the log readable and matches KeitoClient.
 */
function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function base64(value: string): string {
  return btoa(value);
}
