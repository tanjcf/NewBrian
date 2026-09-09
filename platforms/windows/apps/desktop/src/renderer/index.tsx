import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui";
import "./styles.css";
import { isMissingWorkspaceSelectionError } from "../shared/workspace-selection-errors";

let fatalReported = false;

function renderFatal(message: string, kind: "renderer_error" | "renderer_unhandled_rejection" | "renderer_bootstrap_error") {
  const main = document.createElement("main");
  main.style.cssText = "padding:24px;font-family:Segoe UI,sans-serif;color:#7f1d1d;background:#fef2f2;min-height:100vh;";
  const title = document.createElement("h1");
  title.style.cssText = "margin:0 0 12px;";
  title.textContent = "NewBrain 正在从界面异常中恢复";
  const detail = document.createElement("pre");
  detail.style.cssText = "white-space:pre-wrap;background:#fff;padding:16px;border:1px solid #fecaca;border-radius:12px;";
  detail.textContent = `${message}\n\n异常已写入本地文件，NewBrain 将自动重启并在重启后上报。`;
  main.append(title, detail);
  document.body.replaceChildren(main);
  if (fatalReported) return;
  fatalReported = true;
  const error = message.slice(0, 24_000);
  void window.newbrain?.reportRendererFailure({
    kind,
    message: error.split("\n")[0] || "Renderer failure",
    stackTrace: error,
    context: { href: window.location.href }
  }).catch(() => undefined);
}

window.addEventListener("error", (event) => {
  renderFatal(event.error?.stack ?? event.message, "renderer_error");
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
  renderFatal(reason, "renderer_unhandled_rejection");
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
  renderFatal(error instanceof Error ? error.stack ?? error.message : String(error), "renderer_bootstrap_error");
}
