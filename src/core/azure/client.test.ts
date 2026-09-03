import { describe, expect, it } from "vitest";
import { FakeAzure } from "../../../test/fake-azure.js";
import { AzureClient, MAX_WORK_ITEMS, normaliseOrganisationUrl } from "./client.js";
import { AzureAuthError, AzureOrganisationUnknownError } from "./errors.js";
import type { WorkItem } from "./types.js";

const item = (id: number, title: string, over: Partial<WorkItem> = {}): WorkItem => ({
  id,
  title,
  type: "Task",
  state: "Active",
  ...over,
});

const ORG = "https://dev.azure.com/acme";

const clientFor = (azure: FakeAzure, over: Partial<{ pat: string; url: string | undefined }> = {}) =>
  new AzureClient({
    personalAccessToken: over.pat ?? "pat_good",
    fetch: azure.fetch,
    organisationUrl: "url" in over ? over.url : ORG,
  });

describe("normaliseOrganisationUrl", () => {
  it("takes what people actually paste", () => {
    expect(normaliseOrganisationUrl("https://dev.azure.com/acme/")).toBe(ORG);
    expect(normaliseOrganisationUrl("  https://dev.azure.com/acme  ")).toBe(ORG);
    expect(normaliseOrganisationUrl("https://dev.azure.com/acme/_apis")).toBe(ORG);
  });

  it("leaves an on-prem server URL alone", () => {
    // Taking a URL rather than an organisation name is what makes Azure DevOps Server work.
    expect(normaliseOrganisationUrl("https://tfs.internal/tfs/DefaultCollection/")).toBe(
      "https://tfs.internal/tfs/DefaultCollection",
    );
  });
});

describe("listAssignedWorkItems", () => {
  it("sends the PAT as basic auth with an empty username", async () => {
    const azure = new FakeAzure({ workItems: [item(1, "One")] });

    await clientFor(azure).listAssignedWorkItems();

    const auth = azure.requests[0]!.authorization!;
    expect(atob(auth.slice("Basic ".length))).toBe(":pat_good");
  });

  it("takes two requests, because WIQL answers with ids and nothing else", async () => {
    const azure = new FakeAzure({ workItems: [item(1, "One")] });

    await clientFor(azure).listAssignedWorkItems();

    expect(azure.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /acme/_apis/wit/wiql",
      "GET /acme/_apis/wit/workitems",
    ]);
  });

  it("returns the work items with their titles", async () => {
    const azure = new FakeAzure({
      workItems: [item(1234, "Fix the login redirect", { type: "Bug", state: "Active" })],
    });

    const items = await clientFor(azure).listAssignedWorkItems();

    expect(items).toEqual([
      { id: 1234, title: "Fix the login redirect", type: "Bug", state: "Active" },
    ]);
  });

  it("keeps WIQL's order even when the detail call answers in another", async () => {
    // WIQL decides "most recently changed first"; the detail endpoint makes no such promise.
    const azure = new FakeAzure({
      workItems: [item(1, "First"), item(2, "Second"), item(3, "Third")],
      shuffleDetail: true,
    });

    const items = await clientFor(azure).listAssignedWorkItems();

    expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it("asks for nothing when nothing is assigned, since zero ids is a 400", async () => {
    const azure = new FakeAzure({ workItems: [] });

    expect(await clientFor(azure).listAssignedWorkItems()).toEqual([]);
    expect(azure.requests.map((r) => r.path)).toEqual(["/acme/_apis/wit/wiql"]);
  });

  it("caps the list at what one detail request will take", async () => {
    const azure = new FakeAzure({
      workItems: Array.from({ length: 500 }, (_, i) => item(i + 1, `Item ${i + 1}`)),
    });

    const items = await clientFor(azure).listAssignedWorkItems();

    expect(items).toHaveLength(MAX_WORK_ITEMS);
  });

  it("refuses to guess an organisation it was never given", async () => {
    const azure = new FakeAzure();

    await expect(clientFor(azure, { url: undefined }).listAssignedWorkItems()).rejects.toThrow(
      AzureOrganisationUnknownError,
    );
  });
});

describe("a personal access token Azure will not accept", () => {
  it("is an auth error, even though Azure answers 203 rather than 401", async () => {
    // The gotcha this client exists to absorb: 203 with an HTML sign-in page is a
    // *success* to response.ok, and the next line would parse HTML as JSON.
    const azure = new FakeAzure();

    const error = await clientFor(azure, { pat: "pat_expired" })
      .listAssignedWorkItems()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AzureAuthError);
    expect((error as AzureAuthError).status).toBe(203);
  });

  it("says what to check, since 203 tells the user nothing", async () => {
    const azure = new FakeAzure();

    await expect(
      clientFor(azure, { pat: "pat_expired" }).listAssignedWorkItems(),
    ).rejects.toThrow(/expired|Work Items \(Read\)/i);
  });
});

describe("discoverOrganisation", () => {
  it("finds the organisation when the PAT can read the profile", async () => {
    const azure = new FakeAzure({ accounts: ["acme"] });

    const found = await clientFor(azure, { url: undefined }).discoverOrganisation();

    expect(found).toEqual({ organisationUrl: ORG, discovered: true });
  });

  it("uses what it found for the work item calls that follow", async () => {
    const azure = new FakeAzure({ accounts: ["acme"], workItems: [item(1, "One")] });
    const client = clientFor(azure, { url: undefined });

    await client.discoverOrganisation();

    expect(client.organisationUrl).toBe(ORG);
    expect(await client.listAssignedWorkItems()).toHaveLength(1);
  });

  it("gives up quietly when the PAT lacks the Profile scope", async () => {
    // A PAT with only Work Items (Read) cannot answer this, and that is not an error —
    // it is the cue to ask the user for the URL.
    const azure = new FakeAzure({ profileReadable: false });

    expect(await clientFor(azure, { url: undefined }).discoverOrganisation()).toBeNull();
  });

  it("refuses to choose when the PAT reaches several organisations", async () => {
    // Guessing at the first would silently pick the wrong workplace.
    const azure = new FakeAzure({ accounts: ["acme", "acme-labs"] });

    expect(await clientFor(azure, { url: undefined }).discoverOrganisation()).toBeNull();
  });

  it("gives up quietly when the PAT reaches no organisation at all", async () => {
    const azure = new FakeAzure({ accounts: [] });

    expect(await clientFor(azure, { url: undefined }).discoverOrganisation()).toBeNull();
  });
});
