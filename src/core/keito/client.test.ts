import { describe, expect, it } from "vitest";
import { KeitoClient } from "./client.js";
import { KeitoAuthError, KeitoReadOnlyError } from "./errors.js";

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
});
