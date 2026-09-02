import { describe, expect, it } from "vitest";
import { redact } from "./logger.js";

describe("redact", () => {
  it("masks an API key that reaches a log line by any route", () => {
    expect(redact("Authorization: Bearer kto_live_abc123DEF")).toBe(
      "Authorization: Bearer kto_***",
    );
  });

  it("masks every occurrence, not just the first", () => {
    expect(redact("kto_one and kto_two")).toBe("kto_*** and kto_***");
  });

  it("leaves ordinary text alone", () => {
    expect(redact("Keito returned 401 for /users/me")).toBe("Keito returned 401 for /users/me");
  });
});
