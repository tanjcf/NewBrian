import { writeFile } from "node:fs/promises";

const pidFile = process.argv[2];
if (!pidFile) throw new Error("PID file path is required.");
await writeFile(pidFile, String(process.pid), "utf8");
setInterval(() => undefined, 1_000);
