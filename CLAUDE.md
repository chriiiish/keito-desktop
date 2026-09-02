# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev                  # Electron app with hot reload
npm test                     # unit + integration suite (in-memory fake, no network)
npm run test:watch           # same, watching
npm run typecheck            # tsc --noEmit across src/, electron/, test/
npm run build                # electron-vite build -> out/
npm run package              # unsigned .dmg + .exe into release/
```

Run a single test file or a single test:

```sh
npx vitest run src/core/timer/switcher.test.ts
npx vitest run -t "stops the old timer and starts the new one"
```

Contract tests hit the **real** Keito API and are skipped unless a key is present:

```sh
KEITO_API_KEY=kto_xxx npm run test:contract
```

They create exactly one scratch time entry and delete it in `afterAll`. This is the only
thing that catches `test/fake-keito.ts` drifting from the real API — everything else in the
suite is checked against the fake, so the fake being wrong means the suite is wrong.

## Architecture

An Electron tray app that creates and switches time entries in Keito. The load-bearing
structural rule:

**`src/core/` imports nothing from Electron and performs no I/O it isn't handed.** `fetch`,
the clock, and file paths are all constructor arguments. This is what lets the whole domain
run under Vitest in milliseconds with no window and no network. Adding an `electron` import
to `src/core/` breaks that, and the test suite won't tell you — it will just get slower and
then impossible.

```
electron/main.ts       tray, popover positioning, global hotkey, powerMonitor polling
electron/service.ts    AppService — the only orchestration layer; renders one Snapshot
electron/secrets.ts    API key via safeStorage (never in preferences.json)
src/core/              the tested domain (see below)
src/ui/                React; both windows load one bundle, the URL hash picks which
test/fake-keito.ts     in-memory Keito exposed as a `fetch`
```

`AppService` holds the client, switcher and stores, and exposes a single `Snapshot` object
that both windows render without further round trips. Every IPC handler returns a Snapshot;
`main.ts` broadcasts it to both windows automatically. New UI state belongs on `Snapshot`,
not in a new IPC channel.

The renderer imports `buildPicker` from `src/core/` directly, so filtering happens locally
per keystroke rather than over IPC.

## Domain vocabulary

Keito has **no category resource**. A time entry requires `project_id` **and** `task_id`, so
what the user calls a "category" is a **(project, task) pair**, identified as
`` `${projectId}:${taskId}` `` (`pairId()` in `src/core/catalog/catalog.ts`). Favourites and
recents are both lists of those ids.

## Non-obvious API constraints

These are properties of the Keito API, not choices — changing code that depends on them will
break against the real server even while the fake keeps passing.

**Several were verified against the live API only after the docs proved wrong.** Where this
file and `keito.ai/docs` disagree, this file won `test/fake-keito.ts` mirrors observed
behaviour, not documented behaviour. Treat any new doc-derived assumption as unverified
until a contract test covers it.

- **Auth is two headers**: `Authorization: Bearer kto_…` and `Keito-Account-Id`. There is no
  OAuth flow; both are entered by the user. **The company id cannot be auto-discovered** —
  verified against the live API, `/users/me` without the header answers
  `400 Missing Keito-Account-Id header`, so the endpoint you would read `company` from is
  itself gated on it. `KeitoAccountIdRequiredError` exists to name this precisely. A
  configured id wins over the server-reported `company.id` in `validateKey()`, since the
  header is what actually decides which workspace is acted on.
- **Personal sync keys are read-only** and omit `company`. They cannot create entries, so
  `validateKey()` rejects them with `KeitoReadOnlyError` at setup rather than letting the
  first switch fail.
- **Switching is one call**: `POST /time_entries` with `is_running: true` and
  `replace_running: true`. Without the flag a second timer returns `409`. `switchTo` sets it
  unconditionally — "switch" always means "make this the running timer", which is also
  race-free against a timer started on another device.
- **Timestamps are server-set on the hot path.** Creates omit `started_time`; stops go
  through `PATCH /:id/stop`. Keito exchanges `HH:mm` in *workspace* timezone, not ISO, so
  letting the server stamp both ends keeps timezone conversion out of the switching path
  entirely. `src/core/time/workspace-time.ts` exists only for manual edits in the window.
- **There is no `GET /time_entries/:id`** — it answers `405`. Nothing may depend on reading
  a single entry; `PATCH` and `DELETE` go straight at the id.
- **No ETags, no `If-Match`.** The docs describe both; the live API sends neither and
  requires neither. An earlier version built a whole ETag layer on that and it was fiction.
- **Single entries come back unwrapped**, not under a `time_entry` key, though the docs show
  the wrapper. `unwrapEntry()` accepts either. Getting this wrong yields `undefined` rather
  than a bad field, which then crashes somewhere far away.
- **Entries carry `timer_started_at`**, a real ISO instant. Prefer it over reconstructing a
  start from `spent_date` + `started_time`; that reconstruction is only a fallback.
- **`PATCH /time_entries/:id/restart` exists** (verified: it answers `409` with a
  `running_entry` body when a timer is already going, not `404`). Resuming a task uses it
  so time accumulates on the existing entry rather than creating a duplicate for the day.

## Testing approach

Tests live only at these seams: `KeitoClient`, `TimerSwitcher`, `buildPicker`,
`rankRecents`, `IdleWatcher`/`shouldAutoStop`, `formatTrayLabel`, and `PreferencesStore`
round-tripping to a temp dir. The Electron main process, the tray and the hotkey are
deliberately **not** unit-tested — they're verified by running the app.

`src/ui/Popover.test.tsx` and `src/ui/ReviewWindow.test.tsx` are the component tests (jsdom + Testing Library). The popover
holds real logic — which category is preselected, dropdown grouping and filtering,
favouriting from inside the list, resuming today's entries — and it is the screen that
cannot be checked by reading a Snapshot. Keep component testing to those two; the rest of
the UI stays verify-by-running.

The palette in `src/ui/styles.css` is taken from keito.ai: indigo-600 (`#4f46e5`) on slate
neutrals, amber for favourites. It is all tokens — `--rule` is the bold bar between
sections, `--line` the hairline within one, `--tint` the Today band. Never hard-code a
colour; add a token so light and dark stay in step.

