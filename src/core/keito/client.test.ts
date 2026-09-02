import { describe, expect, it } from "vitest";
import { KeitoClient } from "./client.js";
import {
  KeitoAccountIdRequiredError,
  KeitoAuthError,
  KeitoReadOnlyError,
  KeitoRequestError,
} from "./errors.js";

/** A fetch stand-in that records requests and replays canned responses. */
function stubFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Request[] = [];
  const queue = [...responses];
  const fn: typeof fetch = async (input, init) => {
    calls.push(new Request(input as string, init));
    const next = queue.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fn, calls };
}

describe("KeitoClient", () => {
  it("authenticates every request with the bearer token and account id", async () => {
    const { fn, calls } = stubFetch([
      { body: { id: "u_1", first_name: "Chris", company: { id: "co_9", name: "Acme" } } },
    ]);
    const client = new KeitoClient({ apiKey: "kto_secret", accountId: "co_9", fetch: fn });

    await client.validateKey();

    const req = calls[0]!;
    expect(req.url).toBe("https://app.keito.ai/api/v2/users/me");
    expect(req.headers.get("Authorization")).toBe("Bearer kto_secret");
    expect(req.headers.get("Keito-Account-Id")).toBe("co_9");
  });

  it("discovers the account id from the company on the identity response", async () => {
    const { fn } = stubFetch([
      { body: { id: "u_1", first_name: "Chris", company: { id: "co_9", name: "Acme" } } },
    ]);
    const client = new KeitoClient({ apiKey: "kto_secret", fetch: fn });

    const identity = await client.validateKey();

    expect(identity).toEqual({ userId: "u_1", name: "Chris", accountId: "co_9", accountName: "Acme" });
  });

  it("rejects a key the server refuses, so the user is sent back to settings", async () => {
    const { fn } = stubFetch([{ status: 401, body: { message: "Invalid token" } }]);
    const client = new KeitoClient({ apiKey: "kto_wrong", accountId: "co_9", fetch: fn });

    await expect(client.validateKey()).rejects.toBeInstanceOf(KeitoAuthError);
  });

  it("rejects a personal sync key, which omits company and cannot write entries", async () => {
    const { fn } = stubFetch([{ body: { id: "u_1", first_name: "Chris" } }]);
    const client = new KeitoClient({ apiKey: "kto_synconly", fetch: fn });

    await expect(client.validateKey()).rejects.toBeInstanceOf(KeitoReadOnlyError);
  });

  it("prefers a company id the user supplied over the one the server reports", async () => {
    // The header decides which workspace the request acts on, so identity must reflect
    // what we actually send — not what a token's default company claims.
    const { fn, calls } = stubFetch([
      { body: { id: "u_1", first_name: "Chris", company: { id: "co_default", name: "Default" } } },
    ]);
    const client = new KeitoClient({ apiKey: "kto_secret", accountId: "co_chosen", fetch: fn });

    const identity = await client.validateKey();

    expect(identity.accountId).toBe("co_chosen");
    expect(calls[0]!.headers.get("Keito-Account-Id")).toBe("co_chosen");
  });

  it("surfaces the reason Keito gave, instead of a generic failure", async () => {
    const { fn } = stubFetch([
      { status: 401, body: { message: "Sync keys cannot access this endpoint" } },
    ]);
    const client = new KeitoClient({ apiKey: "kto_x", accountId: "co_9", fetch: fn });

    await expect(client.validateKey()).rejects.toThrow(/Sync keys cannot access this endpoint/);
  });

  it("carries the status code, so the UI can tell a bad key from a bad company id", async () => {
    const { fn } = stubFetch([{ status: 422, body: { error: "Unknown company" } }]);
    const client = new KeitoClient({ apiKey: "kto_x", accountId: "co_bogus", fetch: fn });

    const error = await client.validateKey().catch((caught) => caught);

    expect(error).toMatchObject({ status: 422 });
    expect(String(error)).toMatch(/Unknown company/);
  });

  it("still reports something useful when the body is not JSON", async () => {
    const fn: typeof fetch = async () => new Response("<html>502 Bad Gateway</html>", { status: 502 });
    const client = new KeitoClient({ apiKey: "kto_x", accountId: "co_9", fetch: fn });

    await expect(client.validateKey()).rejects.toThrow(/502/);
  });

  it("reports the endpoint that failed, so a wrong base URL is obvious", async () => {
    const { fn } = stubFetch([{ status: 404, body: {} }]);
    const client = new KeitoClient({ apiKey: "kto_x", accountId: "co_9", fetch: fn });

    await expect(client.validateKey()).rejects.toThrow(/users\/me/);
  });

  it("reports every request to an observer, so the app can keep a log", async () => {
    const seen: unknown[] = [];
    const { fn } = stubFetch([
      { body: { id: "u_1", first_name: "Chris", company: { id: "co_9", name: "Acme" } } },
    ]);
    const client = new KeitoClient({
      apiKey: "kto_secret",
      accountId: "co_9",
      fetch: fn,
      onRequest: (record) => seen.push(record),
    });

    await client.validateKey();

    expect(seen).toEqual([
      expect.objectContaining({ method: "GET", path: "/users/me", status: 200, ok: true }),
    ]);
  });

  it("reports failures too, with the reason attached", async () => {
    const seen: Array<{ ok: boolean; status?: number; error?: string }> = [];
    const { fn } = stubFetch([{ status: 401, body: { message: "Invalid token" } }]);
    const client = new KeitoClient({
      apiKey: "kto_secret",
      accountId: "co_9",
      fetch: fn,
      onRequest: (record) => seen.push(record),
    });

    await client.validateKey().catch(() => undefined);

    expect(seen[0]).toMatchObject({ ok: false, status: 401 });
    expect(seen[0]!.error).toMatch(/Invalid token/);
  });

  it("never hands the API key to the observer", async () => {
    const seen: unknown[] = [];
    const { fn } = stubFetch([{ status: 500, body: {} }]);
    const client = new KeitoClient({
      apiKey: "kto_super_secret_value",
      accountId: "co_9",
      fetch: fn,
      onRequest: (record) => seen.push(record),
    });

    await client.validateKey().catch(() => undefined);

    expect(JSON.stringify(seen)).not.toContain("kto_super_secret_value");
  });

  it("names the missing company id, because Keito requires it even on /users/me", async () => {
    // Verified against the live API: without the header, /users/me answers
    // 400 "Missing Keito-Account-Id header". Discovery is therefore impossible.
    const { fn } = stubFetch([{ status: 400, body: { message: "Missing Keito-Account-Id header" } }]);
    const client = new KeitoClient({ apiKey: "kto_valid", fetch: fn });

    await expect(client.validateKey()).rejects.toBeInstanceOf(KeitoAccountIdRequiredError);
  });

  it("does not call an ordinary bad request a network problem", async () => {
    const { fn } = stubFetch([{ status: 422, body: { message: "Unprocessable" } }]);
    const client = new KeitoClient({ apiKey: "kto_valid", accountId: "co_9", fetch: fn });

    await expect(client.validateKey()).rejects.toBeInstanceOf(KeitoRequestError);
  });
});
