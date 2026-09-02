import { useRef, useState } from "react";

/** A switch that locks itself until the write it triggered comes back. */
export function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => Promise<unknown>;
}): JSX.Element {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  return (
    <label className={`switch${pending ? " pending" : ""}`}>
      <input
        type="checkbox"
        aria-label={label}
        aria-busy={pending}
        checked={checked}
        disabled={pending}
        onChange={(event) => {
          if (inFlight.current) return;
          inFlight.current = true;
          setPending(true);
          void onChange(event.target.checked).finally(() => {
            inFlight.current = false;
            setPending(false);
          });
        }}
      />
      <span className="track" aria-hidden="true" />
    </label>
  );
}
