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

- **Auth is two headers**: `Authorization: Bearer kto_…` and `Keito-Account-Id`. There is no
  OAuth flow; the key is pasted. `GET /users/me` returns `company` for full-access keys, and
  that's how the account id is discovered when the user doesn't supply one. Because the
  header is documented as required on *every* request, discovery can't be relied on — hence
  the optional Company ID field. A configured id wins over the server-reported `company.id`
  in `validateKey()`, since the header is what actually decides which workspace is acted on.
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
- **Mutations require `If-Match`** with an ETag from a read. `TimerSwitcher` caches the ETag
  from the create; a timer adopted via `refresh()` has none, so `stop()` re-reads to get one.

## Testing approach

Tests live only at these seams, agreed up front: `KeitoClient`, `TimerSwitcher`,
`buildPicker`, `rankRecents`, `IdleWatcher`/`shouldAutoStop`, and `PreferencesStore`
round-tripping to a temp dir. React components, the Electron main process, the tray and the
hotkey are deliberately **not** unit-tested — they're verified by running the app.

Tests drive the real `KeitoClient` through `FakeKeito`'s `fetch` rather than mocking the
client. Don't introduce mocks of internal collaborators; extend the fake instead, and add a
contract test when the behaviour being faked is one the real API decides.

`rankRecents` scores uses with a 7-day half-life over a 30-day window. Its tests assert
ordering against hand-computed values — don't replace them with assertions that recompute
the score the way the implementation does.

## Failure model

Keito is the source of truth for what's running; the elapsed clock is rendered locally from
the server's start time. A failed switch **keeps the previous timer running** and surfaces a
retry — it must never silently stop tracking work that's still happening. `KeitoAuthError`
is distinct: it moves the app to a `needs-auth` state that routes to settings.
