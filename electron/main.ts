import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  shell,
  Tray,
} from "electron";
import { join } from "node:path";
import { PreferencesStore } from "../src/core/store/preferences.js";
import { IdleWatcher, shouldAutoStop } from "../src/core/timer/idle.js";
import { formatTrayLabel } from "../src/core/tray/label.js";
import { AppService, type Snapshot } from "./service.js";
import { SecretStore } from "./secrets.js";
import { Logger } from "./logger.js";
import { fetchLatestRelease, UPDATE_CHECK_INTERVAL_MS } from "./updates.js";

const POPOVER_SIZE = { width: 420, height: 520 };

/** The only hosts the Contribute tab may send you to. */
const EXTERNAL_HOSTS = new Set(["github.com", "buymeacoffee.com", "www.buymeacoffee.com"]);
const IDLE_POLL_MS = 30_000;
const REFRESH_MS = 5 * 60_000;

let tray: Tray | null = null;
let popover: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let service: AppService;
let registeredHotkey: string | null = null;
let log: Logger;
/** False until `service` exists, so a second launch cannot race startup. */
let started = false;

const rendererUrl = process.env["ELECTRON_RENDERER_URL"];

function loadRenderer(window: BrowserWindow, route: string): void {
  if (rendererUrl) {
    void window.loadURL(`${rendererUrl}#${route}`);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"), { hash: route });
  }
}

function broadcast(snapshot: Snapshot): void {
  for (const window of [popover, mainWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("snapshot", snapshot);
  }
  updateTrayTitle(snapshot);
}

/**
 * macOS shows the running task as text beside the menu bar icon. Windows has no such
 * thing — `setTitle` is a no-op there — so the configured label leads the tooltip
 * instead, which is the only place a Windows user can read it.
 */
function updateTrayTitle(snapshot: Snapshot): void {
  if (!tray) return;
  if (snapshot.timer.status === "running") {
    const { pair, note } = snapshot.timer;
    const label = formatTrayLabel(
      { note, projectName: pair.projectName, taskName: pair.taskName },
      { fallback: snapshot.trayFallback, prefix: snapshot.trayPrefix },
    );
    // The tooltip has room for the full context the short label had to drop.
    const context = [`${pair.projectName} — ${pair.taskName}`, note?.trim()]
      .filter(Boolean)
      .join("\n");
    tray.setToolTip(process.platform === "darwin" ? context : `${label}\n${context}`);
    if (process.platform === "darwin") tray.setTitle(` ${label}`);
  } else {
    tray.setToolTip("Keito Timer — nothing running");
    if (process.platform === "darwin") tray.setTitle("");
  }
}

function createPopover(): BrowserWindow {
  const window = new BrowserWindow({
    ...POPOVER_SIZE,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: join(__dirname, "../preload/index.cjs"), sandbox: false },
  });

  // Dismiss on click-away, the way a menubar popover behaves.
  window.on("blur", () => {
    if (!window.webContents.isDevToolsOpened()) window.hide();
  });
  window.on("hide", () => {
    hiddenAtMs = Date.now();
  });
  loadRenderer(window, "/popover");
  return window;
}

/**
 * Positions the popover against the tray icon, kept inside the display's work area.
 *
 * Which side it opens on is decided by where the icon actually is, not by platform: a
 * macOS menu bar is at the top, a Windows taskbar is usually at the bottom but can be
 * moved to any edge, and a second display may have neither.
 */
