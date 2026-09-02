import { useEffect, useState } from "react";

/**
 * A clock that re-renders on a tick, for durations rendered from a start time.
 *
 * One interval per caller rather than one per row: the lists pass a single `now` down to
 * every row they render, so a busy day does not run twenty timers to move twenty clocks.
 *
 * `enabled` is what stops a list with nothing running from ticking at all.
 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    // Re-read immediately: a tab left in the background can be far behind by now.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);

  return now;
}
