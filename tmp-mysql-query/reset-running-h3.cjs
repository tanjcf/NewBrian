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
  const [res] = await c.query(
    "UPDATE generation_jobs SET poll_attempts=0, next_poll_at='1970-01-01T00:00:00Z', error_message=NULL, lease_owner=NULL, lease_until=NULL, updated_at=UTC_TIMESTAMP(6) WHERE state='RUNNING' AND model_config_id=28 AND error_message LIKE '%credential%'"
  );
  console.log("reset_affected", res.affectedRows);
  const [rows] = await c.query(
    "SELECT platform_job_id, state, poll_attempts, SUBSTRING(IFNULL(error_message,''),1,80) err, provider_job_id, updated_at FROM generation_jobs WHERE model_config_id=28 ORDER BY updated_at DESC LIMIT 5"
  );
  for (const row of rows) console.log(JSON.stringify(row));
  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
