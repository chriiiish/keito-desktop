import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { searchWorkItems } from "../core/azure/search.js";
import { workItemNote } from "../core/azure/note.js";
import type { WorkItem } from "../core/azure/types.js";
import { AzureLogo } from "./AzureLogo.js";

const optionId = (index: number) => `work-item-${index}`;

export interface NoteFieldHandle {
  focus: () => void;
}

/**
 * The note box, with the assigned Azure DevOps work items behind it.
 *
 * **When no work items are offered this is exactly the input it replaced.** No listbox, no
 * extra key handling, and Enter still submits the form — the app's whole loop is type a
 * note and press Enter, and an integration nobody switched on must not put a step in front
 * of it.
 *
 * With items, it becomes a combobox on the same terms as `CategoryPicker`: ↓ opens the
 * list, typing filters it, Enter picks the highlighted ticket *instead of* submitting, and
 * Escape closes the list keeping what was typed. Enter only ever means "pick" while the
 * list is open, so anyone who never opens it types and submits exactly as before.
 */
export const NoteField = forwardRef<NoteFieldHandle, {
  value: string;
  onChange: (value: string) => void;
  workItems: readonly WorkItem[];
  connected: boolean;
}>(function NoteField({ value, onChange, workItems, connected }, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  }));

  const offered = connected && workItems.length > 0;
  const matches = offered ? searchWorkItems(workItems, value) : [];

  // A filter that no longer matches anything should not leave a highlight pointing past
  // the end of the list, where Enter would pick nothing.
  useEffect(() => {
    setCursor((current) => (current < matches.length ? current : 0));
  }, [matches.length]);

  // Clicking away closes the list without touching what was typed.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const pick = (item: WorkItem) => {
    onChange(workItemNote(item));
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!offered) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setCursor(0);
      } else {
        setCursor((c) => Math.min(c + 1, matches.length - 1));
      }
      return;
    }

    if (!open) return;

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter") {
      const item = matches[cursor];
      if (item) {
        // Picks rather than starting the timer. The next Enter starts it.
        event.preventDefault();
        pick(item);
      }
    } else if (event.key === "Escape") {
      // Closes the list, not the popover — so Escape keeps whatever was typed.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className={`note-field${offered ? " has-work-items" : ""}`} ref={rootRef}>
      {connected && (
        /*
         * A button, not decoration: the mark is the most obvious thing to click when you
         * want to see what is assigned to you, and a logo that looks clickable and is not
         * is worse than no logo. `tabIndex={-1}` keeps it out of the tab order — the input
         * beside it is the focusable thing, and Tab should not stop on an icon that only
         * repeats what ↓ already does.
         */
        <button
          type="button"
          className="note-azure"
          tabIndex={-1}
          aria-label={open ? "Hide your Azure DevOps work items" : "Show your Azure DevOps work items"}
          // The tooltip says what the mark *means*; the placeholder beside it already says
          // what to do with it, so repeating that here would be the third telling.
          title="Connected to Azure DevOps"
          onClick={() => {
            if (!offered) return;
            setOpen((wasOpen) => !wasOpen);
            setCursor(0);
            inputRef.current?.focus();
          }}
        >
          <AzureLogo />
        </button>
      )}
      <input
        ref={inputRef}
        placeholder={offered ? "What are you working on? ↓ for your tickets" : "What are you working on?"}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          if (offered) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        role={offered ? "combobox" : undefined}
        aria-expanded={offered ? open : undefined}
        aria-controls={offered ? "work-item-listbox" : undefined}
        aria-autocomplete={offered ? "list" : undefined}
        aria-activedescendant={open && matches[cursor] ? optionId(cursor) : undefined}
      />
      {open && matches.length > 0 && (
        <ul role="listbox" id="work-item-listbox" className="work-item-list">
          {matches.map((item, index) => (
            <li
              key={item.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === cursor}
              className={index === cursor ? "cursor" : ""}
              // Pointer down rather than click: the input blurs on mousedown, and a blur
              // that closed the list would take the row out from under the click.
              onPointerDown={(event) => {
                event.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setCursor(index)}
            >
              <span className="work-item-id">{item.id}</span>
              <span className="work-item-title">{item.title}</span>
              {item.project && <span className="work-item-project">{item.project}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
