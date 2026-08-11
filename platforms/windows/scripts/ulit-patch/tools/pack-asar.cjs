#!/usr/bin/env node
"use strict";
process.noAsar = true;
process.env.ELECTRON_NO_ASAR = "1";

const path = require("path");
const Module = require("module");
const toolsNodeModules = path.join(__dirname, "node_modules");
process.env.NODE_PATH = [toolsNodeModules, process.env.NODE_PATH || ""].filter(Boolean).join(path.delimiter);
Module._initPaths();

const asar = require(path.join(__dirname, "electron-asar", "lib", "asar.js"));
const src = process.argv[2];
const dest = process.argv[3];
if (!src || !dest) {
  console.error("usage: pack-asar.cjs <dir> <out.asar>");
  process.exit(2);
}
asar.createPackage(src, dest).then(() => {
  console.log("packed", dest);
}).catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