function showPopover(): void {
  if (!popover || popover.isDestroyed()) popover = createPopover();

  const trayBounds = tray?.getBounds();
  const cursor = screen.getCursorScreenPoint();
  // The icon's own display, not the cursor's: the hotkey can fire with the pointer
  // anywhere, and the popover belongs beside the icon.
  const anchor = trayBounds?.width
    ? { x: trayBounds.x + trayBounds.width / 2, y: trayBounds.y, height: trayBounds.height }
    : { x: cursor.x, y: cursor.y, height: 0 };
  const area = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) })
    .workArea;

  let x = Math.round(anchor.x - POPOVER_SIZE.width / 2);
  // Below the icon when it sits in the top half of the screen, above it otherwise —
  // which is what puts the popover over a bottom Windows taskbar rather than under it.
  const below = anchor.y + anchor.height / 2 < area.y + area.height / 2;
  let y = Math.round(below ? anchor.y + anchor.height + 4 : anchor.y - POPOVER_SIZE.height - 4);

  x = Math.min(Math.max(x, area.x + 8), area.x + area.width - POPOVER_SIZE.width - 8);
  y = Math.min(Math.max(y, area.y + 8), area.y + area.height - POPOVER_SIZE.height - 8);

  popover.setPosition(x, y, false);
  popover.show();
  popover.focus();
  // The popover is hidden and shown rather than recreated, so the renderer never
  // remounts. Tell it each time it appears so it can put the caret in the note field.
  popover.webContents.focus();
  popover.webContents.send("popover-shown");
  void service.refresh().then(broadcast);
}

/**
 * Clicking the tray icon blurs the popover, which hides it, and only *then* delivers the
 * click — so by the time we get here it is already invisible and a naive toggle would
 * reopen it. Treat a click landing right after a hide as the second half of that dismissal.
 */
const REOPEN_GUARD_MS = 300;
let hiddenAtMs = 0;

function togglePopover(): void {
  if (popover && !popover.isDestroyed() && popover.isVisible()) {
    popover.hide();
    return;
  }
  if (Date.now() - hiddenAtMs < REOPEN_GUARD_MS) return;
  showPopover();
}

/**
 * Opens the settings window, optionally on a particular tab.
 *
 * The tab is sent as an event rather than put on the Snapshot: which tab is showing is the
 * window's own business, and a Snapshot field would keep re-selecting it on every
 * broadcast — clicking away from the tab would not stick. A freshly created window has to
 * wait for its renderer, since nothing is listening until the page has loaded.
 */
function openMainWindow(tab?: string): void {
  const selectTab = (window: BrowserWindow): void => {
    if (!tab) return;
    if (window.webContents.isLoading()) {
      window.webContents.once("did-finish-load", () => window.webContents.send("show-tab", tab));
    } else {
      window.webContents.send("show-tab", tab);
    }
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    selectTab(mainWindow);
    return;
  }
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 640,
    title: "Keito Timer",
    webPreferences: { preload: join(__dirname, "../preload/index.cjs"), sandbox: false },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  loadRenderer(mainWindow, "/window");
  selectTab(mainWindow);
}

/**
 * macOS inverts a *template* image (pure black plus alpha) to suit the menu bar, so one
 * black asset covers light and dark. Windows does no such thing — that same asset is
 * invisible on a dark taskbar — so it gets the indigo version instead.
 */
function trayIcon(): Electron.NativeImage {
  const file = process.platform === "darwin" ? "trayTemplate.png" : "trayColour.png";
  const icon = nativeImage.createFromPath(join(__dirname, "../../build", file));
  if (process.platform === "darwin") icon.setTemplateImage(true);
  return icon;
}

function createTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip("Keito Timer");

  tray.on("click", togglePopover);
  tray.on("right-click", () => {
    tray!.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: "Switch task…", click: showPopover },
        { label: "Stop timer", click: () => void service.stopTimer().then(broadcast) },
        { type: "separator" },
        { label: "Entries & settings…", click: () => openMainWindow() },
        { label: "Open log…", click: () => void shell.openPath(service.logPath) },
        { type: "separator" },
        { label: "Quit Keito Timer", role: "quit" },
      ]),
    );
  });
}

/** Returns whether the OS accepted it — another app may already hold the combination. */
function registerHotkey(hotkey: string): boolean {
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
  registeredHotkey = null;
  try {
    if (globalShortcut.register(hotkey, togglePopover)) registeredHotkey = hotkey;
  } catch {
    // An unavailable accelerator must not stop the app from starting.
  }
  return registeredHotkey !== null;
}

/**
 * What the OS says, not what we last asked for. The login item is editable outside the
 * app — System Settings on macOS, Task Manager on Windows — so preferences.json would
 * drift from reality within a fortnight of anyone noticing it exists.
 *
 * In a development run this would report the login item for the Electron binary that
 * `npm run dev` launches, which is why changing it is refused there.
 */
