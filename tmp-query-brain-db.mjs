import { createRequire } from "node:module";
const require = createRequire("I:/G盘迁移备份/workrpase/BRAIN/.materialized/windows/apps/desktop/package.json");
const Database = require("better-sqlite3");

const db = new Database("C:/Users/Administrator/.codecn/.codecn/brain.db", {
  readonly: true,
  fileMustExist: true,
});

const tasks = db
  .prepare(
    `SELECT id, task_type, status, error_code,
            substr(error_detail, 1, 500) AS detail,
            started_at, finished_at
     FROM brain_task
     WHERE error_code != '' OR task_type LIKE '%render%'
     ORDER BY started_at DESC
     LIMIT 30`
  )
  .all();
console.log(JSON.stringify(tasks, null, 2));

try {
  console.log("engines", JSON.stringify(db.prepare("SELECT * FROM brain_engine_runtime").all(), null, 2));
} catch (error) {
  console.log("no engines", error.message);
}
