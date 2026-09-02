import { describe, expect, it } from "vitest";
import { buildCatalog, pairId } from "./catalog.js";

// GET /projects embeds each project's assigned tasks, so no per-project lookup is needed.
const projects = [
  { id: "p_zebra", name: "Zebra", client: { name: "Acme" }, tasks: [{ id: "t_dev", name: "Development" }] },
  {
    id: "p_apple",
    name: "Apple",
    client: { name: "Beta Ltd" },
    tasks: [
      { id: "t_design", name: "Design" },
      { id: "t_dev", name: "Development" },
    ],
  },
  { id: "p_empty", name: "Unstaffed", client: { name: "Acme" }, tasks: [] },
];

describe("buildCatalog", () => {
  it("produces one selectable pair per task assigned to a project", () => {
    const catalog = buildCatalog(projects);

    expect(catalog.map((pair) => pair.id)).toEqual([
      "p_apple:t_design",
      "p_apple:t_dev",
      "p_zebra:t_dev",
    ]);
  });

  it("carries the names the popover displays, so it never needs a second lookup", () => {
    const catalog = buildCatalog(projects);

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
    const catalog = buildCatalog(projects);

    expect(catalog.some((pair) => pair.projectId === "p_empty")).toBe(false);
  });

  it("leaves out tasks that have been deactivated", () => {
    const catalog = buildCatalog([
      {
        id: "p_a",
        name: "Alpha",
        tasks: [
          { id: "t_live", name: "Live" },
          { id: "t_dead", name: "Retired", is_active: false },
        ],
      },
    ]);

    expect(catalog.map((pair) => pair.taskId)).toEqual(["t_live"]);
  });

  it("copes with a project that carries no tasks field at all", () => {
    expect(buildCatalog([{ id: "p_a", name: "Alpha" }])).toEqual([]);
  });

  it("identifies a pair by project and task together", () => {
    expect(pairId("p_apple", "t_dev")).toBe("p_apple:t_dev");
  });
});
