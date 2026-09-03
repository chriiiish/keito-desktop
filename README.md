# Keito Timer

A small cross-platform desktop app for switching time entries in [Keito](https://keito.ai)
without leaving what you're doing. Press a global hotkey, type a note and hit enter. Boom -
you're recording your time.

It is not an official Keito product. It is built on Keito's public API.

---

## Install

### 1. Download

Grab the latest build from the
**[releases page](https://github.com/chriiiish/keito-desktop/releases/latest)**:

| Your machine | File |
|---|---|
| **macOS**, Apple Silicon (M1 and later) | [`Keito-Timer-<version>-Apple-Silicon.dmg`](https://github.com/chriiiish/keito-desktop/releases/latest) |
| **macOS**, Intel | [`Keito-Timer-<version>-Intel-Mac.dmg`](https://github.com/chriiiish/keito-desktop/releases/latest) |
| **Windows** | [`Keito-Timer-<version>-Windows.exe`](https://github.com/chriiiish/keito-desktop/releases/latest) |


### 2. Get past the first-launch warning

These builds are signed, but not with a paid certificate — so both operating systems
stop the first launch. **This is expected, and only happens once.**

<details>
  <summary>macOS</summary>
  
  Open the `.dmg` and drag Keito Timer to Applications. The first launch is
  refused with *"Apple could not verify…"*. Open **System Settings → Privacy & Security**,
  scroll down, and press **Open Anyway**.
  
  > Double-clicking again will not help, and neither will right-click → Open. The
  > Privacy & Security panel is the only route.
</details>
<details>
  <summary>Windows</summary>  
  
  Run the `.exe`. SmartScreen shows *"Windows protected your PC"*. Choose
  **More info → Run anyway**. The installer is per-user and lets you pick the directory.
</details>

### 3. Connect it to Keito

The app opens its settings window on first launch and asks for two things. **You will
need to get these from your Keito administrator.**

* **An API key.** In Keito: Settings → Integrations → create a **full-access integration
key**. It starts `kto_`.

* **A Company ID.** Also in your Keito account settings.

> [!IMPORTANT] 
> A *personal read-only sync key* will not work. It cannot create time entries, so the app
> rejects it at setup rather than letting your first switch fail.

You can change the Company ID later from Settings without re-entering the key.

Your key is encrypted at rest by the operating system — Keychain on macOS, DPAPI on
Windows.

### 4. Use it

The app lives in the **menu bar** (macOS) or the **system tray** (Windows), not the Dock or
taskbar. There is no main window; closing the settings window does not quit it.

Press **`⌘⇧K`** (macOS) or **`Ctrl+Shift+K`** (Windows) from anywhere, enter in a note or
just hit ENTER to start recording time.

### Something wrong?

Every request is logged with its status, timing and Keito's own error message. **API keys
are masked in the log**, so it is safe to attach to a bug report.

Open it from **Settings → Diagnostics → Open log file**, or the tray menu's **Open log…**.
Error banners in Settings carry an *Open log* link straight to it. On disk:

- **macOS**: `~/Library/Logs/Keito Timer/keito-timer.log`
- **Windows**: `%APPDATA%\Keito Timer\logs\keito-timer.log`

To check your key and Company ID outside the app entirely:

```sh
curl -sS -i https://app.keito.ai/api/v2/users/me \
  -H "Authorization: Bearer kto_YOUR_KEY" \
  -H "Keito-Account-Id: YOUR_COMPANY_ID"
```

---

If this made your life easier, consider buying me a coffee ❤️

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/chris.lloyd)

---

## What it does

- **Tray popover on a global hotkey** (default `⌘⇧K` / `Ctrl+Shift+K`, changed by pressing
  the new combination in Settings): pick a category from the filterable dropdown, type a
  note, press `⏎`.
- **Favourites first**, then your three most recent, then every project with its tasks
  beneath it. Filter by typing; star anything from inside the dropdown.
- **Today and yesterday listed.** Today's work resumes in one click;
  yesterday's copies the category and note onto a new entry dated today, so last night's
  timesheet is not reopened.
- **One row per task, totalled.** Coming back to something after lunch adds to it rather
  than starting a second row — the popover shows everything spent on that task and note
  today, including the stretch currently running.
- **One-call switching.** `POST /time_entries` with `replace_running: true` stops the old
  timer and starts the new one atomically — there is no window where nothing is tracked.
  A failed switch leaves the previous timer running and offers a retry.
- **The running task in your menu bar.** Configurable: the note by default, falling back to
  the task when blank, or the project instead — optionally prefixed with either.
- **Idle detection.** Away for 10+ minutes? On return it offers to trim the idle span. A
  timer left running past 10 hours is stopped automatically.
- **Switch off categories you never use**, per task or a whole project at once. Favourites
  and anything used in the last 30 days stay visible regardless.
- **Entries window** for correcting today's or this week's times and notes.
- **Tells you when a new version is out**, with a link to the download. It does not update
  itself — see [Known limits](#known-limits).

A "category" here is a **(project, task) pair**. Keito has no category resource, and a time
entry requires both ids.

### Known limits

- **Builds are ad-hoc signed, not notarised.** That is what the first-launch warning above
  is about. Notarising needs a paid Apple Developer ID.
- **There is no auto-updater.** The app notices a new release and links you to it; you
  install it yourself. Auto-updating on macOS requires a Developer ID signature whichever
  library does it, so this is a consequence of the point above rather than a separate
  decision. Your settings, favourites and key survive an install over the top.
- The 30-day entries window is paged at 200; a very heavy month costs an extra request or
  two to rank recents correctly.

---

## Developing locally

Node 22 and npm. macOS or Windows — the app is a tray app and needs a desktop session.

```sh
npm install
npm run dev        # the app, with hot reload
```

`npm run dev` runs against the same settings and key as an installed copy, so if you have
already set the app up you are connected. Otherwise paste a key into the window that opens.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm test` | Unit + integration suite against an in-memory fake Keito (no network) |
| `npm run test:watch` | The same, watching |
| `npm run test:contract` | Opt-in suite against the **real** API — needs `KEITO_API_KEY` |
| `npm run typecheck` | `tsc --noEmit` across `src/`, `electron/` and `test/` |
| `npm run build` | `electron-vite build` into `out/` |
| `npm run package` | Ad-hoc signed `.dmg` and `.exe` into `release/` |

Run one file or one test:

```sh
npx vitest run src/core/timer/switcher.test.ts
npx vitest run -t "stops the old timer and starts the new one"
```

### Contract tests

```sh
KEITO_API_KEY=kto_xxx npm run test:contract
```

Creates exactly one scratch time entry and deletes it again. Everything else in the suite
runs against `test/fake-keito.ts`, so **the fake being wrong means the suite is wrong** —
this is what catches it drifting from the real API.

### How it is put together

```
electron/main.ts     tray, popover positioning, global hotkey, idle polling
electron/service.ts  AppService — the only orchestration layer; renders one Snapshot
electron/secrets.ts  API key via safeStorage (never in preferences.json)
src/core/            the tested domain
src/ui/              React; both windows load one bundle, the URL hash picks which
test/fake-keito.ts   in-memory Keito exposed as a `fetch`
```

The load-bearing rule: **`src/core/` imports nothing from Electron and performs no I/O it
isn't handed.** `fetch`, the clock and file paths are all arguments. That is what lets the
whole domain run under Vitest in milliseconds with no window and no network. Adding an
`electron` import to `src/core/` breaks it, and the suite will not tell you — it will just
get slower and then impossible.

`AppService` exposes a single `Snapshot` that both windows render without further round
trips. Every IPC handler returns one. **New UI state belongs on `Snapshot`, not in a new IPC
channel.**

A few things that are properties of the API rather than choices, and will break against the
real server even while the fake keeps passing:

- **Startup costs 3 requests and a popover open normally 1.** `GET /projects` embeds each
  project's tasks and list responses include the running entry, so neither needs its own
  call; the catalog is then cached for 15 minutes.
- **Timezones are kept off the hot path.** Timers are created with `is_running: true` and no
  `started_time`, and stopped via `PATCH /:id/stop`, so the server stamps both ends. The one
  date the app still decides is `spent_date`, taken from the *workspace* calendar rather
  than UTC — otherwise a timer started at 8am in Sydney lands on yesterday, and one started
  at 6pm in California on tomorrow.
- **Recents come from the server** (`GET /time_entries` over 30 days, ranked by frequency
  with a 7-day half-life), so they match the web app and your other machines. Favourites are
  local — Keito has no API for them.
- **The fake mirrors the API as observed, not as documented.** Several documented behaviours
  — a single-entry `GET`, ETags, `If-Match`, a `time_entry` response wrapper — do not exist.

[`CLAUDE.md`](./CLAUDE.md) has the long version, including the ones that cost an afternoon
to rediscover.

### Platform notes

macOS and Windows are both supported, and they differ in ways that fail quietly:

| | macOS | Windows |
|---|---|---|
| Running task | Text beside the menu bar icon | Leads the tray tooltip |
| Tray icon | Template image, inverted by the OS | Indigo, legible on either taskbar theme |
| Popover | Below the menu bar | Above the taskbar, whichever edge it is on |
| Default shortcut | `⌘⇧K` | `Ctrl+Shift+K` |
| Key storage | Keychain | DPAPI |
| Installer | Ad-hoc signed `.dmg` | Ad-hoc signed NSIS `.exe`, per-user |

Only one copy runs at a time on either platform — launching it again brings the popover up
rather than adding a second tray icon.

---

## Contributing

Issues and pull requests are welcome: <https://github.com/chriiiish/keito-desktop>.

- **Found a bug?** [Open an issue](https://github.com/chriiiish/keito-desktop/issues) and
  attach the log. Settings → Diagnostics → **Open log file**; keys are masked in it. The
  **Contribute** tab shows the exact build version, which is worth quoting.
- **Want to fix something?** The domain logic lives in `src/core/` and runs under
  `npm test` in seconds with no window and no network, so a change is quick to make and
  quick to prove.
- **Commits follow [Conventional Commits](https://www.conventionalcommits.org/)** —
  `type(scope): subject`. The body matters more than the subject: say what was actually
  wrong and what it cost, not what the diff already shows.
- **Bug fixes come with a test that failed first.** Reproducing before fixing is the
  convention here, and pull requests say so.
- `npm test` and `npm run typecheck` must pass; CI also runs CodeQL and Trivy.

If the app has saved you the daily fight with a browser tab, the **Contribute** tab has a
tip jar. It is free and will stay that way either way.
