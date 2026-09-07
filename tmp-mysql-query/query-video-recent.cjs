const mysql = require("mysql2/promise");

async function main() {
  const c = await mysql.createConnection({
    host: "120.48.151.202",
    port: 3307,
    user: "stock_app",
    password: "change_me_stock_app_password",
    database: "token_system",
    connectTimeout: 12000
  });

  const [jobs] = await c.query(
    `SELECT platform_job_id, media_kind, state, poll_attempts, next_poll_at,
            lease_owner, lease_until, provider_job_id,
            SUBSTRING(IFNULL(error_message,''),1,200) AS err,
            updated_at, created_at
     FROM generation_jobs
     WHERE media_kind='video'
     ORDER BY id DESC
     LIMIT 15`
  );
  console.log("=== RECENT VIDEO JOBS ===");
  for (const row of jobs) console.log(JSON.stringify(row));

  const [running] = await c.query(
    `SELECT platform_job_id, state, poll_attempts, next_poll_at, lease_owner, lease_until,
            provider_job_id, SUBSTRING(IFNULL(error_message,''),1,240) AS err, updated_at
     FROM generation_jobs
     WHERE state IN ('RUNNING','QUEUED','CANCELLING')
     ORDER BY updated_at DESC
     LIMIT 20`
  );
  console.log("=== NON-TERMINAL ===");
  for (const row of running) console.log(JSON.stringify(row));

  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
