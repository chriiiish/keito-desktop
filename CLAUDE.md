# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev                  # Electron app with hot reload
npm test                     # unit + integration suite (in-memory fake, no network)
npm run test:watch           # same, watching
npm run typecheck            # tsc --noEmit across src/, electron/, test/
npm run build                # electron-vite build -> out/
npm run package              # ad-hoc signed .dmg + .exe into release/
```

Run a single test file or a single test:

```sh
npx vitest run src/core/timer/timer.test.ts
npx vitest run -t "stops the old timer and starts the new one"
```

Contract tests hit the **real** Keito API and are skipped unless a key is present:

```sh
KEITO_API_KEY=kto_xxx npm run test:contract
```

They create exactly one scratch time entry and delete it in `afterAll`. This is the only
thing that catches `test/fake-keito.ts` drifting from the real API — everything else in the
suite is checked against the fake, so the fake being wrong means the suite is wrong.

## Commits

**Conventional Commits**: `type(scope): subject`, imperative and lower case, no full stop.

```
feat(ui): clear all configuration from a Danger Zone
fix(build): ad-hoc sign the mac app so macOS will open it
ci: gate merges on a Trivy scan
docs: record the commit convention
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build` (packaging, deps,
electron-builder), `ci` (workflows), `chore`. Scope is the part of the layout it lands in —
`core`, `ui`, `electron`, or a narrower one like `timer` or `keito` — and is optional when
the change is repo-wide.

A breaking change takes `!` before the colon and a `BREAKING CHANGE:` footer saying what
callers must now do differently.

**The subject line is the smaller half.** This repository's commit bodies carry the
reasoning that would otherwise only exist in a pull request, and pull requests are where
context goes to die. Say what was actually wrong and what it cost, not what the diff
already shows: "the app carried nothing but the linker signature, which macOS reports as
damage" tells the next person something; "update signing config" does not. Where a fact
came from a real check — a live API response, a packaged build, a CI run — say so, because
that is what stops the next person re-deriving it.

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

The popover window is **hidden and shown, never recreated**, so the renderer does not
remount between openings. Anything that must happen on every open — putting the caret in
the note field — needs the `popover-shown` event from `main.ts`, not a mount effect.

`AppService` holds the client, timer and stores, and exposes a single `Snapshot` object
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
  entirely.
- **`spent_date` is the one date the client still decides**, and it is a *workspace-local*
  calendar date, not UTC's. `workspaceDate()` in `src/core/time/workspace-time.ts` is the
  only way to produce one — `new Date().toISOString().slice(0, 10)` is wrong for most of
  the world for part of every day (08:00 in Sydney is still yesterday in UTC; 18:00 in
  California is already tomorrow), and it files the work on the wrong day silently.
  `Timer`, `loadEntries` and the entries window all take the zone for this reason.
  The suite cannot catch a regression here on its own: the fake echoes whatever
  `spent_date` it is sent, so tests written in UTC pass either way. `rankRecents` takes
  today as a `YYYY-MM-DD` string rather than a `Date` so the comparison cannot drift.
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
  **It restarts the entry it is given, on that entry's `spent_date`** — so it is only ever
  right for *today's* rows. The popover's Yesterday list therefore does not use it: its
  play button copies the category and note onto a new entry via `switchTo`, dated today.
  Pointing both lists at the same call would quietly file today's work under yesterday.

## Testing approach

Tests live only at these seams: `KeitoClient`, `Timer`, `buildPicker`,
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
Losing the native keyboard behaviour means reimplementing it: an arrow on the closed
trigger opens the list one step from the current selection, the highlight is tracked with
`aria-activedescendant` on the filter input rather than by moving focus, Enter picks and
then hands focus to the note, and Escape closes and returns focus to the trigger.

**Every control that calls the API goes through `AsyncButton` / `useAsyncAction`** (or the
`Toggle` in `ProjectsTab`), which disables itself and shows a spinner until the call
settles. The re-entry guard is a **ref, not state**: two events in the same tick would both
read a stale `pending` and both fire. Adding a bare `<button onClick={() => keito.x()}>` is
a regression — it can be double-fired.

The window has five tabs: Time Entries, Projects (favourites + visibility), Keito
Connection, Settings (preferences only) and About (licence, tip jar, source links, build
version) — plus **Update Available**, which appears only when there is one. Without a
working key everything falls back to Keito Connection, except the update tab.

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
  `Timer.adopt()` takes it without touching the network. `refresh()` still does its
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

## Update notice

The app tells you when a newer release exists. It is a **notice, not an updater**, and the
distinction is a constraint rather than a preference.

**There is no auto-updater, and adding one is not a small change.** `electron-updater` is
not a dependency and the release workflow deliberately does not upload the `.blockmap` and
`latest*.yml` files that exist only to feed it — those are the only files it drops, and
every build regenerates them, so restoring them is a two-line change to the upload globs.
The blocker is not the library. Electron's own `autoUpdater` is backed by Squirrel, which
on macOS needs a `.zip` target (this builds `dmg` only) and validates a **Developer ID
signature** on the downloaded update — and `build/afterPack.cjs` ad-hoc signs, because
there is no certificate. `electron-updater` wraps Squirrel.Mac too, so it needs the same
things. On Windows the built-in updater needs Squirrel.Windows packaging, which `nsis` is
not. Auto-update therefore costs an Apple Developer ID and a change of Windows installer
format, whichever library does it. Until then the honest ceiling is a link to the download
page, and the tab says so in as many words so nobody waits for an install that is not
coming.

**`GET /releases/latest` answers 404 for this repo and always will**, because it excludes
drafts *and* pre-releases and every release here is published as a pre-release. The check
lists `/releases` and takes the newest **non-draft** — `pickLatestRelease` in
`src/core/version/version.ts`. Drafts are excluded because they are invisible to anyone
without write access, so offering one would point users at a 404. Pre-releases are kept
because they are the thing on the download page.

**Ordering is SemVer, not string comparison.** `"0.10.0" < "0.9.0"` lexically, so a naive
comparison would stop offering updates the moment a minor version reached double digits.
`compareVersions` implements SemVer precedence including pre-release identifiers, and
`/releases` is sorted by it rather than trusted in the order GitHub returns — that order is
by creation date, which stops matching version order the moment a patch is cut for an older
line. An unparseable tag is skipped rather than failing the check, so one `nightly` tag
cannot switch the feature off.

**Packaged builds only.** `app.getVersion()` in a dev run reports whatever `package.json`
says, and the release workflow stamps that from the tag *after* a release is cut — so a dev
build is legitimately behind whatever shipped and would show a notice on every `npm run
dev`. `startUpdateChecks` in `main.ts` returns early when `app.isPackaged` is false. To see
the notice while working on it, temporarily drop that guard and pass a lower version to
`AppService.create`; do not commit an environment-variable escape hatch for it.

**Checked at launch and once a day**, cached on the Snapshot. A popover open costs nothing
— it reads the answer that is already there. GitHub allows 60 unauthenticated requests an
hour per IP and this asks for one a day. A failed check is logged and shows nothing: an
unreachable GitHub is not an error the user can act on, and `fetchLatestRelease` never
throws.

**The notice is dismissible per version.** `Preferences.dismissedUpdate` holds a version
string rather than a flag, so waving away 0.3.0 silences that release and the notice
returns by itself for 0.4.0. Dismissal hides only the popover notice — the **Update
Available** tab stays, so a dismissed release is still findable. A Danger Zone reset clears
it with every other preference, which is correct: a fresh install has dismissed nothing.

**The tab exists only while an update does.** It is appended to `TABS` rather than living
in it, and `ReviewWindow` falls back to the entries tab if the update disappears while the
tab is open. Which tab is showing is sent as a `show-tab` **event**, not put on the
Snapshot — a Snapshot field would re-select the tab on every broadcast, so clicking away
from it would not stick. That is the exception to "new UI state belongs on `Snapshot`":
this is a navigation command, not state.

**The update tab is the one exception to "no key, connection form".** Every other tab
falls back to Keito Connection until a key works, because none of them can do anything
useful without one. This tab can: it is about the app, not the workspace, and needs no key,
no catalog and no network beyond the check that already happened. Without the exception the
tab would sit in the bar and visibly do nothing when clicked, and the release would be
hidden from the user most likely to want it — someone whose key has just stopped working.

**The release body is not shown as-is.** The workflow prepends a download table and
first-launch instructions to every release, and `generate_release_notes: true` appends
GitHub's list underneath — so only the `## What's Changed` section is a changelog.
`releaseHighlights` in `src/core/version/notes.ts` extracts it and strips the
` by @who in <url>` tail. The lines render as text, not Markdown: the body is content this
app did not write, and rendering arbitrary remote markup is a bigger commitment than a
notice warrants.

