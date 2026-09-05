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
    "SELECT id, model_name, provider_type, credential_id, wire_api, base_url, is_active FROM model_configs WHERE id=29"
  );
  console.log("MODEL", JSON.stringify(models[0] || null));

  const credId = models[0] && models[0].credential_id;
  if (credId) {
    const [creds] = await c.query(
      `SELECT id, provider_type, credential_name, status, key_version,
              SUBSTRING(IFNULL(error_message,''),1,200) AS err,
              LENGTH(ciphertext) AS ct_len, updated_at
       FROM provider_credentials WHERE id=?`,
      [credId]
    );
    console.log("CRED", JSON.stringify(creds[0] || null));
  }

  const [rows] = await c.query(
    "SELECT api_key FROM client_api_keys WHERE id=329 AND is_active=1 LIMIT 1"
  );
  const key = rows[0].api_key;

  // List provider credentials via admin-ish API if available
  for (const path of [
    "/api/admin/provider-credentials",
    "/api/provider-credentials",
    "/v1/admin/provider-credentials"
  ]) {
    try {
      const res = await fetch(`http://127.0.0.1:8790${path}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }
      });
      const text = await res.text();
      console.log("API", path, res.status, text.slice(0, 300));
    } catch (e) {
      console.log("API", path, "ERR", e.message);
    }
  }

  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
