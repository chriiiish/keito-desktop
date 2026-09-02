import { useRef, useState } from "react";

/** A switch that locks itself until the write it triggered comes back. */
export function Toggle({
  checked,
  label,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  label: string;
  /** Locked for a reason of the caller's own, on top of the in-flight lock below. */
  disabled?: boolean;
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
        disabled={pending || disabled}
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
