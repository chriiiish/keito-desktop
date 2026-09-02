import type { Pair, Project, Task } from "../keito/types.js";

export function pairId(projectId: string, taskId: string): string {
  return `${projectId}:${taskId}`;
}

/**
 * Flattens the workspace into the pairs a timer can actually be started against.
 * Sorted by project then task name so the popover's "everything else" section is
 * stable and scannable.
 */
export function buildCatalog(
  projects: readonly Project[],
  tasksByProjectId: Readonly<Record<string, readonly Task[]>>,
): Pair[] {
  const pairs: Pair[] = [];
  for (const project of projects) {
    for (const task of tasksByProjectId[project.id] ?? []) {
      pairs.push({
        id: pairId(project.id, task.id),
        projectId: project.id,
        projectName: project.name,
        taskId: task.id,
        taskName: task.name,
        ...(project.client_name === undefined ? {} : { clientName: project.client_name }),
      });
    }
  }
  return pairs.sort(
    (a, b) => a.projectName.localeCompare(b.projectName) || a.taskName.localeCompare(b.taskName),
  );
}
