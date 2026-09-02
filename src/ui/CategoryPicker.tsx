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
/**
 * Per-option DOM id, for aria-activedescendant. Keyed on the row's position rather than
 * its pair: "All projects" repeats what is pinned above it, so one pair can occupy two
 * rows, and an id derived from the pair would appear in the document twice.
 */
const optionId = (index: number) => `category-option-${index}`;

/** One rendered row, carrying the position the arrow keys count in. */
interface Row {
  pair: Pair;
  label: string;
  index: number;
}

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

  /**
   * Numbers the rows once, in render order, and hands each one its position.
   *
   * The old version derived a row's index with `flat.indexOf(pair)`. Because the repeats
   * under "All projects" are the *same* Pair object as the pinned one above, indexOf
   * always answered with the first copy: the repeat's own index belonged to no row, so
   * arrowing onto it highlighted nothing, and the index it claimed instead lit up the
   * pinned row somewhere else on screen.
   */
  const { flat, favouriteRows, recentRows, projectGroups } = useMemo(() => {
    const flat: Pair[] = [];
    const take = (pair: Pair, label: string): Row => {
      const row = { pair, label, index: flat.length };
      flat.push(pair);
      return row;
    };
    // Evaluated in the order they are rendered, which is what makes index === position.
    const favouriteRows = result.favourites.map((pair) =>
      take(pair, `${pair.projectName} — ${pair.taskName}`),
    );
    const recentRows = result.recent.map((pair) =>
      take(pair, `${pair.projectName} — ${pair.taskName}`),
    );
    const projectGroups = result.projects.map((group) => ({
      projectId: group.projectId,
      projectName: group.projectName,
      rows: group.pairs.map((pair) => take(pair, pair.taskName)),
    }));
    return { flat, favouriteRows, recentRows, projectGroups };
  }, [result]);

  const selected = catalog.find((pair) => pair.id === selectedId);

  useEffect(() => setCursor(0), [query]);

  /**
   * Keep the highlighted row visible when arrowing past the edge of the menu — but only
   * when a key moved it.
   *
   * Hovering also moves the highlight, and scrolling the list drags rows under a
   * stationary pointer, which fires mouseenter. Scrolling on that put the list back where
   * it wanted to be mid-gesture: the row moved out from under the pointer between press
   * and release, so the click either landed on a different task or on neither, leaving
   * the menu open.
   */
  const scrollToCursor = useRef(false);
  useEffect(() => {
    if (!scrollToCursor.current) return;
    scrollToCursor.current = false;
    // Optional call: jsdom, and some embedded runtimes, do not implement it.
    cursorRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [cursor, open]);

  /** Moves the highlight and follows it, for the keyboard paths only. */
  const moveCursor = (next: (current: number) => number) => {
    scrollToCursor.current = true;
    setCursor(next);
  };
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
    scrollToCursor.current = true;
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
      moveCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveCursor((c) => Math.max(c - 1, 0));
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

  const row = ({ pair, label, index }: Row) => {
    return (
      <li
        key={index}
        id={optionId(index)}
        ref={index === cursor ? cursorRef : undefined}
        role="option"
        aria-selected={pair.id === selectedId}
        className={`option${index === cursor ? " cursor" : ""}`}
        // Deliberately not moveCursor: hovering must never scroll the list, or the row
        // moves out from under the pointer that is trying to click it.
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
            aria-activedescendant={flat[cursor] ? optionId(cursor) : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul role="listbox" id="category-listbox" className="picker-list">
            {favouriteRows.length > 0 && (
              <>
                <li className="group-heading">Favourites</li>
                {favouriteRows.map(row)}
              </>
            )}

            {recentRows.length > 0 && (
              <>
                <li className="group-heading">Recent</li>
                {recentRows.map(row)}
              </>
            )}

            {projectGroups.length > 0 && <li className="group-heading">All projects</li>}
            {projectGroups.map((group) => (
              <li key={group.projectId} className="project-group">
                <div className="project-heading">{group.projectName}</div>
                <ul>{group.rows.map(row)}</ul>
              </li>
            ))}

            {result.isEmpty && <li className="empty">Nothing matches “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
