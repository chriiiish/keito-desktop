import { useEffect, useMemo, useRef, useState } from "react";
import type { Pair } from "../core/keito/types.js";
import { keito } from "./keito-api.js";
import { AsyncButton } from "./AsyncButton.js";
import { Toggle } from "./Toggle.js";
import type { Snapshot } from "../../electron/service.js";

interface ProjectsTabProps {
  snapshot: Snapshot;
  onChange: (next: Snapshot) => void;
}

/**
 * Which categories appear in the timer, and which are pinned to the top of it.
 * Everything is shown by default; this is for silencing the long tail of a big workspace.
 *
 * A category that is favourited or recently used is always shown regardless — switching
 * something off must never hide the thing you are actually working on. The toggle still
 * records the preference, so it takes effect once that stops being true.
 */
export function ProjectsTab({ snapshot, onChange }: ProjectsTabProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const hidden = useMemo(() => new Set(snapshot.hidden), [snapshot.hidden]);
  const favourites = useMemo(() => new Set(snapshot.favourites), [snapshot.favourites]);
  const recents = useMemo(() => new Set(snapshot.recents), [snapshot.recents]);

  const favouritePairs = useMemo(
    () =>
      snapshot.favourites
        .map((id) => snapshot.catalog.find((pair) => pair.id === id))
        .filter((pair): pair is Pair => pair !== undefined),
    [snapshot.favourites, snapshot.catalog],
  );

  const groups = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (pair: Pair) =>
      terms.every((term) => `${pair.projectName} ${pair.taskName}`.toLowerCase().includes(term));

    const byProject = new Map<string, { name: string; pairs: Pair[] }>();
    for (const pair of snapshot.catalog) {
      if (!matches(pair)) continue;
      const group = byProject.get(pair.projectId) ?? { name: pair.projectName, pairs: [] };
      group.pairs.push(pair);
      byProject.set(pair.projectId, group);
    }
    return [...byProject.entries()]
      .map(([projectId, group]) => ({ projectId, ...group }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshot.catalog, query]);

  const projectIds = useMemo(
    () => [...new Set(snapshot.catalog.map((pair) => pair.projectId))],
    [snapshot.catalog],
  );

  /**
   * Projects start collapsed, because a workspace with any size to it is a wall of tasks
   * you have already made your mind up about.
   *
   * The exception is a workspace where nothing is switched off yet: an empty `hidden` means
   * nobody has curated anything, so this is a first visit and the whole list is the point.
   * Seeded once, from the first catalog to arrive — re-running it would fight every later
   * toggle, and the catalog arrives after the first render.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || projectIds.length === 0) return;
    seeded.current = true;
    if (snapshot.hidden.length === 0) setExpanded(new Set(projectIds));
  }, [projectIds, snapshot.hidden.length]);

  // Filtering opens what it matches: a search that answered with collapsed headers would
  // look like it had found nothing.
  const filtering = query.trim() !== "";
  const isOpen = (projectId: string) => filtering || expanded.has(projectId);

  const allExpanded = projectIds.length > 0 && projectIds.every((id) => expanded.has(id));

  const toggleProject = (projectId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(projectId)) next.add(projectId);
      return next;
    });

  const setVisible = (pairIds: string[], visible: boolean) =>
    keito.setHidden(pairIds, !visible).then(onChange);

  const star = (pair: Pair) => (
    <AsyncButton
      className={`star${favourites.has(pair.id) ? " on" : ""}`}
      aria-label={`Favourite ${pair.projectName} ${pair.taskName}`}
      title={favourites.has(pair.id) ? "Remove from favourites" : "Add to favourites"}
      onClick={() => keito.toggleFavourite(pair.id).then(onChange)}
    >
      ★
    </AsyncButton>
  );

  return (
    <section className="settings">
      <h2>Favourites</h2>
      {favouritePairs.length === 0 ? (
        <p className="hint">Star a task below to pin it to the top of the timer.</p>
      ) : (
        <ul className="favourites">
          {favouritePairs.map((pair) => (
            <li key={pair.id}>
              <span className="visibility-name">
                {pair.projectName} — {pair.taskName}
              </span>
              {star(pair)}
            </li>
          ))}
        </ul>
      )}

      <h2>Projects in the timer</h2>
      <p className="hint">
        Everything is shown by default. Switch off what you never track against. Favourites
        and anything you have used in the last 30 days stay visible regardless.
      </p>

      <div className="visibility">
        <input
          placeholder="Filter projects and tasks…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        {groups.length === 0 && <p className="hint">Nothing matches “{query}”.</p>}

        {groups.length > 0 && (
          <div className="visibility-actions">
            <button
              type="button"
              className="link"
              disabled={filtering}
              title={filtering ? "Everything matching a filter is already open" : undefined}
              onClick={() => setExpanded(allExpanded ? new Set() : new Set(projectIds))}
            >
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          </div>
        )}

        {groups.map((group) => {
          const shownCount = group.pairs.filter((pair) => !hidden.has(pair.id)).length;
          const open = isOpen(group.projectId);

          return (
            <div key={group.projectId} className="visibility-project">
              <div className="visibility-row project">
                <button
                  type="button"
                  className="disclosure"
                  aria-expanded={open}
                  aria-controls={`tasks-${group.projectId}`}
                  // Inert while filtering, which forces every match open. Left live it
                  // would appear to do nothing — aria-expanded could not change either —
                  // while quietly rewriting what you find on clearing the filter.
                  disabled={filtering}
                  title={filtering ? "Matches stay open while a filter is active" : undefined}
                  onClick={() => toggleProject(group.projectId)}
                >
                  <span className="chevron" aria-hidden="true">
                    ▸
                  </span>
                  <span className="visibility-name">{group.name}</span>
                </button>
                <span className="visibility-count">
                  {shownCount}/{group.pairs.length} shown
                </span>
                <Toggle
                  checked={shownCount === group.pairs.length}
                  label={`All tasks in ${group.name}`}
                  onChange={(next) => setVisible(group.pairs.map((pair) => pair.id), next)}
                />
              </div>

              <div id={`tasks-${group.projectId}`} hidden={!open}>
              {group.pairs.map((pair) => (
                <div key={pair.id} className="visibility-row task">
                  <span className="visibility-name">{pair.taskName}</span>
                  {favourites.has(pair.id) && <span className="badge">Favourite</span>}
                  {!favourites.has(pair.id) && recents.has(pair.id) && (
                    <span className="badge">Recent</span>
                  )}
                  {star(pair)}
                  <Toggle
                    checked={!hidden.has(pair.id)}
                    label={`${group.name} ${pair.taskName}`}
                    onChange={(next) => setVisible([pair.id], next)}
                  />
                </div>
              ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