## Azure DevOps integration

Optional, off by default, and switched on in **Integrations**. It reads the open work items
assigned to whoever owns the token and offers them in the popover's note field, so a note
can be `1842: Login redirect drops the return URL` without typing it.

**These are properties of the Azure DevOps API, not choices.**

- **A bad token answers `203`, not `401`.** Azure DevOps replies to an expired,
  under-scoped or simply wrong PAT with **203 Non-Authoritative Information** and an HTML
  sign-in page. `response.ok` is *true* for a 203, so a naive client sails past it and then
  fails parsing HTML as JSON, a long way from the actual cause. `AzureClient` raises
  `AzureAuthError` on 203 alongside 401/403, and `test/fake-azure.ts` answers a bad token
  the same way so the suite actually covers it.
- **Listing work items is two requests, not one.** A WIQL query returns *ids only*; the
  titles need a second call to `/_apis/wit/workitems?ids=…`. That is why the list is cached
  rather than fetched whenever the popover opens.
- **The detail call does not preserve the order it was asked in.** WIQL decides "most
  recently changed first"; `workitems?ids=` makes no such promise, so the client re-imposes
  the id order rather than trusting what comes back.
- **`ids=` takes at most 200**, which is also the cap on the whole list. A dropdown longer
  than that is not one anybody scrolls.
