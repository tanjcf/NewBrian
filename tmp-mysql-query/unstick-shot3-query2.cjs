const crypto = require("crypto");
const mysql = require("mysql2/promise");
const fs = require("fs");

function decryptEnvelope(providerType, envelope, keyB64) {
  const parts = String(envelope || "").split(":");
  const keyVersion = parts[1];
  const nonce = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  const key = Buffer.from(keyB64, "base64");
  const aad = Buffer.from(`${providerType.trim().toLowerCase()}|${keyVersion}`, "utf8");
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
  const jobId = "01M18FTBFNQ7FBNH054TH3FJ7Y";
  const [jobs] = await c.query(
    `SELECT model_config_id, provider_job_id, SUBSTRING(request_json,1,800) AS req,
            SUBSTRING(IFNULL(provider_response_json,''),1,400) AS prev
     FROM generation_jobs WHERE platform_job_id=?`,
    [jobId]
  );
  console.log("JOB", JSON.stringify(jobs[0]));
  const [models] = await c.query(
    "SELECT id, model_name, wire_api FROM model_configs WHERE id=? OR model_name LIKE '%video%' ORDER BY id",
    [jobs[0].model_config_id]
  );
  console.log("MODELS");
  for (const m of models) console.log(JSON.stringify(m));

  const [creds] = await c.query(
    "SELECT provider_type, encrypted_payload FROM provider_credentials WHERE id=2"
  );
  const plain = JSON.parse(decryptEnvelope(creds[0].provider_type, creds[0].encrypted_payload, keyB64));
  const secret = plain.apiKey;
  const providerJobId = jobs[0].provider_job_id;
  const candidates = [
    "kling-video-v3",
    "minimax-video-h3",
    "minimax-video-h5",
    "hy-video-v1.5",
    "Wan2.1"
  ];
  for (const model of candidates) {
    const res = await fetch("https://tokenhub.tencentmaas.com/v1/api/video/query", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ model, id: providerJobId })
    });
    const text = await res.text();
    console.log("TRY", model, res.status, text.slice(0, 350));
  }
  await c.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
