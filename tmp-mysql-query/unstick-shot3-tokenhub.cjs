const crypto = require("crypto");
const mysql = require("mysql2/promise");
const fs = require("fs");

function decryptEnvelope(providerType, envelope, keyB64) {
  const parts = String(envelope || "").split(":");
  if (parts.length !== 4 || parts[0] !== "pc1") {
    throw new Error("invalid envelope: " + envelope.slice(0, 40));
  }
  const keyVersion = parts[1];
  const nonce = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  const key = Buffer.from(keyB64, "base64");
  const aad = Buffer.from(`${providerType.trim().toLowerCase()}|${keyVersion}`, "utf8");
  // Node: ciphertext includes auth tag at end (last 16 bytes)
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

async function main() {
  const keyLine = fs.readFileSync(
    "I:/G盘迁移备份/workrpase/spring-app/data/provider-credentials.keys",
    "utf8"
  ).trim();
  const keyB64 = keyLine.includes("=") ? keyLine.split("=")[1].trim() : keyLine;

  const c = await mysql.createConnection({
    host: "120.48.151.202",
    port: 3307,
    user: "stock_app",
    password: "change_me_stock_app_password",
    database: "token_system",
    connectTimeout: 12000
  });

  const [creds] = await c.query(
    "SELECT provider_type, encrypted_payload FROM provider_credentials WHERE id=2"
  );
  const cred = creds[0];
  const plain = decryptEnvelope(cred.provider_type, cred.encrypted_payload, keyB64);
  const material = JSON.parse(plain);
  const secret = material.apiKey || material.accessToken || material.bearer || Object.values(material)[0];
  if (!secret) throw new Error("no secret in material keys=" + Object.keys(material));
  console.log("DECRYPT_OK keys=", Object.keys(material).join(","), "secretLen=", String(secret).length);

  const providerJobId = "1318055792-WandVideo-9533b94cc3b74e13abece92da20d1b00";
  const res = await fetch("https://tokenhub.tencentmaas.com/v1/api/video/query", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ Id: providerJobId })
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  console.log("TOKENHUB", res.status, JSON.stringify(body).slice(0, 800));

  // Park remote workers: hold a long lease under a sentinel so only manual update proceeds.
  await c.query(
    `UPDATE generation_jobs
     SET lease_owner='manual-unstick',
         lease_until='2099-01-01T00:00:00Z',
         next_poll_at='2099-01-01T00:00:00Z',
         error_message=NULL,
         updated_at=UTC_TIMESTAMP(6)
     WHERE platform_job_id='01M18FTBFNQ7FBNH054TH3FJ7Y' AND state='RUNNING'`
  );
  console.log("LEASE_PARKED");

  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
