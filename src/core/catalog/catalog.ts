import type { Pair, Project } from "../keito/types.js";

export function pairId(projectId: string, taskId: string): string {
  return `${projectId}:${taskId}`;
}

/**
 * Flattens the workspace into the pairs a timer can actually be started against.
 *
 * Tasks come embedded in the project — GET /projects returns them — so building the whole
 * catalog costs one request rather than one per project.
 */
export function buildCatalog(projects: readonly Project[]): Pair[] {
  const pairs: Pair[] = [];
  for (const project of projects) {
    for (const task of project.tasks ?? []) {
      if (task.is_active === false) continue;
      pairs.push({
        id: pairId(project.id, task.id),
        projectId: project.id,
        projectName: project.name,
        taskId: task.id,
        taskName: task.name,
        ...(project.client?.name ? { clientName: project.client.name } : {}),
      });
    }
  }
  return pairs.sort(
    (a, b) => a.projectName.localeCompare(b.projectName) || a.taskName.localeCompare(b.taskName),
  );
}
