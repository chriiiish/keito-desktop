import { describe, expect, it } from "vitest";
import { azureStatus } from "./status.js";

const state = (over: Partial<Parameters<typeof azureStatus>[0]> = {}) => ({
  enabled: true,
  hasToken: true,
  error: null,
  connected: true,
  ...over,
});

describe("azureStatus", () => {
  it("is off when the toggle is off, whatever else is true", () => {
    // Off is a decision. It must not be reported as a fault, even mid-failure.
    expect(azureStatus(state({ enabled: false }))).toBe("off");
    expect(azureStatus(state({ enabled: false, error: "boom", hasToken: false }))).toBe("off");
  });

  it("is an error when a connect failed before anything could be stored", () => {
    // The bug: a failed connect stores no token, so asking "is there a token?" first
    // reported "needs-token" — you have not filled this in yet — while showing the error
    // explaining why what they had just filled in did not work.
    expect(azureStatus(state({ hasToken: false, connected: false, error: "Rejected" }))).toBe(
      "error",
    );
  });

  it("is an error when a stored token later stops working", () => {
    expect(azureStatus(state({ connected: false, error: "Token expired" }))).toBe("error");
  });

  it("needs a token when switched on and nothing has been tried yet", () => {
    expect(azureStatus(state({ hasToken: false, connected: false }))).toBe("needs-token");
  });

  it("needs a token when one is stored but nothing has succeeded yet", () => {
    // Stored but unproven — a restart before the first refresh lands.
    expect(azureStatus(state({ connected: false }))).toBe("needs-token");
  });

  it("is connected when it is working", () => {
    expect(azureStatus(state())).toBe("connected");
  });
});
