/** The authenticated user, plus the workspace their key belongs to. */
export interface Identity {
  userId: string;
  name: string;
  accountId: string;
  accountName: string;
}

export interface Project {
  id: string;
  name: string;
  client?: { id?: string; name?: string } | null;
  /** GET /projects embeds the tasks assigned to each project — no second call needed. */
  tasks?: Task[];
}

export interface Task {
  id: string;
  name: string;
  is_active?: boolean;
}

/**
 * A (project, task) pair — the unit this app calls a "category". Keito has no category
 * resource; a time entry needs both ids, so the pair is what you pick and favourite.
 */
export interface Pair {
  id: string;
  projectId: string;
  projectName: string;
  taskId: string;
  taskName: string;
  clientName?: string;
}

export interface TimeEntry {
  id: string;
  project_id: string;
  task_id: string;
  /** Entries embed the project and task, so their names need no catalog lookup. */
  project?: { id: string; name: string } | null;
  task?: { id: string; name: string } | null;
  spent_date: string;
  started_time: string | null;
  ended_time: string | null;
  /**
   * ISO instant the timer began. The live API provides this; prefer it over reconstructing
   * a start from spent_date plus an HH:mm wall-clock string.
   */
  timer_started_at?: string | null;
  duration_seconds?: number | null;
  hours: number | null;
  is_running: boolean;
  notes: string | null;
}