`CategoryPicker` is a custom combobox rather than a `<select>` on purpose: native options
cannot hold a favourite button and cannot be type-filtered across project and task together.

**Every control that calls the API goes through `AsyncButton` / `useAsyncAction`** (or the
`Toggle` in `ProjectsTab`), which disables itself and shows a spinner until the call
settles. The re-entry guard is a **ref, not state**: two events in the same tick would both
read a stale `pending` and both fire. Adding a bare `<button onClick={() => keito.x()}>` is
a regression — it can be double-fired.

The window has four tabs: Time Entries, Projects (favourites + visibility), Keito
Connection, Settings (preferences only). Without a working key everything falls back to
Keito Connection.

The renderer never receives the API key. `Snapshot.apiKeyHint` is a masked stand-in
(`kto_••••••••abcd`); the connection form pre-fills it, and a value still equal to the hint
means "keep the existing key", routing the save to `setCompanyId` instead of `setApiKey`.

Tests drive the real `KeitoClient` through `FakeKeito`'s `fetch` rather than mocking the
client. Don't introduce mocks of internal collaborators; extend the fake instead, and add a
contract test when the behaviour being faked is one the real API decides.

`rankRecents` scores uses with a 7-day half-life over a 30-day window. Its tests assert
ordering against hand-computed values — don't replace them with assertions that recompute
the score the way the implementation does.

## Request budget

Startup is **3 requests**; a popover open is normally **1**. Keep it that way.

- **`GET /projects` embeds each project's `tasks`.** Never fetch `/tasks?project_id=` per
  project — that was 1 + N requests for data already in hand. `buildCatalog` reads
  `project.tasks` directly.
- **List responses include running entries.** There is no separate `?is_running=true`
  lookup; `loadEntries` picks the running entry out of the window it already fetched, and
  `TimerSwitcher.adopt()` takes it without touching the network. `refresh()` still does its
  own call for callers that have no entries to hand.
- **The catalog is cached for `CATALOG_TTL_MS`.** Projects and tasks change far more slowly
  than the popover is opened. A failed reload keeps the previous catalog rather than
  emptying it.
- **Every list endpoint is paged** via `#paged` at `PAGE_SIZE`. Without it a busy month is
  ranked from the first page alone — silently wrong rather than visibly broken.
- Entries embed `project` and `task` objects, so a timer running against an archived
  project still shows its real names instead of reading as "nothing running".

`GET /tasks` returns **503 "Task reference data is temporarily at capacity"** under load —
seen against the live workspace. The client retries 429/502/503/504 up to `MAX_ATTEMPTS`
with linear backoff. That retry now matters mainly for `/projects` and `/time_entries`.

## Diagnostics

`electron/logger.ts` appends to `app.getPath("logs")/keito-timer.log` (rotated at 512KB),
synchronously so a startup crash still leaves the line explaining it. `KeitoClient` takes an
`onRequest` hook — that is how the core stays Electron-free while every request still gets
logged with method, path, status and duration. **Nothing that reaches the log may carry the
API key**; `redact()` masks `kto_…` as a second line of defence and is tested.

Client errors carry `status` and `path`, and fold Keito's own response body into the
message. Don't go back to fixed strings like "Keito rejected this API key" — the body is
where the actual reason lives, and losing it makes every failure look identical.

`KeitoNetworkError` means the request never reached Keito; an HTTP error status is
`KeitoRequestError` or something more specific.

The tray label is `formatTrayLabel` in `src/core/tray/label.ts` — pure, so the menu bar
text is tested rather than eyeballed. The note leads by default because it is what says
what you are doing; project/task are a prefix and a blank-note fallback, and the fallback
is never prefixed with itself.

`buildPicker` returns favourites, the top `RECENT_SUGGESTIONS` recents, and every task
grouped under its project. "All projects" deliberately does **not** exclude what is already
shown above — it is the browse-by-project view, and a task missing from its own project
would be worse than a repeat.

Visibility is stored as **exclusions** (`Preferences.hidden`), never as an allow-list, so
categories added to the workspace later appear by default instead of being invisible until
someone notices. A hidden pair is still shown if it is a favourite or appears anywhere in
`recents` — the full 30-day ranking, not just the three suggestions. Switching something
off must never hide what you are actually working on; the preference is still recorded and
takes effect once that stops being true.

`Snapshot.today` comes free from the 30-day fetch `loadWorkspace` already makes for
ranking; only mutations pay for `#reloadToday()`, one extra request.

`Snapshot.revision` increments on every server-side change. Windows holding their own
derived data (the entries table) reload when it moves — without that they go stale until
remounted.

## Failure model

Keito is the source of truth for what's running; the elapsed clock is rendered locally from
the server's start time. A failed switch **keeps the previous timer running** and surfaces a
retry — it must never silently stop tracking work that's still happening. `KeitoAuthError`
is distinct: it moves the app to a `needs-auth` state that routes to settings.
