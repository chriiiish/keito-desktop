import { useEffect, useMemo, useRef, useState } from "react";
import { buildPicker } from "../core/catalog/picker.js";
import { AsyncButton } from "./AsyncButton.js";
import type { Pair } from "../core/keito/types.js";

interface CategoryPickerProps {
  catalog: readonly Pair[];
  favourites: readonly string[];
  recents: readonly string[];
  hidden: readonly string[];
  selectedId: string;
  onSelect: (pairId: string) => void;
  onToggleFavourite: (pairId: string) => Promise<unknown>;
}

/**
 * A filterable category dropdown. Native <select> can't do this: options can't hold a
 * favourite button, and there is no way to type-filter across project and task together.
 */
/** Stable per-option DOM id, for aria-activedescendant. */
const optionId = (pairId: string) => `category-option-${pairId.replace(/[^\w-]/g, "_")}`;

export function CategoryPicker({
  catalog,
  favourites,
  recents,
  hidden,
  selectedId,
  onSelect,
  onToggleFavourite,
}: CategoryPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cursorRef = useRef<HTMLLIElement>(null);

  const result = useMemo(
    () => buildPicker({ catalog, favourites, recents, hidden, query }),
    [catalog, favourites, recents, hidden, query],
  );

  // The flat order the arrow keys walk, matching what is rendered top to bottom.
  const flat = useMemo(
    () => [...result.favourites, ...result.recent, ...result.projects.flatMap((g) => g.pairs)],
    [result],
  );

  const selected = catalog.find((pair) => pair.id === selectedId);

  useEffect(() => setCursor(0), [query]);

  // Keep the highlighted row visible when arrowing past the edge of the menu.
  useEffect(() => {
    // Optional call: jsdom, and some embedded runtimes, do not implement it.
    cursorRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [cursor, open]);
  useEffect(() => {
    if (open) filterRef.current?.focus();
    else setQuery("");
  }, [open]);

  // Click-away closes, the way a dropdown should.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (pairId: string) => {
    onSelect(pairId);
    setOpen(false);
  };

  /** Opens with the highlight already on `index`, so arrows continue from there. */
  const openAt = (index: number) => {
    setCursor(Math.max(0, Math.min(index, flat.length - 1)));
    setOpen(true);
  };

  const selectedIndex = () => {
    const index = flat.findIndex((pair) => pair.id === selectedId);
    return index >= 0 ? index : 0;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Closed: an arrow opens the list, moving one step from whatever is selected.
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openAt(selectedIndex() + (event.key === "ArrowDown" ? 1 : -1));
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter") {
      // Enter picks from the list; it must not also submit the start form underneath.
      event.preventDefault();
      event.stopPropagation();
      const pair = flat[cursor];
      if (pair) choose(pair.id);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const row = (pair: Pair, label: string) => {
    const index = flat.indexOf(pair);
    return (
      <li
        key={pair.id}
        id={optionId(pair.id)}
        ref={index === cursor ? cursorRef : undefined}
        role="option"
        aria-selected={pair.id === selectedId}
        className={`option${index === cursor ? " cursor" : ""}`}
        onMouseEnter={() => setCursor(index)}
        onClick={() => choose(pair.id)}
      >
        <span className="option-label">{label}</span>
        <span onClick={(event) => event.stopPropagation()}>
          <AsyncButton
            className={`star${favourites.includes(pair.id) ? " on" : ""}`}
            title={favourites.includes(pair.id) ? "Remove from favourites" : "Add to favourites"}
            aria-label={`Favourite ${pair.projectName} ${pair.taskName}`}
            onClick={() => onToggleFavourite(pair.id)}
          >
            ★
          </AsyncButton>
        </span>
      </li>
    );
  };

  return (
    <div className="picker" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="picker-trigger"
        aria-label="Category"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex()))}
      >
        <span className="picker-value">
          {selected ? (
            <>
              <strong>{selected.taskName}</strong>
              <span>{selected.projectName}</span>
            </>
          ) : (
            <span className="muted">Choose a category…</span>
          )}
        </span>
        <span className="chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="picker-menu">
          <input
            ref={filterRef}
            className="picker-filter"
            placeholder="Filter projects and tasks…"
            role="combobox"
            aria-expanded
            aria-controls="category-listbox"
            aria-activedescendant={flat[cursor] ? optionId(flat[cursor]!.id) : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul role="listbox" id="category-listbox" className="picker-list">
            {result.favourites.length > 0 && (
              <>
                <li className="group-heading">Favourites</li>
                {result.favourites.map((pair) => row(pair, `${pair.projectName} — ${pair.taskName}`))}
              </>
            )}

            {result.recent.length > 0 && (
              <>
                <li className="group-heading">Recent</li>
                {result.recent.map((pair) => row(pair, `${pair.projectName} — ${pair.taskName}`))}
              </>
            )}

            {result.projects.length > 0 && <li className="group-heading">All projects</li>}
            {result.projects.map((group) => (
              <li key={group.projectId} className="project-group">
                <div className="project-heading">{group.projectName}</div>
                <ul>{group.pairs.map((pair) => row(pair, pair.taskName))}</ul>
              </li>
            ))}

            {result.isEmpty && <li className="empty">Nothing matches “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
