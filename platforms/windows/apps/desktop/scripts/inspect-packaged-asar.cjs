const fs = require("node:fs");
const { app } = require("electron");

app.whenReady().then(() => {
  const asarPath = process.argv[2];
  const required = [
    "out/main/index.js",
    "out/main/agent-host-entry.js",
    "out/main/tool-host-worker.js",
    "out/preload/index.cjs",
    "out/renderer/index.html",
    "node_modules/jszip/package.json"
  ];
  const result = Object.fromEntries(required.map((entry) => [entry, fs.existsSync(`${asarPath}/${entry}`)]));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  app.quit();
});
