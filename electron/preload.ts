import { contextBridge, ipcRenderer } from "electron";
import type { Snapshot } from "./service.js";
import type { TimeEntry } from "../src/core/keito/types.js";

/** The only surface the renderer can reach. No node, no direct network. */
const api = {
  getSnapshot: (): Promise<Snapshot> => ipcRenderer.invoke("snapshot"),
  setApiKey: (key: string): Promise<Snapshot> => ipcRenderer.invoke("set-api-key", key),
  signOut: (): Promise<Snapshot> => ipcRenderer.invoke("sign-out"),
  refresh: (): Promise<Snapshot> => ipcRenderer.invoke("refresh"),
  switchTo: (pairId: string, notes?: string): Promise<Snapshot> =>
    ipcRenderer.invoke("switch-to", pairId, notes),
  stopTimer: (): Promise<Snapshot> => ipcRenderer.invoke("stop-timer"),
  toggleFavourite: (pairId: string): Promise<Snapshot> => ipcRenderer.invoke("toggle-favourite", pairId),
  setHotkey: (hotkey: string): Promise<Snapshot> => ipcRenderer.invoke("set-hotkey", hotkey),
  listEntries: (from: string, to: string): Promise<TimeEntry[]> =>
    ipcRenderer.invoke("list-entries", from, to),
  updateEntry: (
    id: string,
    patch: { notes?: string; startedTime?: string; endedTime?: string },
  ): Promise<TimeEntry | null> => ipcRenderer.invoke("update-entry", id, patch),
  deleteEntry: (id: string): Promise<void> => ipcRenderer.invoke("delete-entry", id),
  closePopover: (): Promise<void> => ipcRenderer.invoke("close-popover"),
  openWindow: (): Promise<void> => ipcRenderer.invoke("open-window"),
  resolveIdle: (keep: boolean, awaySinceMs: number): Promise<Snapshot> =>
    ipcRenderer.invoke("resolve-idle", keep, awaySinceMs),

  onSnapshot: (handler: (snapshot: Snapshot) => void) => {
    const listener = (_event: unknown, snapshot: Snapshot) => handler(snapshot);
    ipcRenderer.on("snapshot", listener);
    return () => {
      ipcRenderer.off("snapshot", listener);
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
