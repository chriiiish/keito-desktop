import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PreferencesStore, DEFAULT_HOTKEY } from "./preferences.js";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "keito-prefs-"));
  file = join(dir, "preferences.json");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("PreferencesStore", () => {
  it("starts a fresh install with no favourites and a default hotkey", async () => {
    const store = await PreferencesStore.open(file);

    expect(store.get()).toMatchObject({ favourites: [], hotkey: DEFAULT_HOTKEY });
  });

  it("remembers favourites across a restart", async () => {
    const first = await PreferencesStore.open(file);
    await first.addFavourite("p_acme:t_dev");
    await first.addFavourite("p_bank:t_qa");

    const reopened = await PreferencesStore.open(file);

    expect(reopened.get().favourites).toEqual(["p_acme:t_dev", "p_bank:t_qa"]);
  });

  it("keeps the order you favourited things in, since that is the order they are listed", async () => {
    const store = await PreferencesStore.open(file);
    await store.addFavourite("p_zebra:t_a");
    await store.addFavourite("p_apple:t_b");

    expect(store.get().favourites).toEqual(["p_zebra:t_a", "p_apple:t_b"]);
  });

  it("favouriting something twice does not list it twice", async () => {
    const store = await PreferencesStore.open(file);
    await store.addFavourite("p_acme:t_dev");
    await store.addFavourite("p_acme:t_dev");

    expect(store.get().favourites).toEqual(["p_acme:t_dev"]);
  });

  it("unfavourites", async () => {
    const store = await PreferencesStore.open(file);
    await store.addFavourite("p_acme:t_dev");
    await store.addFavourite("p_bank:t_qa");

    await store.removeFavourite("p_acme:t_dev");

    expect((await PreferencesStore.open(file)).get().favourites).toEqual(["p_bank:t_qa"]);
  });

  it("falls back to defaults rather than crashing on a corrupt preferences file", async () => {
    await writeFile(file, "{ not json");

    const store = await PreferencesStore.open(file);

    expect(store.get().favourites).toEqual([]);
  });

  it("persists the discovered account id so setup is not repeated every launch", async () => {
    const store = await PreferencesStore.open(file);
    await store.update({ accountId: "co_9", workspaceTimezone: "Europe/London" });

    expect((await PreferencesStore.open(file)).get()).toMatchObject({
      accountId: "co_9",
      workspaceTimezone: "Europe/London",
    });
  });

  it("forgets the company id on disconnect, so the next key detects its own", async () => {
    const store = await PreferencesStore.open(file);
    await store.update({ accountId: "co_9" });

    await store.update({ accountId: undefined });

    expect((await PreferencesStore.open(file)).get().accountId).toBeUndefined();
  });

  it("defaults the tray label to the note, falling back to the task", async () => {
    const store = await PreferencesStore.open(file);

    expect(store.get()).toMatchObject({ trayFallback: "task", trayPrefix: "none" });
  });

  it("remembers tray label choices", async () => {
    const store = await PreferencesStore.open(file);
    await store.update({ trayFallback: "project", trayPrefix: "task" });

    expect((await PreferencesStore.open(file)).get()).toMatchObject({
      trayFallback: "project",
      trayPrefix: "task",
    });
  });
});
