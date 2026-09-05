const fs = require("fs");
const mysql = require("mysql2/promise");
const auth = JSON.parse(
  fs.readFileSync(
    "C:/Users/Administrator/AppData/Roaming/@codex-forge/desktop/.codecn/desktop-auth.json",
    "utf8"
  )
);

async function main() {
  const c = await mysql.createConnection({
    host: "120.48.151.202",
    port: 3307,
    user: "stock_app",
    password: "change_me_stock_app_password",
    database: "token_system",
    connectTimeout: 12000
  });

  const gatewayKey = String(auth.gateway_api_key || "").trim();
  const email = String(auth.user?.email || "").trim().toLowerCase();

  const [keys] = await c.query(
    "SELECT id, name, is_active, owner_user_email, CHAR_LENGTH(api_key) AS key_len, LEFT(api_key,8) AS prefix, revoked_at, expires_at, updated_at FROM client_api_keys WHERE owner_user_email=? ORDER BY id DESC LIMIT 20",
    [email]
  );
  console.log("user_keys", JSON.stringify(keys));

  const [exact] = await c.query(
    "SELECT id, name, is_active, owner_user_email, revoked_at FROM client_api_keys WHERE api_key=? LIMIT 5",
    [gatewayKey]
  );
  console.log("gateway_key_match_count", exact.length, JSON.stringify(exact));

  const [sessions] = await c.query(
    "SELECT session_id, status, expires_at, revoked_at, gateway_api_key_id, last_seen_at, updated_at, desktop_scopes FROM user_device_sessions WHERE user_email=? ORDER BY updated_at DESC LIMIT 5",
    [email]
  );
  console.log("sessions", JSON.stringify(sessions));

  // recent job owner
  const [owners] = await c.query(
    "SELECT owner_email, COUNT(*) c FROM generation_jobs WHERE created_at >= '2026-08-29T16:00:00' GROUP BY owner_email"
  );
  console.log("recent_owners", JSON.stringify(owners));

  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
