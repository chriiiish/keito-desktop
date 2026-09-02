import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Runs an async action at most once at a time. The guard is a ref, not state, because two
 * events in the same tick would both see a stale `pending` and both fire.
 */
export function useAsyncAction(action: () => Promise<unknown>): [boolean, () => void] {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    void (async () => {
      try {
        await action();
      } finally {
        inFlight.current = false;
        // The popover unmounts itself on success; do not set state into the void.
        if (mounted.current) setPending(false);
      }
    })();
  }, [action]);

  return [pending, run];
}

type AsyncButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  onClick: () => Promise<unknown>;
};

/** A button that becomes an inert spinner until its action settles. */
export function AsyncButton({
  onClick,
  children,
  disabled,
  className,
  ...rest
}: AsyncButtonProps): JSX.Element {
  const [pending, run] = useAsyncAction(onClick);

  return (
    <button
      {...rest}
      type={rest.type ?? "button"}
      className={className}
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={run}
    >
      {pending ? <Spinner /> : children}
    </button>
  );
}

/** Sized in ems so it fills whatever button it lands in. */
export function Spinner(): JSX.Element {
  return <span className="spinner" role="status" aria-label="Working" />;
}
