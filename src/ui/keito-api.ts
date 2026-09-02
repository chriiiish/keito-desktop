import type { KeitoApi } from "../../electron/preload.js";

declare global {
  interface Window {
    keito: KeitoApi;
  }
}

export const keito = window.keito;
