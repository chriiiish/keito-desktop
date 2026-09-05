import { contextBridge, ipcRenderer } from "electron";
import type { Snapshot } from "./service.js";
import type { TimeEntry } from "../src/core/keito/types.js";
import type { NoteVisibility } from "../src/core/keito/notes.js";

/** The only surface the renderer can reach. No node, no direct network. */
const api = {
  getSnapshot: (): Promise<Snapshot> => ipcRenderer.invoke("snapshot"),
  setApiKey: (key: string, accountId?: string): Promise<Snapshot> =>
    ipcRenderer.invoke("set-api-key", key, accountId),
  setCompanyId: (accountId: string): Promise<Snapshot> =>
    ipcRenderer.invoke("set-company-id", accountId),
  signOut: (): Promise<Snapshot> => ipcRenderer.invoke("sign-out"),
  resetAll: (): Promise<Snapshot> => ipcRenderer.invoke("reset-all"),
  refresh: (): Promise<Snapshot> => ipcRenderer.invoke("refresh"),
  switchTo: (pairId: string, notes?: string, visibility?: "client" | "internal"): Promise<Snapshot> =>
    ipcRenderer.invoke("switch-to", pairId, notes, visibility),
  stopTimer: (): Promise<Snapshot> => ipcRenderer.invoke("stop-timer"),
  resumeEntry: (entryId: string): Promise<Snapshot> => ipcRenderer.invoke("resume-entry", entryId),
  toggleFavourite: (pairId: string): Promise<Snapshot> => ipcRenderer.invoke("toggle-favourite", pairId),
  setHidden: (pairIds: string[], hidden: boolean): Promise<Snapshot> =>
    ipcRenderer.invoke("set-hidden", pairIds, hidden),
  setHotkey: (hotkey: string): Promise<Snapshot> => ipcRenderer.invoke("set-hotkey", hotkey),
  dismissUpdate: (): Promise<Snapshot> => ipcRenderer.invoke("dismiss-update"),
  setIncludePrereleases: (include: boolean): Promise<Snapshot> =>
    ipcRenderer.invoke("set-include-prereleases", include),
  setNoteIsInternal: (internal: boolean): Promise<Snapshot> =>
    ipcRenderer.invoke("set-note-is-internal", internal),
  setInternalNotesAvailable: (available: boolean): Promise<Snapshot> =>
    ipcRenderer.invoke("set-internal-notes-available", available),
  setAzureEnabled: (enabled: boolean): Promise<Snapshot> =>
    ipcRenderer.invoke("set-azure-enabled", enabled),
  connectAzure: (token: string, organisationUrl?: string): Promise<Snapshot> =>
    ipcRenderer.invoke("connect-azure", token, organisationUrl),
  disconnectAzure: (): Promise<Snapshot> => ipcRenderer.invoke("disconnect-azure"),
  setOpenAtLogin: (openAtLogin: boolean): Promise<Snapshot> =>
    ipcRenderer.invoke("set-open-at-login", openAtLogin),
  setTrayLabel: (options: {
    fallback: "task" | "project";
    prefix: "none" | "project" | "task";
  }): Promise<Snapshot> => ipcRenderer.invoke("set-tray-label", options),
  listEntries: (from: string, to: string): Promise<TimeEntry[]> =>
    ipcRenderer.invoke("list-entries", from, to),
  updateEntry: (
    id: string,
    patch: { notes?: string; noteField?: NoteVisibility; startedTime?: string; endedTime?: string },
  ): Promise<Snapshot> => ipcRenderer.invoke("update-entry", id, patch),
  deleteEntry: (id: string): Promise<Snapshot> => ipcRenderer.invoke("delete-entry", id),
  openLog: (): Promise<void> => ipcRenderer.invoke("open-log"),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("open-external", url),
  logPath: (): Promise<string> => ipcRenderer.invoke("log-path"),
  closePopover: (): Promise<void> => ipcRenderer.invoke("close-popover"),
  openWindow: (tab?: string): Promise<void> => ipcRenderer.invoke("open-window", tab),
  resolveIdle: (keep: boolean, awaySinceMs: number): Promise<Snapshot> =>
    ipcRenderer.invoke("resolve-idle", keep, awaySinceMs),

  onSnapshot: (handler: (snapshot: Snapshot) => void) => {
    const listener = (_event: unknown, snapshot: Snapshot) => handler(snapshot);
    ipcRenderer.on("snapshot", listener);
    return () => {
      ipcRenderer.off("snapshot", listener);
    };
  },
  /** The main process asking the settings window to select a tab — see openMainWindow. */
  onShowTab: (handler: (tab: string) => void) => {
    const listener = (_event: unknown, tab: string) => handler(tab);
    ipcRenderer.on("show-tab", listener);
    return () => {
      ipcRenderer.off("show-tab", listener);
    };
  },
  onPopoverShown: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on("popover-shown", listener);
    return () => {
      ipcRenderer.off("popover-shown", listener);
    };
  },
  onIdleReturn: (handler: (event: { awaySinceMs: number; awaySeconds: number }) => void) => {
    const listener = (_e: unknown, payload: { awaySinceMs: number; awaySeconds: number }) =>
      handler(payload);
    ipcRenderer.on("idle-return", listener);
    return () => {
      ipcRenderer.off("idle-return", listener);
    };
  },
};

contextBridge.exposeInMainWorld("keito", api);

export type KeitoApi = typeof api;
