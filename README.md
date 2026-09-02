# Keito Timer

A small cross-platform desktop app for switching time entries in [Keito](https://keito.ai)
without leaving what you're doing. Press a global hotkey, type a few letters, hit Enter —
the running timer is replaced.

## What it does

- **Tray popover** with a global hotkey (default `Cmd/Ctrl+Shift+K`): pick a category from
  the filterable dropdown, type a note, press `⏎` (or the play button).
- **Today's entries** listed under the note, each resumable with one click — resuming
  continues the existing entry rather than logging a second one for the same task.
- **The running timer shows its note**, and the menu bar label is configurable — by default
  the note, falling back to the task when blank. You can fall back to the project instead,
  and optionally prefix the note with the project or the task.
- **Favourites first**, then your three most recent, then every project with its tasks
  beneath it. Filter by typing; star anything from inside the dropdown.
- **Switch off categories you never use** in Settings, per task or a whole project at once.
  Favourites and anything used in the last 30 days stay visible regardless.
- **One-call switching.** `POST /time_entries` with `replace_running: true` stops the old
  timer and starts the new one atomically — no window where nothing is being tracked.
- **Idle detection.** Away for 10+ minutes? On return it offers to trim the idle span.
  A timer running past 10 hours is stopped automatically.
- **Entries window** for correcting today's or this week's times and notes.

A "category" here is a **(project, task) pair** — Keito has no category resource, and a time
entry requires both ids.

## Setup

1. `npm install`
2. Get a **full-access integration key** from Keito (Settings → Integrations). A *personal
   read-only sync key* will not work: it cannot create time entries, and the app says so
   rather than failing later.
3. `npm run dev`, then paste the key into the settings window that opens.

**Company ID is required** alongside the key. Keito sends `Keito-Account-Id` on every
request — including `/users/me`, which answers `400 Missing Keito-Account-Id header`
without it — so it cannot be detected for you. Find it in your Keito account settings.
You can change it later from Settings without re-entering the key.

The key is encrypted at rest by the OS (Keychain on macOS, DPAPI on Windows) and never
written to `preferences.json`.

## Design notes

- **Keito is the source of truth.** Every switch is a network call; the elapsed clock is
  rendered locally from the server's start time. A failed switch leaves the previous timer
  running and offers a retry, rather than silently losing tracked time.
- **Recents come from the server** (`GET /time_entries` over 30 days, ranked by frequency
  with a 7-day half-life), so they're consistent with the web app and other machines.
  Favourites are local, since Keito has no API for them.
- **Timezones are dodged on the hot path.** Timers are created with `is_running: true` and
  no `started_time`, and stopped via `PATCH /:id/stop`, so the server stamps both times.
  The workspace-timezone setting only renders and parses manual edits.
- **`src/core/` imports nothing from Electron** and does no I/O it isn't handed. That's what
  keeps the test suite a fast in-process loop.
- **The fake mirrors the API as observed, not as documented.** Several documented
  behaviours — a single-entry GET, ETags, `If-Match`, a `time_entry` response wrapper —
  do not exist. `npm run test:contract` is what keeps the two in step.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm test` | Unit + integration suite against an in-memory fake Keito (no network) |
| `npm run test:contract` | Opt-in suite against the **real** API — needs `KEITO_API_KEY` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run package` | Unsigned `.dmg` and `.exe` into `release/` |

### Contract tests

```sh
KEITO_API_KEY=kto_xxx npm run test:contract
```

Creates exactly one scratch time entry and deletes it again. This is what catches
`test/fake-keito.ts` drifting from the real API.

## Troubleshooting

Every request is logged with its status, timing and Keito's own error message. API keys are
masked in the log.

- **macOS**: `~/Library/Logs/Keito Timer/keito-timer.log`
- **Windows**: `%APPDATA%\\Keito Timer\\logs\\keito-timer.log`

Settings → Diagnostics → **Open log file**, or the tray menu's **Open log…**, opens it
directly. Error banners in Settings carry an *Open log* link.

To check credentials outside the app:

```sh
curl -sS -i https://app.keito.ai/api/v2/users/me \
  -H "Authorization: Bearer kto_YOUR_KEY" \
  -H "Keito-Account-Id: YOUR_COMPANY_ID"
```

## Known limits

- Builds are **unsigned**: macOS needs right-click → Open the first time, Windows shows a
  SmartScreen warning.
- The catalog fetches tasks per project in parallel, which is fine for a personal workspace
  but would want a concurrency cap for one with hundreds of projects.
- Projects are read one page deep (`per_page=200`).
