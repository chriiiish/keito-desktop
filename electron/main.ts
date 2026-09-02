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
import { AppService, type Snapshot } from "./service.js";
import { SecretStore } from "./secrets.js";

const POPOVER_SIZE = { width: 420, height: 520 };
const IDLE_POLL_MS = 30_000;
const REFRESH_MS = 5 * 60_000;

let tray: Tray | null = null;
let popover: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let service: AppService;
let registeredHotkey: string | null = null;

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

/** macOS shows the running task next to the tray icon; elsewhere it lands in the tooltip. */
function updateTrayTitle(snapshot: Snapshot): void {
  if (!tray) return;
  if (snapshot.timer.status === "running") {
    const { pair } = snapshot.timer;
    tray.setToolTip(`${pair.projectName} — ${pair.taskName}`);
    if (process.platform === "darwin") tray.setTitle(` ${pair.taskName}`);
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
  loadRenderer(window, "/popover");
  return window;
}

/** Positions the popover under the tray icon, kept inside the display's work area. */
function showPopover(): void {
  if (!popover || popover.isDestroyed()) popover = createPopover();

  const trayBounds = tray?.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const area = display.workArea;

  let x = Math.round((trayBounds?.x ?? cursor.x) + (trayBounds?.width ?? 0) / 2 - POPOVER_SIZE.width / 2);
  let y = Math.round((trayBounds?.y ?? area.y) + (trayBounds?.height ?? 0) + 4);

  x = Math.min(Math.max(x, area.x + 8), area.x + area.width - POPOVER_SIZE.width - 8);
  if (y + POPOVER_SIZE.height > area.y + area.height) y = area.y + area.height - POPOVER_SIZE.height - 8;

  popover.setPosition(x, y, false);
  popover.show();
  popover.focus();
  void service.refresh().then(broadcast);
}

function togglePopover(): void {
  if (popover && !popover.isDestroyed() && popover.isVisible()) popover.hide();
  else showPopover();
}

function openMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
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
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, "../../build/trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Keito Timer");

  tray.on("click", togglePopover);
  tray.on("right-click", () => {
    tray!.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: "Switch task…", click: showPopover },
        { label: "Stop timer", click: () => void service.stopTimer().then(broadcast) },
        { type: "separator" },
        { label: "Entries & settings…", click: openMainWindow },
        { type: "separator" },
        { label: "Quit Keito Timer", role: "quit" },
      ]),
    );
  });
}

function registerHotkey(hotkey: string): void {
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
  try {
    if (globalShortcut.register(hotkey, togglePopover)) registeredHotkey = hotkey;
  } catch {
    // An unavailable accelerator must not stop the app from starting.
    registeredHotkey = null;
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
  handle("set-api-key", async (key: string) => service.setApiKey(key));
  handle("sign-out", async () => service.signOut());
  handle("refresh", async () => service.refresh());
  handle("switch-to", async (pairId: string, notes?: string) => service.switchTo(pairId, notes));
  handle("stop-timer", async () => service.stopTimer());
  handle("toggle-favourite", async (pairId: string) => service.toggleFavourite(pairId));
  handle("list-entries", async (from: string, to: string) => service.listEntries(from, to));
  handle("update-entry", async (id: string, patch: { notes?: string; startedTime?: string; endedTime?: string }) =>
    service.updateEntry(id, patch),
  );
  handle("delete-entry", async (id: string) => service.deleteEntry(id));
  handle("resolve-idle", async (keep: boolean, awaySinceMs: number) =>
    keep ? service.snapshot() : service.discardIdleSince(new Date(awaySinceMs)),
  );

  handle("set-hotkey", async (hotkey: string) => {
    const snapshot = await service.setHotkey(hotkey);
    registerHotkey(hotkey);
    return snapshot;
  });

  handle("close-popover", async () => {
    popover?.hide();
    return undefined;
  });
  handle("open-window", async () => {
    popover?.hide();
    openMainWindow();
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

app.whenReady().then(async () => {
  // A menubar app has no dock presence on macOS.
  if (process.platform === "darwin") app.dock?.hide();

  const prefs = await PreferencesStore.open(join(app.getPath("userData"), "preferences.json"));
  const secrets = new SecretStore(join(app.getPath("userData"), "credentials.bin"));
  service = await AppService.create(prefs, secrets);

  createTray();
  registerIpc();
  registerHotkey(prefs.get().hotkey);
  startMonitors();

  updateTrayTitle(service.snapshot());
  // Nothing configured yet: open settings so the first run explains itself.
  if (service.snapshot().keyStatus !== "ready") openMainWindow();
});

// A tray app stays alive with no windows open.
app.on("window-all-closed", () => {});
app.on("will-quit", () => globalShortcut.unregisterAll());
