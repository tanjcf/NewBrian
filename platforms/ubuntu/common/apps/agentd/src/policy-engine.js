import { existsSync } from "node:fs";
import path from "node:path";

const CRITICAL_COMMANDS = [
  { id: "critical-root-delete", pattern: /\brm\b(?=[^\r\n]*\s-\S*r)(?=[^\r\n]*\s-\S*f)[^\r\n]*\s\/\*?(?:\s|$)|\bremove-item\b[^\r\n]*(?:-recurse\b[^\r\n]*)?(?:['"]?[a-z]:\\?['"]?\s*$|['"]?\/['"]?\s*$)/i },
  { id: "critical-disk-management", pattern: /\b(?:diskpart|format(?:\.com)?|mkfs(?:\.\w+)?|fdisk)\b/i },
  { id: "critical-power-control", pattern: /\b(?:shutdown(?:\.exe)?|stop-computer|restart-computer|reboot|poweroff)\b/i },
  { id: "critical-boot-config", pattern: /\b(?:bcdedit|bootrec|manage-bde)\b/i },
  { id: "critical-system-registry", pattern: /\breg(?:\.exe)?\s+delete\s+(?:HKLM|HKEY_LOCAL_MACHINE)\\/i }
];

const MUTATING_COMMAND = /\b(?:remove-item|del|erase|rd|rmdir|rm|move-item|move|rename-item|ren|copy-item|cp|set-content|out-file|new-item|mkdir|md|git\s+clean)\b/i;
const NETWORK_COMMAND = /\b(?:curl|wget|irm|iwr|invoke-webrequest|invoke-restmethod|certutil|bitsadmin|start-bitstransfer|ftp|tftp|nc|ncat|netcat|ssh|scp|sftp|git\s+(?:clone|pull|push|fetch)|npm\s+(?:install|i|publish)|pnpm\s+(?:install|add|publish)|yarn\s+(?:install|add|publish)|pip\s+install|(?:new-object\s+)?(?:system\.net\.)?webclient)\b/i;
const ENCODED_EXECUTION = /(?:^|\s)(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b[^\r\n]*(?:-(?:e|en|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)\b)|\bfrombase64string\b/i;
const DYNAMIC_EXECUTION = /\b(?:invoke-expression|iex)\b/i;
const READ_ONLY_COMMANDS = new Set([
  "cat",
  "dir",
  "get-childitem",
  "get-content",
  "git diff",
  "git log",
  "git show",
  "git status",
  "ls",
  "pwd",
  "type"
]);
const READ_ONLY_PIPELINE_COMMANDS = new Set([
  "compare-object",
  "format-list",
  "format-table",
  "foreach-object",
  "group-object",
  "measure-object",
  "select-object",
  "sort-object",
  "where-object"
]);
const UNSAFE_SHELL_CONTROL_OPERATOR = /[;&<>]/;
const UNSAFE_PIPELINE_SCRIPT = /\b(?:invoke-expression|iex|start-process|set-content|out-file|new-item|remove-item|move-item|copy-item|rename-item|curl|wget|invoke-webrequest|invoke-restmethod)\b/i;

function normalize(value) {
  return String(value ?? "").trim();
}

function isWithinWorkspace(workspacePath, targetPath) {
  const workspace = path.resolve(workspacePath);
  const target = path.resolve(targetPath);
  return target === workspace || target.startsWith(`${workspace}${path.sep}`);
}

function extractAbsolutePaths(command) {
  const paths = [];
  const windowsPattern = /(?:['"])([a-zA-Z]:\\[^'"]+)(?:['"])|(?:^|\s)([a-zA-Z]:\\[^\s;|&]+)/g;
  const posixPattern = /(?:['"])(\/[^'"]+)(?:['"])|(?:^|\s)(\/[^\s;|&]+)/g;
  for (const pattern of [windowsPattern, posixPattern]) {
    let match;
    while ((match = pattern.exec(command))) paths.push(match[1] || match[2]);
  }
  return paths;
}

function tokenizeCommand(command) {
  const tokens = [];
  const pattern = /"([^"]+)"|'([^']+)'|([^\s;|&]+)/g;
  let match;
  while ((match = pattern.exec(command))) {
    tokens.push(match[1] || match[2] || match[3]);
  }
  return tokens;
}

function looksLikePathToken(token) {
  if (!token || token.startsWith("-")) return false;
  return (
    path.isAbsolute(token) ||
    token.startsWith("../") ||
    token.startsWith("..\\") ||
    token.startsWith("./") ||
    token.startsWith(".\\") ||
    token.includes("/../") ||
    token.includes("\\..\\")
  );
}

function extractCommandPaths(command) {
  return [...new Set([
    ...extractAbsolutePaths(command),
    ...tokenizeCommand(command).filter(looksLikePathToken)
  ])];
}

function readOnlyCommandName(tokens) {
  const first = normalize(tokens[0]).toLowerCase();
  if (first === "git") {
    const second = normalize(tokens[1]).toLowerCase();
    return second ? `git ${second}` : first;
  }
  return first;
}

function readOnlyPathArguments(tokens) {
  const commandName = readOnlyCommandName(tokens);
  const start = commandName.startsWith("git ") ? 2 : 1;
  const paths = [];
  for (const token of tokens.slice(start)) {
    if (!token || token.startsWith("-")) continue;
    if (token.includes("=")) continue;
    if (commandName.startsWith("git ") && !looksLikePathToken(token)) continue;
    paths.push(token);
  }
  return paths;
}

function isWorkspaceReadOnlyShellCommand(command, workspacePath) {
  const scriptBlocks = [...String(command).matchAll(/\{([^{}]*)\}/g)].map((match) => match[1]);
  const commandOutsideScriptBlocks = String(command).replace(/\{[^{}]*\}/g, "");
  if (!command || UNSAFE_SHELL_CONTROL_OPERATOR.test(commandOutsideScriptBlocks)) return false;
  if (scriptBlocks.some((script) => UNSAFE_PIPELINE_SCRIPT.test(script) || NETWORK_COMMAND.test(script) || MUTATING_COMMAND.test(script))) return false;
  const stages = command.split("|").map((stage) => stage.trim()).filter(Boolean);
  if (!stages.length) return false;
  const tokens = tokenizeCommand(stages[0]);
  const commandName = readOnlyCommandName(tokens);
  if (!READ_ONLY_COMMANDS.has(commandName)) return false;

  const pathArguments = readOnlyPathArguments(tokens);
  if (!pathArguments.every((candidate) =>
    isWithinWorkspace(workspacePath, path.resolve(workspacePath, candidate)))) return false;

  return stages.slice(1).every((stage) => {
    const pipelineCommand = normalize(tokenizeCommand(stage)[0]).toLowerCase();
    return READ_ONLY_PIPELINE_COMMANDS.has(pipelineCommand);
  });
}

function hasDynamicPathExpression(command) {
  return /\b(?:join-path|resolve-path|split-path|convert-path)\b|\$[A-Za-z_][\w:]*/i.test(command);
}

function matchesRule(rule, toolName, command) {
  if (rule.enabled === false) return false;
  if (rule.toolName && rule.toolName !== "*" && rule.toolName !== toolName) return false;
  const prefix = normalize(rule.commandPrefix);
  if (!prefix) return true;
  const haystack = command.toLowerCase();
  const needle = prefix.toLowerCase();
  if (rule.match === "exact") {
    // Collapse runs of whitespace so remembered approvals stay stable across minor formatting.
    const normalizeExact = (value) => value.replace(/[ \t]+/g, " ").trim();
    return normalizeExact(haystack) === normalizeExact(needle);
  }
  return haystack.startsWith(needle);
}

export class PolicyEngine {
  /**
   * @param {{ rules?: Array, writeAsk?: "never"|"on-create"|"always", toolsWriteAsk?: "never"|"on-create"|"always" }} [input]
   * Phase 3 MVP: tools.write.ask defaults to "never" so coding edit/apply_patch stay low-friction.
   * Hard shell denies are never weakened. Set writeAsk to on-create|always to require approval for writes.
   */
  constructor(input = {}) {
    this.rules = [];
    this.writeAsk = normalizeWriteAsk(input.writeAsk ?? input.toolsWriteAsk ?? "never");
    this.setRules(input.rules ?? []);
  }

  setWriteAsk(mode) {
    this.writeAsk = normalizeWriteAsk(mode);
  }

  setRules(rules) {
    this.rules = rules.map((rule, index) => {
      const decision = ["allow", "ask", "deny"].includes(rule.decision) ? rule.decision : "ask";
      return {
        id: normalize(rule.id) || `rule-${index + 1}`,
        toolName: normalize(rule.toolName) || "*",
        commandPrefix: normalize(rule.commandPrefix),
        decision,
        enabled: rule.enabled !== false,
        reason: normalize(rule.reason)
      };
    });
  }

  listRules() {
    return this.rules.map((rule) => ({ ...rule }));
  }

  evaluate(input) {
    const toolName = normalize(input.toolName);
    const command = normalize(input.arguments?.command);
    const workspacePath = path.resolve(input.workspacePath);
    const permissionMode = input.permissionMode ?? "approval";
    const canonicalWriteTools = new Set([
      "workspace.write_file",
      "workspace.edit",
      "workspace.apply_patch",
      "write",
      "edit",
      "apply_patch"
    ]);

    if (toolName === "shell.exec" || toolName === "exec") {
      const critical = CRITICAL_COMMANDS.find((guard) => guard.pattern.test(command));
      if (critical) {
        return {
          decision: "deny",
          source: "builtin",
          ruleId: critical.id,
          reason: "该命令被系统硬性安全护栏拦截（不可覆盖），例如关机、格式化或删除系统盘。"
        };
      }
      if (ENCODED_EXECUTION.test(command) || (permissionMode === "full" && DYNAMIC_EXECUTION.test(command))) {
        return {
          decision: "deny",
          source: "builtin",
          ruleId: "opaque-shell-execution",
          reason: "编码或动态求值的 Shell 命令无法静态审计，已被安全策略拒绝。"
        };
      }
      const explicit = this.rules.find((rule) => matchesRule(rule, "shell.exec", command));
      if (explicit && (explicit.decision === "deny" || permissionMode !== "full")) {
        return {
          decision: explicit.decision,
          source: "rule",
          ruleId: explicit.id,
          reason: explicit.reason || `Matched policy rule ${explicit.id}.`
        };
      }
      if (permissionMode === "full") {
        return {
          decision: "allow",
          source: "permission",
          ruleId: ":danger-full-access",
          reason: "Full-access mode permits non-critical shell commands."
        };
      }
      if (NETWORK_COMMAND.test(command) && permissionMode !== "full") {
        return {
          decision: "ask",
          source: "builtin",
          ruleId: "network-access",
          reason: "Network access is outside the default workspace scope and requires approval."
        };
      }
      if (MUTATING_COMMAND.test(command)) {
        const escapedPath = extractCommandPaths(command).find((candidate) =>
          !isWithinWorkspace(workspacePath, path.resolve(workspacePath, candidate)));
        if (escapedPath) {
          return {
            decision: "deny",
            source: "builtin",
            ruleId: "workspace-boundary",
            reason: `写操作目标超出当前工作区，已被安全策略拒绝：${escapedPath}`
          };
        }
        if (hasDynamicPathExpression(command)) {
          return {
            decision: "ask",
            source: "builtin",
            ruleId: "workspace-boundary-dynamic-path",
            reason: "Mutating command uses a dynamic path expression that cannot be statically verified."
          };
        }
      }
      if (isWorkspaceReadOnlyShellCommand(command, workspacePath)) {
        return {
          decision: "allow",
          source: "permission",
          ruleId: ":workspace-readonly-shell",
          reason: "Workspace mode permits read-only shell inspection inside the workspace."
        };
      }
    }

    // shell.process manages already-spawned sessions; spawn itself was policy-checked via shell.exec.
    if (toolName === "shell.process" || toolName === "process") {
      const action = normalize(input.arguments?.action).toLowerCase();
      if (["kill", "remove", "write"].includes(action) && permissionMode === "approval") {
        // Keep low friction for session control; hard denies remain on shell.exec spawn path.
      }
    }

    const pathArg = input.arguments?.targetPath ?? input.arguments?.path;
    if (pathArg && permissionMode !== "full") {
      const targetPath = path.resolve(workspacePath, String(pathArg));
      if (!isWithinWorkspace(workspacePath, targetPath)) {
        return {
          decision: "deny",
          source: "builtin",
          ruleId: "workspace-boundary",
          reason: "Tool target must stay inside the attached workspace."
        };
      }
    }

    if (canonicalWriteTools.has(toolName) && this.writeAsk !== "never" && permissionMode !== "full") {
      if (this.writeAsk === "always") {
        return {
          decision: "ask",
          source: "builtin",
          ruleId: "tools-write-ask-always",
          reason: "Write tools require approval (tools.write.ask=always)."
        };
      }
      if (this.writeAsk === "on-create") {
        const candidate = String(pathArg || "").trim();
        if (candidate) {
          const absolute = path.isAbsolute(candidate)
            ? path.resolve(candidate)
            : path.resolve(workspacePath, candidate);
          if (!existsSync(absolute)) {
            return {
              decision: "ask",
              source: "builtin",
              ruleId: "tools-write-ask-on-create",
              reason: "Creating a new file requires approval (tools.write.ask=on-create)."
            };
          }
        }
      }
    }

    const explicit = this.rules.find((rule) => matchesRule(rule, toolName, command));
    if (explicit && (explicit.decision === "deny" || permissionMode !== "full")) {
      return {
        decision: explicit.decision,
        source: "rule",
        ruleId: explicit.id,
        reason: explicit.reason || `Matched policy rule ${explicit.id}.`
      };
    }

    const descriptor = input.descriptor ?? {};
    if (descriptor.requiresApproval === false) {
      return { decision: "allow", source: "default", ruleId: "", reason: "Tool does not require approval." };
    }
    if (permissionMode === "full") {
      return { decision: "allow", source: "permission", ruleId: ":danger-full-access", reason: "Full-access mode permits this tool." };
    }
    if (descriptor.kind === "read" || (descriptor.kind === "git" && descriptor.risk === "low")) {
      return { decision: "allow", source: "permission", ruleId: ":workspace", reason: "Workspace mode permits read-only inspection." };
    }
    if (permissionMode === "agent" && descriptor.risk !== "high") {
      return { decision: "allow", source: "permission", ruleId: ":workspace", reason: "Agent mode permits low/medium risk tools inside the workspace." };
    }
    return { decision: "ask", source: "default", ruleId: ":workspace", reason: "User approval is required for actions outside the automatic workspace scope." };
  }
}

function normalizeWriteAsk(value) {
  const mode = normalize(value).toLowerCase();
  if (mode === "always" || mode === "on-create" || mode === "never") return mode;
  return "never";
}
