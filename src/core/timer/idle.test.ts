import { describe, expect, it } from "vitest";
import { IdleWatcher, shouldAutoStop, IDLE_THRESHOLD_SECONDS, MAX_TIMER_HOURS } from "./idle.js";

const at = (iso: string) => new Date(iso);

describe("IdleWatcher", () => {
  it("says nothing while you are at the keyboard", () => {
    const watcher = new IdleWatcher();

    expect(watcher.observe(5, at("2026-09-02T10:00:00Z"))).toBeNull();
    expect(watcher.observe(30, at("2026-09-02T10:01:00Z"))).toBeNull();
  });

  it("says nothing during the absence itself, only once you are back", () => {
    const watcher = new IdleWatcher();

    expect(watcher.observe(1200, at("2026-09-02T10:20:00Z"))).toBeNull();
  });

  it("reports how long you were away, dated from when you actually stopped working", () => {
    const watcher = new IdleWatcher();
    watcher.observe(30, at("2026-09-02T10:00:00Z"));
    watcher.observe(1200, at("2026-09-02T10:20:00Z")); // away 20 min, still away

    const event = watcher.observe(2, at("2026-09-02T10:21:00Z")); // back at the keyboard

    // Idle began 1200s before the 10:20 sample, i.e. 10:00.
    expect(event).toEqual({
      type: "returned",
      awaySince: at("2026-09-02T10:00:00Z"),
      awaySeconds: 1200,
    });
  });

  it("ignores a short break, so a coffee refill does not nag you", () => {
    const watcher = new IdleWatcher();
    watcher.observe(IDLE_THRESHOLD_SECONDS - 60, at("2026-09-02T10:09:00Z"));

    expect(watcher.observe(1, at("2026-09-02T10:10:00Z"))).toBeNull();
  });

  it("reports each absence separately", () => {
    const watcher = new IdleWatcher();
    watcher.observe(1200, at("2026-09-02T10:20:00Z"));
    expect(watcher.observe(0, at("2026-09-02T10:21:00Z"))).not.toBeNull();

    watcher.observe(1800, at("2026-09-02T11:00:00Z"));
    expect(watcher.observe(0, at("2026-09-02T11:01:00Z"))).not.toBeNull();
  });
});

describe("shouldAutoStop", () => {
  it("leaves a normal working stretch alone", () => {
    expect(shouldAutoStop(at("2026-09-02T09:00:00Z"), at("2026-09-02T17:00:00Z"))).toBe(false);
  });

  it("stops a timer left running overnight, before it bills sixteen hours to a client", () => {
    expect(shouldAutoStop(at("2026-09-01T18:00:00Z"), at("2026-09-02T09:00:00Z"))).toBe(true);
  });

  it("triggers exactly at the limit", () => {
    const start = at("2026-09-02T00:00:00Z");
    const limit = new Date(start.getTime() + MAX_TIMER_HOURS * 3_600_000);
    expect(shouldAutoStop(start, limit)).toBe(true);
    expect(shouldAutoStop(start, new Date(limit.getTime() - 1))).toBe(false);
  });
});
