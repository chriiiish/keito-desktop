/** A work item, reduced to what the note field needs. */
export interface WorkItem {
  id: number;
  title: string;
  /** The team project it belongs to — shown beside the title, since one list spans several. */
  project: string;
  state: string;
  /** ISO instant of the last change. What the list is ordered by. */
  changedDate: string | null;
}

/** A numeric field a work item can carry — a place time can be written to. */
export interface WorkItemField {
  /** e.g. "Microsoft.VSTS.Scheduling.Effort" — what the PATCH needs. */
  referenceName: string;
  /** e.g. "Effort" — what the picker shows. */
  name: string;
}
