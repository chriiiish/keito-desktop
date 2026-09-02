import { useEffect, useState } from "react";

/** Ticks locally from the server's start time — no polling just to move a clock. */
export function Elapsed({ startedAtMs }: { startedAtMs: number }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const total = Math.max(0, Math.floor((now - startedAtMs) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="elapsed">
      {pad(Math.floor(total / 3600))}:{pad(Math.floor(total / 60) % 60)}:{pad(total % 60)}
    </span>
  );
}
