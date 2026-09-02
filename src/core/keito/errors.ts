/** Base for every failure the Keito client raises, so callers can catch one type. */
export class KeitoError extends Error {
  /** HTTP status, when the request reached Keito at all. */
  readonly status: number | undefined;
  /** The endpoint that failed, e.g. "/users/me". */
  readonly path: string | undefined;

  constructor(message: string, context: { status?: number; path?: string; cause?: unknown } = {}) {
    super(message, context.cause === undefined ? undefined : { cause: context.cause });
    this.name = new.target.name;
    this.status = context.status;
    this.path = context.path;
  }
}

/** The key was rejected (401/403). The UI routes this to settings, not a generic error. */
export class KeitoAuthError extends KeitoError {}

/**
 * A personal sync key. These are read-only across a fixed endpoint allowlist and cannot
 * create time entries, so we refuse them at setup rather than at the first failed switch.
 */
export class KeitoReadOnlyError extends KeitoError {}

/** Another timer is already running and `replace_running` was not set (409). */
export class KeitoConflictError extends KeitoError {}

/** The request never reached Keito at all — DNS, offline, TLS, timeout. */
export class KeitoNetworkError extends KeitoError {}

/** Keito answered with an error status we have no more specific meaning for. */
export class KeitoRequestError extends KeitoError {}

/**
 * No company id was sent. Keito requires the Keito-Account-Id header on every request,
 * including /users/me — so it cannot be discovered, only entered.
 */
export class KeitoAccountIdRequiredError extends KeitoError {}
