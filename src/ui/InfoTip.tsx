import { useId, useState, type ReactNode } from "react";

/**
 * The "i" beside a setting's name, holding the sentence that used to sit under it.
 *
 * The settings page had a paragraph of explanation under every heading, which is a lot of
 * prose to read past when you already know what you came to change. The explanations are
 * still here — they are just folded away until asked for.
 *
 * Opening is driven by state rather than by a CSS `:hover` rule so that pointer, keyboard
 * and click all reach it, and so a test can watch it open and close. A bubble that is
 * always in the DOM and merely hidden by CSS cannot be told apart from a shown one in
 * jsdom, which would make the test unable to fail.
 *
 * Pointing, focusing and clicking all **open** it; it closes on the way out, on blur, or on
 * Escape. Clicking deliberately does not toggle: a click is preceded by the pointer
 * arriving, so a toggle would shut the bubble the hover had just opened — which is what
 * the first version of this did.
 *
 * The icon is an inline `<svg>`, not a `data:` URI in CSS: `index.html` sets
 * `default-src 'self'` and declares no `img-src`, so a `data:` background is refused
 * silently — it simply draws nothing.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className="infotip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="infotip-button"
        // Named after the setting, because "more information" repeated down the page tells
        // a screen reader user nothing about which one they have landed on.
        aria-label={`About ${label}`}
        aria-expanded={open}
        {...(open ? { "aria-describedby": id } : {})}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            // Stop here: the window's own Escape handling would otherwise act on a
            // keypress the user meant for the bubble.
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
          <path
            d="M8 7.2v4.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <span role="tooltip" id={id} className="infotip-bubble">
          {children}
        </span>
      )}
    </span>
  );
}
