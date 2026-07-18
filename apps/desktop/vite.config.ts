import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port; fail rather than pick a random one.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/target/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "chrome110",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@tiptap") || id.includes("node_modules/prosemirror") || id.includes("node_modules/tiptap-markdown")) return "editor-rich";
          if (id.includes("node_modules/@codemirror")) return "editor-source";
          if (id.includes("node_modules/@tauri-apps")) return "tauri";
          if (id.includes("node_modules/react") || id.includes("node_modules/zustand")) return "framework";
          return undefined;
        },
      },
    },
  },
});
