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
    "UPDATE generation_jobs SET poll_attempts=0, next_poll_at=UTC_TIMESTAMP(6), error_message=NULL, error_code=NULL, lease_owner=NULL, lease_until=NULL, updated_at=UTC_TIMESTAMP(6) WHERE platform_job_id=? AND state='RUNNING'",
    ["01M17CPWFJG217XBVSYV4K6TJF"]
  );
  console.log("reset_affected", res.affectedRows);
  const [rows] = await c.query(
    "SELECT platform_job_id, state, model_config_id, poll_attempts, SUBSTRING(IFNULL(error_message,''),1,80) err, provider_job_id FROM generation_jobs WHERE platform_job_id=? OR (media_kind='video' AND model_config_id=28) ORDER BY updated_at DESC LIMIT 5",
    ["01M17CPWFJG217XBVSYV4K6TJF"]
  );
  for (const row of rows) console.log(JSON.stringify(row));
  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
