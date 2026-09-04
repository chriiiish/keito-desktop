/** What the Integrations card reports about the connection. */
export type AzureStatus = "off" | "needs-token" | "connected" | "error";

export interface AzureConnectionState {
  /** The toggle in Integrations. */
  enabled: boolean;
  /** Whether a token is stored. A failed connect stores nothing. */
  hasToken: boolean;
  /** The last failure, if there is one. */
  error: string | null;
  /** Whether the last check actually worked. */
  connected: boolean;
}

/**
 * Which of the four states the integration is in.
 *
 * **A failure outranks having no token.** A connect that fails stores nothing — the token
 * is only kept once it has been proved — so a rejected token or a wrong URL leaves an
 * error and no stored credential at once. Asking "is there a token?" first reported that
 * as `needs-token`, which reads as *you have not filled this in yet* and is exactly what
 * the user just did: the card said nothing was set up while showing the error explaining
 * why what they set up did not work.
 *
 * Pure, so the ladder can be exercised in every combination rather than reasoned about
 * in the middle of `AppService`.
 */
export function azureStatus(state: AzureConnectionState): AzureStatus {
  if (!state.enabled) return "off";
  if (state.error) return "error";
  if (!state.hasToken) return "needs-token";
  return state.connected ? "connected" : "needs-token";
}
