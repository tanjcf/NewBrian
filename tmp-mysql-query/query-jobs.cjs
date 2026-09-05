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
    "SELECT id, model_name, wire_api, is_active, provider_type FROM model_configs WHERE model_name LIKE CONCAT('%','minimax','%') OR model_name LIKE CONCAT('%','hy','%') OR capability_tags LIKE CONCAT('%','video','%') ORDER BY id"
  );
  console.log("=== MODELS ===");
  for (const row of models) console.log(JSON.stringify(row));

  const [jobs] = await c.query(
    "SELECT platform_job_id, media_kind, model_config_id, state, SUBSTRING(IFNULL(error_message,''),1,280) AS err, SUBSTRING(IFNULL(request_json,''),1,500) AS req, created_at, updated_at FROM generation_jobs ORDER BY id DESC LIMIT 20"
  );
  console.log("=== RECENT JOBS ===");
  for (const row of jobs) console.log(JSON.stringify(row));

  try {
    const [creds] = await c.query(
      "SELECT id, provider_type, credential_name, status, SUBSTRING(IFNULL(error_message,''),1,160) AS err, updated_at FROM provider_credentials ORDER BY id"
    );
    console.log("=== CREDENTIALS ===");
    for (const row of creds) console.log(JSON.stringify(row));
  } catch (e) {
    console.log("CREDENTIALS_QUERY_FAIL", e.message);
    const [tables] = await c.query("SHOW TABLES LIKE '%credential%'");
    console.log("credential_tables", JSON.stringify(tables));
  }

  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