function readOpenAtLogin(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (error) {
    // Nothing here is worth failing startup over; the switch simply reads as off.
    log.warn(`Could not read the login item: ${String(error)}`);
    return false;
  }
}

function registerIpc(): void {
  const handle = (channel: string, fn: (...args: any[]) => Promise<unknown>) =>
    ipcMain.handle(channel, async (_event, ...args) => {
      const result = await fn(...args);
      if (result && typeof result === "object" && "keyStatus" in result) broadcast(result as Snapshot);
      return result;
    });

  handle("snapshot", async () => service.snapshot());
  handle("set-api-key", async (key: string, accountId?: string) => service.setApiKey(key, accountId));
  handle("set-company-id", async (accountId: string) => service.setCompanyId(accountId));
  handle("sign-out", async () => service.signOut());
  handle("refresh", async () => service.refresh());
  handle("switch-to", async (pairId: string, notes?: string) => service.switchTo(pairId, notes));
  handle("stop-timer", async () => service.stopTimer());
  handle("resume-entry", async (entryId: string) => service.resumeEntry(entryId));
  handle("toggle-favourite", async (pairId: string) => service.toggleFavourite(pairId));
  handle("set-hidden", async (pairIds: string[], hidden: boolean) => service.setHidden(pairIds, hidden));
  handle("list-entries", async (from: string, to: string) => service.listEntries(from, to));
  handle("update-entry", async (id: string, patch: { notes?: string; startedTime?: string; endedTime?: string }) =>
    service.updateEntry(id, patch),
  );
  handle("delete-entry", async (id: string) => service.deleteEntry(id));
  handle("resolve-idle", async (keep: boolean, awaySinceMs: number) =>
    keep ? service.snapshot() : service.discardIdleSince(new Date(awaySinceMs)),
  );

  handle("dismiss-update", async () => service.dismissUpdate());

  handle("set-tray-label", async (options: Parameters<AppService["setTrayLabel"]>[0]) =>
    service.setTrayLabel(options),
  );

  handle("set-hotkey", async (hotkey: string) => {
    await service.setHotkey(hotkey);
    service.setHotkeyRegistered(registerHotkey(hotkey));
    return service.snapshot();
  });

  // The reset puts the hotkey back to its default, and only this process can tell the OS.
  // Without the re-register the old accelerator would keep working until a restart.
  handle("reset-all", async () => {
    const reset = await service.resetAll();
    service.setHotkeyRegistered(registerHotkey(reset.hotkey));
    // The login item is this app's doing too, and lives outside preferences.json — a
    // "fresh install" that still launched itself at login would not be one.
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: false });
    service.setOpenAtLogin(readOpenAtLogin(), app.isPackaged);
    return service.snapshot();
  });

  // Set it, then read back what the OS actually did rather than assuming it agreed. A
  // login item can be refused or removed by policy, and reporting the request instead of
  // the result would leave the switch claiming something untrue.
  handle("set-open-at-login", async (openAtLogin: boolean) => {
    // Refused outright in development: the item would be registered against Electron.app,
    // which is both useless and hard to find again once the dev session ends. The switch
    // is disabled there too; this is the half that cannot be clicked around.
    if (!app.isPackaged) {
      log.warn("Refusing to change the login item in a development run");
      return service.snapshot();
    }
    app.setLoginItemSettings({ openAtLogin });
    service.setOpenAtLogin(readOpenAtLogin(), app.isPackaged);
    return service.snapshot();
  });

  // Only ever opens the project's own pages. A renderer must not be able to hand the OS
  // an arbitrary URL, or a file:// one.
  handle("open-external", async (url: string) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      log.warn(`Refused to open a malformed URL: ${url}`);
      return undefined;
    }
    if (target.protocol !== "https:" || !EXTERNAL_HOSTS.has(target.hostname)) {
      log.warn(`Refused to open an external URL: ${url}`);
      return undefined;
    }
    await shell.openExternal(target.toString());
    return undefined;
  });

  handle("open-log", async () => {
    await shell.openPath(service.logPath);
    return undefined;
  });
  handle("log-path", async () => service.logPath);

  handle("close-popover", async () => {
    popover?.hide();
    return undefined;
  });
  handle("open-window", async (tab?: string) => {
    popover?.hide();
    openMainWindow(tab);
    return undefined;
  });
}

