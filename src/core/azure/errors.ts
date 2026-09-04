/** Base for every failure the Azure DevOps client raises, so callers can catch one type. */
export class AzureError extends Error {
  readonly status: number | undefined;
  readonly path: string | undefined;

  constructor(message: string, context: { status?: number; path?: string; cause?: unknown } = {}) {
    super(message, context.cause === undefined ? undefined : { cause: context.cause });
    this.name = new.target.name;
    this.status = context.status;
    this.path = context.path;
  }
}

/**
 * The PAT was rejected, expired, or lacks the scope for what was asked.
 *
 * Azure DevOps answers an unusable PAT with **203 Non-Authoritative Information** and an
 * HTML sign-in page rather than 401 — so this is raised on 203 as well as 401/403. A
 * `response.ok` check reads that 203 as success and then parses HTML as JSON, which fails
 * somewhere far away from the actual cause.
 */
export class AzureAuthError extends AzureError {}

/** The request never reached Azure DevOps — DNS, offline, TLS, timeout. */
export class AzureNetworkError extends AzureError {}

/** Azure DevOps answered with an error status we have no more specific meaning for. */
export class AzureRequestError extends AzureError {}

/** The organisation could not be found from the PAT, so the user has to supply the URL. */
export class AzureOrganisationUnknownError extends AzureError {}
