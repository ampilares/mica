import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { api } from "./api";
import { useStore } from "./store";

// Dev-only hooks for driving the app in automated e2e tests.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__mica = { api, useStore };
  // Browser-only shell preview for responsive/visual QA without a running
  // Tauri backend. No vault content is read or written in this mode.
  if (new URLSearchParams(window.location.search).has("workspace-preview")) {
    useStore.getState().setVault({ root: "/preview", name: "Mica Preview" });
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
