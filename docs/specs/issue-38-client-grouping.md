# Issue #38 — Show client on Projects tab

https://github.com/chriiiish/keito-desktop/issues/38

## Problem

The Projects tab (`src/ui/ProjectsTab.tsx`) lists projects flat, grouped only by
project → task. Keito projects can share a name across different clients, so
two unrelated projects render identically and are hard to tell apart.

## Decision

Add a third level to the visibility tree: **Client → Project → Task** (today
it is Project → Task). The client level is collapsible and carries the same
"toggle everything under it" control the project level already has.

`Pair.clientName` (`src/core/keito/types.ts`) already carries this — populated
by `buildCatalog` from `project.client?.name` when Keito returns it. No new
data, no new request.

## Behaviour

- **Grouping**: projects are grouped by `clientName`. A project with no client
  goes into a synthetic **"No client"** bucket rather than sitting ungrouped —
  the tree stays one consistent shape.
- **Sorting**: client groups sort alphabetically by name; **"No client" always
  sorts last**, regardless of where it would fall alphabetically — it reads as
  a fallback bucket, not a client literally named "No client".
- **Client toggle**: mirrors the existing project toggle, one level up — it
  sets visibility for every pair in every project under that client
  (`setVisible` over the flattened pair list), not per-project.
- **Client count**: reuses the existing `shownCount/total shown` label,
  totalled across the client's projects.
- **Default expand state**: identical rule to projects today — collapsed by
  default, expanded only on first visit (`snapshot.hidden.length === 0`,
  seeded once). Projects nested under a client keep their own existing
  per-project collapse state and first-visit seeding.
- **Filtering**: a client group is open whenever any of its projects match the
  filter, same "filtering forces matches open, disables the disclosure"
  behaviour projects already have.
- **Expand all / Collapse all**: now expands or collapses both levels
  together — every client and every project — in one action.
- **Favourites section**: unchanged. It stays a flat list at the top of the
  tab; this issue does not touch it.

## Out of scope

- No changes to how a category is picked or displayed in the popover/timer —
  this is the Settings → Projects tab only.
- No changes to `Pair`, `buildCatalog`, or the catalog cache — the client name
  is already there.
- No new IPC channel or Snapshot field — this is a pure rendering/grouping
  change over data already on `Snapshot.catalog`.
