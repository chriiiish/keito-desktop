<!--
Delete what does not apply. A one-line PR with an honest "how I checked" beats a
fully-ticked template nobody read.
-->

## What and why

<!-- What changes, and what made it worth changing. Link an issue if there is one. -->

## How I checked

<!--
`npm test` and `npm run typecheck` run in CI, so saying they pass adds nothing. Say what
CI *cannot* see: what you did in the running app, on which platform.
-->

- [ ] Ran it in the app (`npm run dev`), not only under test

## Worth a second look

<!-- Tick anything this PR touches. Each one is a place the suite will not catch a mistake. -->

- [ ] **`src/core/` stays Electron-free** — no `electron` import, no I/O it was not handed
- [ ] **Request budget** — startup is still 3 requests, a popover open still 1
- [ ] **New API behaviour** — covered by a contract test, not just by `test/fake-keito.ts`
      (the fake being wrong is the one failure the suite cannot report)
- [ ] **Both platforms** — checked on macOS *and* Windows, or does not touch tray, popover
      placement, menus or paths
- [ ] **Packaging** — if `build/` or the `build` block in `package.json` changed, a real
      `.dmg` was built and opened, not just produced
- [ ] **Calls the API from a new control** — goes through `AsyncButton` / `useAsyncAction`,
      so it cannot be double-fired
- [ ] **Secrets** — nothing that can reach the log carries an API key

## Anything you would do differently with more time

<!-- Known rough edges, deliberate shortcuts, follow-ups. Better written down than found. -->
