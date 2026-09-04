import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PreferencesStore, DEFAULT_HOTKEY, type Preferences } from "./preferences.js";

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

  it("looks only at stable releases until told otherwise", async () => {
    const store = await PreferencesStore.open(file);

    expect(store.get().includePrereleases).toBe(false);
  });

  it("remembers that pre-releases were asked for across a restart", async () => {
    // A setting that forgets itself between launches looks like a switch that does not
    // work, and update checks are rare enough that nobody would catch it in the act.
    const first = await PreferencesStore.open(file);
    await first.update({ includePrereleases: true });

    const reopened = await PreferencesStore.open(file);

    expect(reopened.get().includePrereleases).toBe(true);
  });

  it("remembers being switched back off, rather than falling back to the default", async () => {
    // false is also the default, so a store that dropped the field entirely would still
    // read as false — this passes for the right reason only if the value round-trips.
    const first = await PreferencesStore.open(file);
    await first.update({ includePrereleases: true });
    await (await PreferencesStore.open(file)).update({ includePrereleases: false });

    const reopened = await PreferencesStore.open(file);

    expect(reopened.get().includePrereleases).toBe(false);
    expect(JSON.parse(await readFile(file, "utf8"))).toHaveProperty("includePrereleases", false);
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

  it("shows every category until one is explicitly hidden", async () => {
    const store = await PreferencesStore.open(file);

    expect(store.get().hidden).toEqual([]);
  });

  it("remembers which categories are hidden", async () => {
    const store = await PreferencesStore.open(file);
    await store.setHidden("p_bank:t_ops", true);
    await store.setHidden("p_acme:t_qa", true);

    expect((await PreferencesStore.open(file)).get().hidden).toEqual([
      "p_bank:t_ops",
      "p_acme:t_qa",
    ]);
  });

  it("unhides", async () => {
    const store = await PreferencesStore.open(file);
    await store.setHidden("p_bank:t_ops", true);

    await store.setHidden("p_bank:t_ops", false);

    expect((await PreferencesStore.open(file)).get().hidden).toEqual([]);
  });

  it("hiding twice does not record it twice", async () => {
    const store = await PreferencesStore.open(file);
    await store.setHidden("p_bank:t_ops", true);
    await store.setHidden("p_bank:t_ops", true);

    expect(store.get().hidden).toEqual(["p_bank:t_ops"]);
  });
});

describe("concurrent writes", () => {
  it("serialises overlapping saves rather than racing for the temporary file", async () => {
    const store = await PreferencesStore.open(file);

    // Nothing awaits in between: this is what two IPC handlers landing in the same tick
    // looks like, and on Windows the losing rename would fail with ENOENT.
    await Promise.all([
      store.addFavourite("p_a:t_a"),
      store.addFavourite("p_b:t_b"),
      store.setHidden("p_c:t_c", true),
    ]);

    const written = JSON.parse(await readFile(file, "utf8")) as Preferences;
    expect(written.favourites).toEqual(["p_a:t_a", "p_b:t_b"]);
    expect(written.hidden).toEqual(["p_c:t_c"]);
  });
});

describe("reset", () => {
  it("clears everything the user configured, on disk as well as in memory", async () => {
    const store = await PreferencesStore.open(file);
    await store.addFavourite("p_acme:t_dev");
    await store.setHidden("p_bank:t_ops", true);
    await store.update({
      accountId: "co_123",
      hotkey: "CommandOrControl+Alt+J",
      trayFallback: "project",
      trayPrefix: "task",
    });

    await store.reset();

    expect(store.get()).toMatchObject({
      favourites: [],
      hidden: [],
      hotkey: DEFAULT_HOTKEY,
      trayFallback: "task",
      trayPrefix: "none",
    });
    // Gone entirely rather than present-and-undefined, which is what reaches the file:
    // JSON.stringify drops an undefined value, so the two would be indistinguishable
    // after a reopen anyway.
    expect(store.get().accountId).toBeUndefined();
    expect("accountId" in store.get()).toBe(false);

    // Reopening proves it reached the file, not just this instance.
    const reopened = await PreferencesStore.open(file);
    expect(reopened.get()).toMatchObject({
      favourites: [],
      hidden: [],
      hotkey: DEFAULT_HOTKEY,
    });
    expect(reopened.get().accountId).toBeUndefined();
  });

  it("leaves the store usable afterwards", async () => {
    const store = await PreferencesStore.open(file);
    await store.addFavourite("p_acme:t_dev");

    await store.reset();
    await store.addFavourite("p_new:t_new");

    expect((await PreferencesStore.open(file)).get().favourites).toEqual(["p_new:t_new"]);
  });
});