- **`project` is optional.** `POST https://dev.azure.com/{org}/_apis/wit/wiql` searches the
  whole organisation, so the user nominates an organisation and never a project.
- **Ordering is most-recently-updated first, everywhere, and matching never changes it.**
  `searchWorkItems` filters; it does not rank. Ranking id matches above title-prefix matches
  above substring matches meant the list reshuffled with every keystroke — the same tickets
  in a different sequence depending on how far through the word you were. It sorts by
  `changedDate` itself rather than relying on `AzureClient` having sorted first, because a
  property that holds only because today's single caller happens to sort is not one worth
  having.
- **`System.ChangedDate` is fetched and sorted on**, rather than trusting WIQL's
  `ORDER BY` to survive the second call. An item with no readable date sorts *last* —
  `Date.parse(null)` is `NaN`, and a comparator that returns `NaN` leaves the order
  untouched instead of putting the undated item anywhere in particular.
- **The organisation cannot be read from the token alone without another scope.**
  Discovery is `profiles/me` then `/_apis/accounts?memberId=…` on **app.vssps.visualstudio.com**,
  a different host, and needs **User Profile (Read)** on top of Work Items (Read) *and* a token
  that is not scoped to a single organisation — which plenty of enterprises forbid. So
  discovery is attempted and its failure is not an error: it is the cue to ask for the URL.

  **The scope is not the whole story, and this cost a round trip to find out.** A token is
  created either for one organisation or for *All accessible organizations*, and only the
  second kind authenticates against `app.vssps.visualstudio.com` at all. A token scoped to
  one organisation is refused there **with User Profile (Read) granted**, while working
  perfectly against `dev.azure.com` for the work items it was made to read. So the failure
  message must not say the token was refused: it works, it just cannot answer this one
  question. `describeDiscovery` lives in `src/core/azure/discovery.ts` and is tested,
  because getting that wording wrong sends someone to regenerate a token that was never the
  problem.

  `discoverOrganisation` answers with **which of four things happened** — `found`,
  `several`, `none`, or `no-access` — rather than a URL or null. It returned null for all
  of them once, and the single message that produced ("could not work out your
  organisation") could not tell *you are in two organisations* from *that token cannot read
  your profile*, which made a real failure undiagnosable from the outside. `several` carries
  the names, because someone in two organisations needs to know which two. `publicAlias`
  leads `id` as the `memberId`, being what the accounts API documents; the fake returns
  different values for the two so reaching for the wrong one fails a test.

**A URL, not an organisation name.** `azureOrganisationUrl` holds
`https://dev.azure.com/acme` rather than `acme`, which costs nothing and is what lets an
on-premises Azure DevOps Server collection work at all.

**The token lives in its own `SecretStore`** (`azure.bin`), beside the Keito key and by the
same reasoning: `preferences.json` is plain text. The renderer never receives it —
`Snapshot.azure.hasToken` is a boolean, the way `apiKeyHint` is a mask.

**The work item list never touches disk.** It is somebody's internal project data, and a
list worth one refresh on launch is not worth leaving in a file. It lives on the Snapshot
and dies with the process.

**Refreshed every 10 minutes, and on popover open only if older than `AZURE_STALE_MS`.**
Opening the popover is the whole app; putting two Azure requests on that path
unconditionally would spend the frugality the request budget is about. A failed refresh
drops the list rather than keeping it — offering tickets from a connection that has stopped
working is worse than offering none — and is shown in Integrations, never over a running
timer.

**Enter is only taken over while the list is open.** `NoteField` renders exactly the input
it replaced when no work items are offered: no listbox, no key handling, Enter submits.
With items, ↓ opens, typing filters, Enter picks *instead of* submitting, and Escape closes
the list keeping what was typed. Anyone who never opens the list types and submits as
before, which is the point — the integration must not put a step in front of the app's only
loop.

**The note is the only carrier.** Keito has no custom fields, so nothing structured ties an
entry to a work item; `workItemNote` writes `1842: Title` and `noteWorkItemId` reads it back
out. Edit the note afterwards and the link is gone.

**The mark beside the note field is a plain infinity loop in Azure's blue, not Microsoft's
logo** — the same position taken over the Keito name. It is always shown next to the words
"Azure DevOps", never alone.

## Platform rules

Both macOS and Windows are supported targets, and the two differ in ways that fail
silently rather than loudly.

- **The tray icon is two assets, not one.** `trayTemplate.png` is a macOS *template*
  image — pure black plus alpha, which the OS inverts for a dark menu bar. Windows does no
  such thing, so the same file is an invisible black clock on a dark taskbar.
  `trayColour.png` is the indigo version Windows gets. Both must stay in the `build/tray*`
  glob in `package.json`, or the packaged app starts with no icon at all.
- **`tray.setTitle` is macOS-only.** The `formatTrayLabel` settings would be inert on
  Windows, so there the label leads the tooltip instead. A change to those settings must
  still be visible on both.
- **The popover opens on the side the icon is on**, decided from the icon's bounds, not
  from `process.platform`: a Windows taskbar is usually at the bottom but can be moved to
  any edge, and a second display may have neither.
- **Clicking the tray icon blurs the popover before delivering the click**, so a naive
  toggle reopens what the blur just hid. `REOPEN_GUARD_MS` in `main.ts` is what makes
  clicking the icon twice actually close it.
- **`Menu.setApplicationMenu(null)` only off darwin.** On Windows it removes a File/Edit/
  View menu bar this app has no use for; on macOS it would take Cmd-Q and Cmd-C with it.
- **One instance.** `requestSingleInstanceLock()` — a second launch would otherwise get its
  own tray icon and fight the first for the global shortcut and `preferences.json`.
- **Run at startup is the OS's state, not a preference.** `app.getLoginItemSettings()` is
  read on every start and after every change, and `Snapshot.openAtLogin` reports that
  rather than anything in `preferences.json`. The login item is editable outside the app —
  System Settings on macOS, Task Manager on Windows — so a stored copy would start lying
  the first time someone used either. `main.ts` owns the call, the way it owns
  `globalShortcut`, and pushes the result in with `setOpenAtLogin`, which is what keeps
  `service.ts` free of Electron. **Only available in a packaged build**: macOS names a
  login item after the bundle that registered it, and under `npm run dev` that bundle is
  `Electron.app` — the system notification reads *"Electron"* and the stray item outlives
  the dev session. There is no renaming it, since Electron's `path` and `name` overrides
  are Windows-only, so `Snapshot.canOpenAtLogin` is `app.isPackaged` and both the switch
  and the IPC handler refuse.
- **`PreferencesStore` serialises its writes.** Two overlapping saves race for the same
  `.tmp` file and the loser fails with `ENOENT`; starring in the popover while toggling in
  the settings window is enough to hit it.
- **An unsigned macOS build is a broken one, not merely an untrusted one.**
  electron-builder has no ad-hoc mode — `mac.identity: null` and
  `CSC_IDENTITY_AUTO_DISCOVERY=false` both skip signing altogether, leaving the `.app`
  with only the linker signature inside the stock Electron binary. That seals neither the
  Info.plist nor the resources, so macOS says *"Keito Timer is damaged and can't be
  opened"* — a dead end with no Open Anyway button, and it reads to users as a corrupt
  download rather than a missing certificate. `build/afterPack.cjs` ad-hoc signs the
  bundle and then **verifies** it, so the build fails instead of shipping another
  "damaged" dmg. Ad-hoc is not notarised: the first launch is still refused, but
  recoverably. Setting `CSC_LINK`/`CSC_NAME` stands the hook down.

## Releases

**The tag decides the version, and the release writes it back.** The workflow resolves
`vX.Y.Z` to `X.Y.Z` and stamps it with `npm pkg set version` after `npm ci`, so bumping
the file by hand is not part of cutting a release. It was the other way round once, and
v0.1.1 shipped three files named 0.1.0 — visible only on the download page, after the
fact. A step now fails the build if an artifact's name does not carry the released
version, because a glob upload will otherwise ship whatever it finds.

Once the release exists, `record-version` writes that version into `package.json` and
`package-lock.json` on `main`, so the repository stops disagreeing with what shipped.

That push needs a **deploy key**, not the workflow's own token: a ruleset's bypass list
only offers GitHub Apps installed on the repository, and `github-actions` is not one that
can be installed, so Actions itself can never be a bypass actor and no app id will do.
The `main` ruleset admits `DeployKey` instead, and the job checks out over SSH with
`secrets.RELEASE_DEPLOY_KEY`. If that key is missing from the secrets or from the bypass
list the job fails loudly rather than routing around it — the release is already
published by then, and a version silently left unrecorded is the thing this job exists to
prevent.

**The tag carries the `v`; the release title does not.** `tag_name` is `vX.Y.Z` — the `v`
is what makes the workflow's `v*` trigger match and what `git tag` lists — but `name` is
the bare `X.Y.Z`. The title is read as a version number, by people and by the update
notice, which renders it verbatim: *"0.3.0 is available"* reads as a version, *"v0.3.0 is
available"* reads as a tag nobody tidied. Releases cut before this was fixed are titled
`vX.Y.Z`, so `pickLatestRelease` still falls back to the tag when a release has no name at
all, and the tab shows whatever the title says.

**The download names are literals, not `${productName}`.** `artifactName` spells out
`Keito-Timer-…` because the product name contains a space and GitHub rewrites a space in a
release asset to a full stop. `${arch}` is only ever `arm64` or `x64`, so
`build/afterAllArtifactBuild.cjs` maps those to *Apple-Silicon* and *Intel-Mac* — in a
hook, so `npm run package` and CI produce the same names.

**The licence ships inside the app, not just in the repository.** GPL-3.0 section 4 wants
the licence conveyed *with* the binary, and a `.dmg` downloaded from a release page carries
nothing the repository says. `build.extraResources` puts `LICENSE` in the app's resources
directory — `Contents/Resources/LICENSE` on macOS, `resources/LICENSE` on Windows — rather
than in `build.files`, which would bury it inside `app.asar` where no recipient could
reasonably find it. Verified on a real `--dir` build: the copied file is byte-identical to
the repository's, and `codesign --verify --deep --strict` still passes, because
`extraResources` is copied during packaging and `build/afterPack.cjs` signs after that.
Adding files to `Contents/` *after* signing would break the seal and the app would report
as damaged.

**"Source code (zip)" cannot be removed.** GitHub attaches it and the tarball to every
release from the tag itself. They are not assets the workflow uploads, no API deletes
them, and there is no setting. The release notes therefore lead with the three installers,
linked by name, and say the archives are not needed.

**The Trivy gate covers what ships, not what builds.** Trivy skips `devDependencies` by
default, and the build toolchain carries HIGH/CRITICAL findings of its own that `npm audit`
will show. Add `include-dev-deps: true` to see them — and expect to have to upgrade
electron-builder before the gate is green again.

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

The global shortcut is captured by `HotkeyRecorder`, not typed: `toAccelerator` in
`src/core/keyboard/accelerator.ts` turns a real key press into an Electron accelerator, and
`formatAccelerator` renders it as `⌘⇧K` chips. Both are pure and tested — key naming is
where this goes wrong, and a bad accelerator fails silently at `globalShortcut.register`.
`Snapshot.hotkeyRegistered` reports whether the OS accepted it, so a combination another app
already owns says so instead of just not working.

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

`Snapshot.today` and `Snapshot.yesterday` both come free from the 30-day fetch
`loadEntries` already makes for ranking; only mutations pay for
`AppService.#reloadEntries()`, one extra request. Both are sliced by *workspace*
calendar date, so the Yesterday boundary moves with the workspace rather than sitting
24 hours behind a UTC clock.

**The popover's lists are grouped by (project, task, note), not by entry.** Keito has no
notion of "the same work continued": switching away and back is `POST /time_entries` with
`replace_running`, which creates a **new** entry every time, so an hour spent on one task
in three sittings is three entries. A running entry also reports `hours: null`, so while
the third sitting was going the popover showed only that sitting and the first two had
apparently never happened. `totalsByTaskAndNote` in `src/core/time/totals.ts` folds them
back together and `loggedBeforeRunning` feeds the header clock the same total, because a
header and a row disagreeing about one task — both ticking, both on screen — is its own
bug. A row's buttons act on `latest`, the newest entry in the group, so resuming continues
the most recent stretch rather than reopening the first of the day.

**Nothing may assume the order `GET /time_entries` returns.** The endpoint promises none,
and `FakeKeito` pushes as it creates — so entries arrive *oldest* first, which is the
opposite of what `EntriesSnapshot` documented for years. `loadEntries` now sorts today and
yesterday newest-first so that comment is true at the one place the lists are built, and
`totalsByTaskAndNote` sorts again rather than trusting its caller, since it is a pure
function anything may call. Reading the head of an unsorted list as "the most recent" is
what made `resume` restart the first stretch of the day. An entry whose start cannot be
read sorts last, where it cannot be mistaken for the newest.

**The entries table in the settings window is deliberately *not* grouped.** It is a
timesheet: its rows carry editable start and end times and a delete button, all of which
belong to one entry. Grouping there would offer to edit a start time that several entries
share.

`Snapshot.revision` increments on every server-side change. Windows holding their own
derived data (the entries table) reload when it moves — without that they go stale until
remounted.

## Failure model

Keito is the source of truth for what's running; the elapsed clock is rendered locally from
the server's start time. A failed switch **keeps the previous timer running** and surfaces a
retry — it must never silently stop tracking work that's still happening. `KeitoAuthError`
is distinct: it moves the app to a `needs-auth` state that routes to settings.
