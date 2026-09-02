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

## Testing approach

Tests live only at these seams: `KeitoClient`, `TimerSwitcher`, `buildPicker`,
`rankRecents`, `IdleWatcher`/`shouldAutoStop`, `formatTrayLabel`, and `PreferencesStore`
round-tripping to a temp dir. The Electron main process, the tray and the hotkey are
deliberately **not** unit-tested — they're verified by running the app.

`src/ui/Popover.test.tsx` is the one component test (jsdom + Testing Library): the start
form holds real logic — which category is preselected, the order of the dropdown groups —
and it is the screen that cannot be checked by reading a Snapshot. Keep component testing
to that; the rest of the UI stays verify-by-running.

Tests drive the real `KeitoClient` through `FakeKeito`'s `fetch` rather than mocking the
client. Don't introduce mocks of internal collaborators; extend the fake instead, and add a
contract test when the behaviour being faked is one the real API decides.

`rankRecents` scores uses with a 7-day half-life over a 30-day window. Its tests assert
ordering against hand-computed values — don't replace them with assertions that recompute
the score the way the implementation does.

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

`Snapshot.revision` increments on every server-side change. Windows holding their own
derived data (the entries table) reload when it moves — without that they go stale until
remounted.

## Failure model

Keito is the source of truth for what's running; the elapsed clock is rendered locally from
the server's start time. A failed switch **keeps the previous timer running** and surfaces a
retry — it must never silently stop tracking work that's still happening. `KeitoAuthError`
is distinct: it moves the app to a `needs-auth` state that routes to settings.
