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

  const [models] = await c.query(
    `SELECT id, model_name, wire_api, is_active, provider_type, LEFT(capability_tags, 120) AS tags
     FROM model_configs
     WHERE model_name LIKE '%minimax%' OR model_name LIKE '%hy%' OR capability_tags LIKE '%video%'
     ORDER BY id`
  );
  console.log("=== MODELS ===");
  for (const row of models) {
    console.log(JSON.stringify(row));
  }

  const [jobs] = await c.query(
    `SELECT platform_job_id, media_kind, model_config_id, state,
            LEFT(IFNULL(error_message,''), 280) AS err,
            LEFT(IFNULL(request_json,''), 500) AS req,
            created_at, updated_at
     FROM generation_jobs
     ORDER BY id DESC
     LIMIT 20`
  );
  console.log("=== RECENT JOBS ===");
  for (const row of jobs) {
    console.log(JSON.stringify(row));
  }

  const [creds] = await c.query(
    `SELECT id, provider_type, credential_name, status,
            LEFT(IFNULL(error_message,''), 160) AS err,
            updated_at
     FROM provider_credentials
     ORDER BY id`
  );
  console.log("=== CREDENTIALS (no secrets) ===");
  for (const row of creds) {
    console.log(JSON.stringify(row));
  }

  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
