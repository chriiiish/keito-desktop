import type { OrganisationDiscovery } from "./types.js";

/**
 * What to tell someone when the organisation could not be settled on its own.
 *
 * **None of these are the user's mistake, and none of them mean the token is broken.** The
 * commonest by far is `no-access`, and it does not mean what its first wording implied.
 *
 * A personal access token is created either for one organisation or for *All accessible
 * organizations*. Only the second kind can authenticate against
 * `app.vssps.visualstudio.com`, which is the host that knows which organisations exist — so
 * a token scoped to one organisation is refused there **even with User Profile (Read)
 * granted**, while working perfectly against `dev.azure.com` for the very work items it was
 * made to read. Telling that user their token was "refused" is both alarming and wrong: it
 * works, it simply cannot answer this particular question, and the answer is a URL they
 * already know.
 */
export function describeDiscovery(
  found: Exclude<OrganisationDiscovery, { outcome: "found" }>,
): string {
  switch (found.outcome) {
    case "several":
      return `That token reaches ${found.organisations.length} organisations (${found.organisations.join(", ")}). Enter the URL of the one you want, then press Connect again.`;
    case "none":
      return "That token does not appear to belong to any Azure DevOps organisation. Enter your Azure DevOps URL, then press Connect again.";
    case "no-access":
      return (
        "Your token works — it just cannot look up which organisation it belongs to. " +
        "Only a token created for “All accessible organizations” can do that; one created " +
        "for a single organisation cannot, whatever scopes it has. " +
        "Add your Azure DevOps URL and press Connect again."
      );
  }
}
