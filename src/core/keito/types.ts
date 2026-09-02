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
  client_name?: string;
}

export interface Task {
  id: string;
  name: string;
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
  spent_date: string;
  started_time: string | null;
  ended_time: string | null;
  hours: number | null;
  is_running: boolean;
  notes: string | null;
}
