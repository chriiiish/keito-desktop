/** How long away from the keyboard before we ask whether the time still counts. */
export const IDLE_THRESHOLD_SECONDS = 10 * 60;

/** Safety net: no single timer may run longer than this. */
export const MAX_TIMER_HOURS = 10;

export interface IdleReturned {
  type: "returned";
  /** When the user actually stopped working — the point a discard would trim back to. */
  awaySince: Date;
  awaySeconds: number;
}

/**
 * Turns a stream of "seconds since last input" samples into a single event when the user
 * comes back from a meaningful absence. Pure: the caller supplies the samples and the clock,
 * so this is testable without powerMonitor.
 */
export class IdleWatcher {
  #thresholdSeconds: number;
  #away: { since: Date; seconds: number } | null = null;

  constructor(thresholdSeconds: number = IDLE_THRESHOLD_SECONDS) {
    this.#thresholdSeconds = thresholdSeconds;
  }

  observe(idleSeconds: number, at: Date): IdleReturned | null {
    if (idleSeconds >= this.#thresholdSeconds) {
      // Still away. Track the longest reading so a returning sample knows the full span.
      this.#away = { since: new Date(at.getTime() - idleSeconds * 1000), seconds: idleSeconds };
      return null;
    }

    const away = this.#away;
    this.#away = null;
    if (!away) return null;
    return { type: "returned", awaySince: away.since, awaySeconds: away.seconds };
  }
}

export function shouldAutoStop(startedAt: Date, now: Date, maxHours = MAX_TIMER_HOURS): boolean {
  return now.getTime() - startedAt.getTime() >= maxHours * 3_600_000;
}
