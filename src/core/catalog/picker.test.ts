import { describe, expect, it } from "vitest";
import { buildPicker, RECENT_SUGGESTIONS } from "./picker.js";
import type { Pair } from "../keito/types.js";

const pair = (id: string, projectName: string, taskName: string): Pair => {
  const [projectId, taskId] = id.split(":") as [string, string];
  return { id, projectId, projectName, taskId, taskName };
};

const catalog = [
  pair("p_acme:t_dev", "Acme Rebuild", "Development"),
  pair("p_acme:t_qa", "Acme Rebuild", "QA"),
  pair("p_bank:t_dev", "Bank Portal", "Development"),
  pair("p_bank:t_ops", "Bank Portal", "Ops"),
  pair("p_internal:t_admin", "Internal", "Admin"),
];

const ids = (pairs: readonly Pair[]) => pairs.map((p) => p.id);

describe("buildPicker", () => {
  it("lists favourites in the order they were favourited", () => {
    const result = buildPicker({
      catalog,
      favourites: ["p_internal:t_admin", "p_acme:t_dev"],
      recents: [],
      query: "",
    });

    expect(ids(result.favourites)).toEqual(["p_internal:t_admin", "p_acme:t_dev"]);
  });

  it("suggests only the three most recent, so the list stays short", () => {
    const result = buildPicker({
      catalog,
      favourites: [],
      recents: ["p_acme:t_dev", "p_acme:t_qa", "p_bank:t_dev", "p_bank:t_ops"],
      query: "",
    });

    expect(RECENT_SUGGESTIONS).toBe(3);
    expect(ids(result.recent)).toEqual(["p_acme:t_dev", "p_acme:t_qa", "p_bank:t_dev"]);
  });

  it("does not repeat a favourite among the recent suggestions", () => {
    const result = buildPicker({
      catalog,
      favourites: ["p_acme:t_dev"],
      recents: ["p_acme:t_dev", "p_acme:t_qa", "p_bank:t_dev", "p_bank:t_ops"],
      query: "",
    });

    expect(ids(result.recent)).toEqual(["p_acme:t_qa", "p_bank:t_dev", "p_bank:t_ops"]);
  });

  it("groups everything under its project, so you always know where to look", () => {
    const result = buildPicker({ catalog, favourites: [], recents: [], query: "" });

    expect(result.projects.map((group) => [group.projectName, ids(group.pairs)])).toEqual([
      ["Acme Rebuild", ["p_acme:t_dev", "p_acme:t_qa"]],
      ["Bank Portal", ["p_bank:t_dev", "p_bank:t_ops"]],
      ["Internal", ["p_internal:t_admin"]],
    ]);
  });

  it("keeps every task under All Projects even when it is already a favourite", () => {
    const result = buildPicker({
      catalog,
      favourites: ["p_acme:t_dev"],
      recents: ["p_bank:t_dev"],
      query: "",
    });

    expect(result.projects.flatMap((group) => ids(group.pairs))).toContain("p_acme:t_dev");
    expect(result.projects.flatMap((group) => ids(group.pairs))).toContain("p_bank:t_dev");
  });

  it("filters on project and task name together, case-insensitively", () => {
    const result = buildPicker({ catalog, favourites: [], recents: [], query: "bank ops" });

    expect(result.projects.map((group) => ids(group.pairs))).toEqual([["p_bank:t_ops"]]);
  });

  it("keeps a whole project when the query matches only its name", () => {
    const result = buildPicker({ catalog, favourites: [], recents: [], query: "acme" });

    expect(result.projects.map((group) => ids(group.pairs))).toEqual([
      ["p_acme:t_dev", "p_acme:t_qa"],
    ]);
  });

  it("filters the favourite and recent lists too", () => {
    const result = buildPicker({
      catalog,
      favourites: ["p_internal:t_admin", "p_acme:t_dev"],
      recents: ["p_bank:t_dev"],
      query: "acme",
    });

    expect(ids(result.favourites)).toEqual(["p_acme:t_dev"]);
    expect(result.recent).toEqual([]);
  });

  it("forgets a favourite whose project has been archived out of the catalog", () => {
    const result = buildPicker({
      catalog,
      favourites: ["p_deleted:t_gone"],
      recents: [],
      query: "",
    });

    expect(result.favourites).toEqual([]);
  });

  it("reports when a query matches nothing at all", () => {
    const result = buildPicker({ catalog, favourites: [], recents: [], query: "zzz" });

    expect(result.isEmpty).toBe(true);
  });

  it("hides a category the user switched off in settings", () => {
    const result = buildPicker({
      catalog,
      favourites: [],
      recents: [],
      hidden: ["p_bank:t_ops"],
      query: "",
    });

    expect(result.projects.flatMap((group) => ids(group.pairs))).not.toContain("p_bank:t_ops");
    expect(result.projects.flatMap((group) => ids(group.pairs))).toContain("p_bank:t_dev");
  });

  it("drops a project entirely once all of its tasks are hidden", () => {
    const result = buildPicker({
      catalog,
      favourites: [],
      recents: [],
      hidden: ["p_bank:t_dev", "p_bank:t_ops"],
      query: "",
    });

    expect(result.projects.map((group) => group.projectName)).toEqual(["Acme Rebuild", "Internal"]);
  });

  it("still shows a hidden category that is a favourite", () => {
    const result = buildPicker({
      catalog,
      favourites: ["p_bank:t_ops"],
      recents: [],
      hidden: ["p_bank:t_ops"],
      query: "",
    });

    expect(ids(result.favourites)).toEqual(["p_bank:t_ops"]);
    expect(result.projects.flatMap((group) => ids(group.pairs))).toContain("p_bank:t_ops");
  });

  it("still shows a hidden category you have used recently", () => {
    const result = buildPicker({
      catalog,
      favourites: [],
      recents: ["p_bank:t_ops"],
      hidden: ["p_bank:t_ops"],
      query: "",
    });

    expect(ids(result.recent)).toEqual(["p_bank:t_ops"]);
    expect(result.projects.flatMap((group) => ids(group.pairs))).toContain("p_bank:t_ops");
  });

  it("honours recency beyond the three suggested, so a used task is never hidden", () => {
    const result = buildPicker({
      catalog,
      favourites: [],
      // Fourth in the ranking, so not among the suggestions, but still recently used.
      recents: ["p_acme:t_dev", "p_acme:t_qa", "p_internal:t_admin", "p_bank:t_ops"],
      hidden: ["p_bank:t_ops"],
      query: "",
    });

    expect(ids(result.recent)).not.toContain("p_bank:t_ops");
    expect(result.projects.flatMap((group) => ids(group.pairs))).toContain("p_bank:t_ops");
  });

  it("shows everything when nothing is hidden", () => {
    const result = buildPicker({ catalog, favourites: [], recents: [], query: "" });

    expect(result.projects.flatMap((group) => ids(group.pairs))).toHaveLength(catalog.length);
  });
});
