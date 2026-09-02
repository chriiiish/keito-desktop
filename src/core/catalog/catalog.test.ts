import { describe, expect, it } from "vitest";
import { buildCatalog, pairId } from "./catalog.js";

const projects = [
  { id: "p_zebra", name: "Zebra", client_name: "Acme" },
  { id: "p_apple", name: "Apple", client_name: "Beta Ltd" },
  { id: "p_empty", name: "Unstaffed", client_name: "Acme" },
];

const tasksByProject = {
  p_zebra: [{ id: "t_dev", name: "Development" }],
  p_apple: [
    { id: "t_design", name: "Design" },
    { id: "t_dev", name: "Development" },
  ],
  p_empty: [],
};

describe("buildCatalog", () => {
  it("produces one selectable pair per task assigned to a project", () => {
    const catalog = buildCatalog(projects, tasksByProject);

    expect(catalog.map((pair) => pair.id)).toEqual([
      "p_apple:t_design",
      "p_apple:t_dev",
      "p_zebra:t_dev",
    ]);
  });

  it("carries the names the popover displays, so it never needs a second lookup", () => {
    const catalog = buildCatalog(projects, tasksByProject);

    expect(catalog[2]).toEqual({
      id: "p_zebra:t_dev",
      projectId: "p_zebra",
      projectName: "Zebra",
      taskId: "t_dev",
      taskName: "Development",
      clientName: "Acme",
    });
  });

  it("omits projects with no tasks assigned, since they cannot be timed against", () => {
    const catalog = buildCatalog(projects, tasksByProject);

    expect(catalog.some((pair) => pair.projectId === "p_empty")).toBe(false);
  });

  it("identifies a pair by project and task together", () => {
    expect(pairId("p_apple", "t_dev")).toBe("p_apple:t_dev");
  });
});
