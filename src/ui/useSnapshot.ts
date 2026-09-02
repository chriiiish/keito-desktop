import { useEffect, useState } from "react";
import type { Snapshot } from "../../electron/service.js";
import { keito } from "./keito-api.js";

/** The single source of UI state, pushed from the main process on every change. */
export function useSnapshot(): [Snapshot | null, (next: Snapshot) => void] {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    void keito.getSnapshot().then(setSnapshot);
    return keito.onSnapshot(setSnapshot);
  }, []);

  return [snapshot, setSnapshot];
}
