/** Base for every failure the Keito client raises, so callers can catch one type. */
export class KeitoError extends Error {}

/** The key was rejected (401/403). The UI routes this to settings, not a generic error. */
export class KeitoAuthError extends KeitoError {}

/**
 * A personal sync key. These are read-only across a fixed endpoint allowlist and cannot
 * create time entries, so we refuse them at setup rather than at the first failed switch.
 */
export class KeitoReadOnlyError extends KeitoError {}

/** Another timer is already running and `replace_running` was not set (409). */
export class KeitoConflictError extends KeitoError {}

/** The request never reached Keito, or it answered with something unusable. */
export class KeitoNetworkError extends KeitoError {}
