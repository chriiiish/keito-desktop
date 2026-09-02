import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve("electron/main.ts") },
      rollupOptions: { output: { format: "cjs", entryFileNames: "index.cjs" } },
    },
  },
  preload: {
    build: {
      lib: { entry: resolve("electron/preload.ts") },
      rollupOptions: { output: { format: "cjs", entryFileNames: "index.cjs" } },
    },
  },
  renderer: {
    root: resolve("src/ui"),
    plugins: [react()],
    build: { rollupOptions: { input: resolve("src/ui/index.html") } },
  },
});
