import { createServer } from "node:http";

const port = Number(process.env.NEWBRAIN_HOLON_TEST_PORT || 18891);
const restartMode = process.env.NEWBRAIN_HOLON_RESTART_MODE === "1";
const gameMode = process.env.NEWBRAIN_HOLON_GAME_MODE === "1";
const now = new Date().toISOString();
const state = { claimIndex: 0, events: [], eventAttempts: 0, feedback: [], mutations: [], cancelRequests: [] };
const workItem = {
  id: "wi_e2e_001", source: "e2e", objective: "Return the exact text HOLON_E2E_COMPLETED without using tools.",
  status: "DISPATCHED", target_device_id: "device-e2e", knowledge_snapshot_id: "snapshot-e2e",
  execution_policy_version: "execution-v1", learning_policy_version: "learning-v1", version_no: 1,
  dispatch_attempt_count: 1, lease_until: new Date(Date.now() + 120_000).toISOString(), cancel_requested: false,
  created_at: now, updated_at: now
};
const discardWorkItem = {
  ...workItem,
  id: "wi_e2e_002",
  objective: "This task must be explicitly discarded before execution.",
  knowledge_snapshot_id: null
};
const restartWorkItem = {
  ...workItem,
  id: "wi_e2e_restart",
  objective: "HOLON_E2E_INTERRUPT_AND_RESTART",
  knowledge_snapshot_id: null
};
const approvalWorkItem = {
  ...workItem,
  id: "wi_e2e_003",
  objective: "HOLON_E2E_REMOTE_APPROVAL: create holon-remote-approval.txt through shell.exec, then report completion.",
  knowledge_snapshot_id: null
};
const gameWorkItem = {
  ...workItem,
  id: "wi_e2e_game_001",
  objective: "HOLON_E2E_DESKTOP_GAME: create outputs/holon-snake/HolonSnake.ps1 and README.txt through shell.exec, then report completion.",
  knowledge_snapshot_id: null
};
const gameScript = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object Windows.Forms.Form
$form.Text = 'Holon Snake'
$form.ClientSize = New-Object Drawing.Size(640, 480)
$form.KeyPreview = $true
$label = New-Object Windows.Forms.Label
$label.Name = 'GameStatus'
$label.Text = 'Score: 0 | Running | Use Arrow Keys or WASD | Space Pause | R Restart'
$label.AutoSize = $true
$label.Location = New-Object Drawing.Point(20, 20)
$form.Controls.Add($label)
$x = 300; $y = 220; $paused = $false; $score = 0
$snake = New-Object Windows.Forms.Panel
$snake.BackColor = [Drawing.Color]::Green
$snake.Size = New-Object Drawing.Size(24, 24)
$snake.Location = New-Object Drawing.Point($x, $y)
$form.Controls.Add($snake)
$form.Add_KeyDown({
  param($sender, $event)
  if ($event.KeyCode -eq 'Space') { $script:paused = -not $script:paused; $label.Text = if ($script:paused) { 'Score: ' + $script:score + ' | Paused' } else { 'Score: ' + $script:score + ' | Running' }; return }
  if ($event.KeyCode -eq 'R') { $script:x = 300; $script:y = 220; $script:score = 0; $script:paused = $false; $snake.Location = New-Object Drawing.Point($script:x, $script:y); $label.Text = 'Score: 0 | Running'; return }
  if ($script:paused) { return }
  if ($event.KeyCode -in @('Right','D')) { $script:x += 20 }
  if ($event.KeyCode -in @('Left','A')) { $script:x -= 20 }
  if ($event.KeyCode -in @('Up','W')) { $script:y -= 20 }
  if ($event.KeyCode -in @('Down','S')) { $script:y += 20 }
  $script:score += 10
  if ($script:x -lt 0 -or $script:x -gt 616 -or $script:y -lt 50 -or $script:y -gt 456) { $label.Text = 'Game Over | Score: ' + $script:score } else { $snake.Location = New-Object Drawing.Point($script:x, $script:y); $label.Text = 'Score: ' + $script:score + ' | Running' }
})
[void]$form.ShowDialog()`;
const gameCommand = (() => {
  const readme = "Holon Snake desktop game. Start with: powershell -ExecutionPolicy Bypass -File HolonSnake.ps1. Controls: Arrow keys/WASD, Space pause, R restart.";
  return `New-Item -ItemType Directory -Force -Path 'outputs/holon-snake' | Out-Null\n@'\n${gameScript}\n'@ | Set-Content -LiteralPath 'outputs/holon-snake/HolonSnake.ps1' -Encoding UTF8\n@'\n${readme}\n'@ | Set-Content -LiteralPath 'outputs/holon-snake/README.txt' -Encoding UTF8`;
})();
const snapshot = {
  id: "snapshot-e2e", generation: 1, status: "READY", item_count: 1, content_hash: "sha256:e2e", created_at: now,
  items: [{ skill_key: "e2e-skill", version_id: "version-e2e", ordinal_no: 0, content_json: "{\"instruction\":\"Return HOLON_E2E_COMPLETED\"}", content_hash: "sha256:item" }]
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const body = await readBody(request);
  if (url.pathname === "/__state") return json(response, state);
  if (url.pathname === "/v1/models") return json(response, { data: [{ id: "newbrain-e2e-model", name: "Holon E2E", owned_by: "newbrain", config_id: "e2e" }] });
  if (url.pathname === "/v1/responses") {
    state.responseCount = (state.responseCount ?? 0) + 1;
    if (restartMode) await new Promise((resolve) => setTimeout(resolve, 120_000));
    const bodyText = JSON.stringify(body ?? {});
    const gameRequested = gameMode && bodyText.includes("HOLON_E2E_DESKTOP_GAME");
    const remoteApprovalRequested = !restartMode && (bodyText.includes("HOLON_E2E_REMOTE_APPROVAL") || gameRequested);
    if (remoteApprovalRequested && !state.approvalToolIssued) {
      state.approvalToolIssued = true;
      return json(response, {
        id: "response-e2e-tool", object: "response", status: "completed", output_text: "",
        output: [{
          type: "function_call", call_id: "call-holon-approval", name: "shell.exec",
          arguments: JSON.stringify({ command: gameRequested ? gameCommand : "Set-Content -LiteralPath 'holon-remote-approval.txt' -Value 'HOLON_REMOTE_APPROVAL_OK'" })
        }],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 }
      });
    }
    return json(response, {
    id: "response-e2e", object: "response", status: "completed", output_text: "HOLON_E2E_COMPLETED",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "HOLON_E2E_COMPLETED" }] }],
    usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 }
    });
  }
  if (url.pathname.endsWith("/holon/work-items/next")) {
    const next = (restartMode ? [restartWorkItem] : gameMode ? [gameWorkItem] : [workItem, discardWorkItem, approvalWorkItem])[state.claimIndex++];
    if (!next) return json(response, { item: {} });
    return json(response, { item: { ...next, lease_until: new Date(Date.now() + 120_000).toISOString(), target_device_id: url.searchParams.get("device_id") } });
  }
  if (url.pathname.endsWith("/knowledge/snapshots/snapshot-e2e")) return json(response, { snapshot });
  if (/\/holon\/work-items\/[^/]+\/heartbeat$/.test(url.pathname)) return json(response, { work_item_id: workItem.id, lease_until: new Date(Date.now() + 120_000).toISOString() });
  if (/\/holon\/work-items\/[^/]+\/control$/.test(url.pathname)) return json(response, { control: { status: "RUNNING", cancel_requested: false } });
  if (/\/holon\/work-items\/[^/]+\/cancel$/.test(url.pathname)) {
    const workItemId = url.pathname.split("/").at(-2);
    state.cancelRequests.push(workItemId);
    return json(response, { ok: true, work_item_id: workItemId, cancel_requested: true });
  }
  if (url.pathname.endsWith("/holon/events:batch")) {
    state.eventAttempts += 1;
    if (state.eventAttempts === 1) return json(response, { message: "TRANSIENT_E2E_FAILURE" }, 500);
    state.events.push(...(Array.isArray(body?.events) ? body.events : []));
    return json(response, { ok: true, accepted: body?.events?.length ?? 0, duplicate: 0, total: body?.events?.length ?? 0 });
  }
  if (url.pathname.endsWith("/learning/candidates")) return json(response, { items: [{
    id: "candidate-e2e", skill_key: "e2e-skill", parent_version_id: "version-parent",
    status: "REVIEW_REQUIRED", content_json: "{\"rule\":\"candidate-e2e\"}", content_hash: "sha256:candidate",
    source_work_item_id: workItem.id, evaluation_run_id: "eval-e2e", index_status: "PENDING",
    created_at: now, activated_at: null
  }] });
  if (url.pathname.endsWith("/learning/knowledge/search")) return json(response, { items: [{
    skill_key: "e2e-skill", version_id: "version-e2e", content: `knowledge-e2e:${url.searchParams.get("q")}`,
    content_hash: "sha256:knowledge", created_at: now, score: 0.9
  }] });
  if (/\/learning\/.+\/(?:approve|reject|rollback)$/.test(url.pathname)) {
    state.mutations.push({ path: url.pathname, body });
    return json(response, { ok: true });
  }
  if (url.pathname.endsWith("/holon/feedback")) {
    state.feedback.push(body);
    return json(response, { ok: true });
  }
  json(response, { error: "not_found", path: url.pathname }, 404);
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`READY ${port}\n`));
process.on("SIGTERM", () => server.close());

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}
function json(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}
