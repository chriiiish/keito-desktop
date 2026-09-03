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

/**
 * What looking for the organisation turned up.
 *
 * A discriminated result rather than "a URL or null", because the four ways this fails want
 * four different things from the user, and collapsing them into null left the one message
 * it could show — "could not work out your organisation" — unable to say which had
 * happened. That is undiagnosable from the outside, which is exactly the report it
 * produced.
 */
export type OrganisationDiscovery =
  | { outcome: "found"; organisationUrl: string }
  /** The token reaches more than one, and picking for the user could pick the wrong one. */
  | { outcome: "several"; organisations: string[] }
  /** The token is valid but belongs to no organisation this API can see. */
  | { outcome: "none" }
  /** No profile access: the scope is missing, or the token is scoped to one organisation. */
  | { outcome: "no-access"; reason: string };
