/** A work item, reduced to what the note field needs. */
export interface WorkItem {
  id: number;
  title: string;
  /** "Bug", "User Story", "Task" — shown beside the title so a list of ids is readable. */
  type: string;
  state: string;
}

/** Where an organisation lives, and how it was arrived at. */
export interface AzureConnection {
  /** e.g. "https://dev.azure.com/acme" — no trailing slash. */
  organisationUrl: string;
  /** True when `/_apis/accounts` found it rather than the user typing it. */
  discovered: boolean;
}
