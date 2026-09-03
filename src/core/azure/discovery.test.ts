import { describe, expect, it } from "vitest";
import { describeDiscovery } from "./discovery.js";

describe("describeDiscovery", () => {
  it("does not tell someone with a working token that it was refused", () => {
    // The report this exists for: a token with User Profile (Read) granted, working
    // against dev.azure.com, told it had been "refused". It had not — it simply cannot
    // authenticate against the cross-organisation host unless it was created for "All
    // accessible organizations".
    const message = describeDiscovery({ outcome: "no-access", reason: "Azure DevOps refused it." });

    expect(message).toMatch(/your token works/i);
    expect(message).not.toMatch(/refused/i);
  });

  it("names the reason a lookup cannot work, so it can be fixed or ignored", () => {
    const message = describeDiscovery({ outcome: "no-access", reason: "whatever" });

    expect(message).toMatch(/All accessible organizations/);
    expect(message).toMatch(/single organisation/i);
  });

  it("always says what to do next", () => {
    const cases: Array<Parameters<typeof describeDiscovery>[0]> = [
      { outcome: "no-access", reason: "x" },
      { outcome: "none" },
      { outcome: "several", organisations: ["acme", "acme-labs"] },
    ];
    for (const found of cases) {
      expect(describeDiscovery(found), found.outcome).toMatch(/press Connect again/);
    }
  });

  it("names the organisations when there is a choice to make", () => {
    const message = describeDiscovery({
      outcome: "several",
      organisations: ["rezaresystems", "rezare-labs"],
    });

    expect(message).toContain("rezaresystems");
    expect(message).toContain("rezare-labs");
    expect(message).toContain("2 organisations");
  });
});
