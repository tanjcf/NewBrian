import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui";
import "./styles.css";
import { isMissingWorkspaceSelectionError } from "../shared/workspace-selection-errors";

function renderFatal(message: string) {
  document.body.innerHTML = `
    <main style="padding:24px;font-family:Segoe UI,sans-serif;color:#7f1d1d;background:#fef2f2;min-height:100vh;">
      <h1 style="margin:0 0 12px;">Renderer failed to start</h1>
      <pre style="white-space:pre-wrap;background:#fff;padding:16px;border:1px solid #fecaca;border-radius:12px;">${message}</pre>
    </main>
  `;
}

window.addEventListener("error", (event) => {
  renderFatal(event.error?.stack ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason =
    typeof event.reason === "string"
      ? event.reason
      : event.reason?.stack ?? event.reason?.message ?? JSON.stringify(event.reason, null, 2);
  if (isMissingWorkspaceSelectionError(String(reason || ""))) {
    event.preventDefault();
    return;
  }
  renderFatal(reason);
});

const rootNode = document.getElementById("root");

if (!rootNode) {
  throw new Error("Renderer root element was not found.");
}

try {
  createRoot(rootNode).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  renderFatal(error instanceof Error ? error.stack ?? error.message : String(error));
}