/** Watches for a return from idle and for timers left running far too long. */
function startMonitors(): void {
  const watcher = new IdleWatcher();

  setInterval(() => {
    const snapshot = service.snapshot();
    if (snapshot.timer.status !== "running") return;

    const event = watcher.observe(powerMonitor.getSystemIdleTime(), new Date());
    if (event) {
      showPopover();
      popover?.webContents.send("idle-return", {
        awaySinceMs: event.awaySince.getTime(),
        awaySeconds: event.awaySeconds,
      });
    }

    if (shouldAutoStop(new Date(snapshot.timer.startedAtMs), new Date())) {
      void service.stopTimer().then(broadcast);
    }
  }, IDLE_POLL_MS);

  setInterval(() => void service.refresh().then(broadcast), REFRESH_MS);
}

/**
 * Asks GitHub for the newest release at startup and once a day after it.
 *
 * **Packaged builds only.** `app.getVersion()` in a development run reports whatever
 * package.json holds, and the release workflow stamps that from the tag *after* a release
 * is cut — so a dev build is legitimately behind whatever has shipped, and would show a
 * notice on every `npm run dev`, pointing at an update that is not one.
 *
 * Daily rather than on every popover open: the popover reads the answer off the Snapshot,
 * so opening it costs nothing, and CLAUDE.md's request budget is about a frugal app rather
 * than only about Keito's own endpoints.
 */
function startUpdateChecks(): void {
  if (!app.isPackaged) {
    log.info("Update check skipped: not a packaged build");
    return;
  }

  const check = async (): Promise<void> => {
    service.setLatestRelease(await fetchLatestRelease(log));
    broadcast(service.snapshot());
  };

  void check();
  setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
}

// One tray icon, one set of global shortcuts, one writer of preferences.json. Without
// this a second launch — easy on Windows, where the installer offers to run the app and
// the Start menu entry stays clickable — gets its own tray icon and fights the first for
// the hotkey.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // The user asked for the app that is already running. Show them it is there — but
    // not before the first instance has finished starting up.
    if (started) showPopover();
  });
  void start();
}

async function start(): Promise<void> {
  await app.whenReady();

  // A menubar app has no dock presence on macOS.
  if (process.platform === "darwin") app.dock?.hide();

  // Windows and Linux would otherwise give the entries window a File/Edit/View menu bar
  // this app has no use for, including Reload and Toggle DevTools. On macOS the menu is
  // the application menu — removing it would take Cmd-Q, Cmd-C and Cmd-V with it.
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);

  log = new Logger(join(app.getPath("logs"), "keito-timer.log"));
  log.info("App ready", { version: app.getVersion(), platform: process.platform });

  // Anything that escapes a handler belongs in the log, not a silent void.
  process.on("uncaughtException", (error) => log.error(`Uncaught: ${error.stack ?? error.message}`));
  process.on("unhandledRejection", (reason) => log.error(`Unhandled rejection: ${String(reason)}`));

  const prefs = await PreferencesStore.open(join(app.getPath("userData"), "preferences.json"));
  const secrets = new SecretStore(join(app.getPath("userData"), "credentials.bin"));
  service = await AppService.create(prefs, secrets, log, app.getVersion());

  createTray();
  registerIpc();
  service.setHotkeyRegistered(registerHotkey(prefs.get().hotkey));
  service.setOpenAtLogin(readOpenAtLogin(), app.isPackaged);
  startMonitors();
  startUpdateChecks();

  started = true;

  updateTrayTitle(service.snapshot());
  // Nothing configured yet: open settings so the first run explains itself.
  if (service.snapshot().keyStatus !== "ready") openMainWindow();
}

// A tray app stays alive with no windows open.
app.on("window-all-closed", () => {});
app.on("will-quit", () => globalShortcut.unregisterAll());
