import { describe, expect, it } from "vitest";
import { buildPicker } from "./picker.js";
import type { Pair } from "../keito/types.js";

const pair = (id: string, projectName: string, taskName: string): Pair => {
  const [projectId, taskId] = id.split(":") as [string, string];
  return { id, projectId, projectName, taskId, taskName };
};

const catalog = [
  pair("p_acme:t_dev", "Acme Rebuild", "Development"),
  pair("p_acme:t_qa", "Acme Rebuild", "QA"),
  pair("p_bank:t_dev", "Bank Portal", "Development"),
  pair("p_internal:t_admin", "Internal", "Admin"),
];

const ids = (sections: ReturnType<typeof buildPicker>) =>
  sections.map((s) => [s.section, s.pairs.map((p) => p.id)]);

describe("buildPicker", () => {
  it("puts favourites first, then recents, then everything else", () => {
    const sections = buildPicker({
      catalog,
      favourites: ["p_internal:t_admin"],
      recents: ["p_bank:t_dev", "p_acme:t_dev"],
      query: "",
    });

    expect(ids(sections)).toEqual([
      ["favourites", ["p_internal:t_admin"]],
      ["recent", ["p_bank:t_dev", "p_acme:t_dev"]],
      ["all", ["p_acme:t_qa"]],
    ]);
  });

  it("never lists the same pair twice, even when it is both favourited and recent", () => {
    const sections = buildPicker({
      catalog,
      favourites: ["p_acme:t_dev"],
      recents: ["p_acme:t_dev", "p_bank:t_dev"],
      query: "",
    });

    expect(ids(sections)).toEqual([
      ["favourites", ["p_acme:t_dev"]],
      ["recent", ["p_bank:t_dev"]],
      ["all", ["p_acme:t_qa", "p_internal:t_admin"]],
    ]);
  });

  it("filters on project and task name together, case-insensitively", () => {
    const sections = buildPicker({
      catalog,
      favourites: [],
      recents: [],
      query: "acme dev",
    });

    expect(ids(sections)).toEqual([["all", ["p_acme:t_dev"]]]);
  });

  it("drops a section once filtering empties it", () => {
    const sections = buildPicker({
      catalog,
      favourites: ["p_internal:t_admin"],
      recents: [],
      query: "bank",
    });

    expect(ids(sections)).toEqual([["all", ["p_bank:t_dev"]]]);
  });

  it("forgets a favourite whose project has been archived out of the catalog", () => {
    const sections = buildPicker({
      catalog,
      favourites: ["p_deleted:t_gone"],
      recents: [],
      query: "",
    });

    expect(sections.some((s) => s.section === "favourites")).toBe(false);
  });
});
