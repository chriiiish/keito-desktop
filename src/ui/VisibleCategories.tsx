import { useMemo, useState } from "react";
import type { Pair } from "../core/keito/types.js";
import { keito } from "./keito-api.js";
import type { Snapshot } from "../../electron/service.js";

interface VisibleCategoriesProps {
  snapshot: Snapshot;
  onChange: (next: Snapshot) => void;
}

/**
 * Which categories appear in the switcher's dropdown. Everything is shown by default;
 * this is for silencing the long tail of a big workspace.
 *
 * A category that is favourited or recently used is always shown regardless — switching
 * something off must never hide the thing you are actually working on. The toggle still
 * records the preference, so it takes effect once that stops being true.
 */
export function VisibleCategories({ snapshot, onChange }: VisibleCategoriesProps): JSX.Element {
  const [query, setQuery] = useState("");

  const hidden = useMemo(() => new Set(snapshot.hidden), [snapshot.hidden]);
  const forced = useMemo(
    () => new Map<string, "favourite" | "recent">([
      ...snapshot.recents.map((id) => [id, "recent" as const] as const),
      ...snapshot.favourites.map((id) => [id, "favourite" as const] as const),
    ]),
    [snapshot.favourites, snapshot.recents],
  );

  const groups = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (pair: Pair) => {
      const haystack = `${pair.projectName} ${pair.taskName}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    };

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

  const set = (pairIds: string[], visible: boolean) =>
    void keito.setHidden(pairIds, !visible).then(onChange);

  return (
    <section className="visibility">
      <input
        placeholder="Filter projects and tasks…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {groups.length === 0 && <p className="hint">Nothing matches “{query}”.</p>}

      {groups.map((group) => {
        const shownCount = group.pairs.filter((pair) => !hidden.has(pair.id)).length;
        const allShown = shownCount === group.pairs.length;

        return (
          <div key={group.projectId} className="visibility-project">
            <div className="visibility-row project">
              <span className="visibility-name">{group.name}</span>
              <span className="visibility-count">
                {shownCount}/{group.pairs.length} shown
              </span>
              <Toggle
                checked={allShown}
                label={`All tasks in ${group.name}`}
                onChange={(next) => set(group.pairs.map((pair) => pair.id), next)}
              />
            </div>

            {group.pairs.map((pair) => {
              const reason = forced.get(pair.id);
              return (
                <div key={pair.id} className="visibility-row task">
                  <span className="visibility-name">{pair.taskName}</span>
                  {reason && <span className="badge">always shown · {reason}</span>}
                  <Toggle
                    checked={!hidden.has(pair.id)}
                    label={`${group.name} ${pair.taskName}`}
                    onChange={(next) => set([pair.id], next)}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label className="switch">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="track" aria-hidden="true" />
    </label>
  );
}
