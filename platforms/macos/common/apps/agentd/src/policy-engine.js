import path from "node:path";

const CRITICAL_COMMANDS = [
  { id: "critical-root-delete", pattern: /\brm\s+-[^\r\n]*r[^\r\n]*f[^\r\n]*\s+\/(?:\s|$)|\bremove-item\b[^\r\n]*(?:-recurse\b[^\r\n]*)?(?:['"]?[a-z]:\\['"]?\s*$|['"]?\/['"]?\s*$)/i },
  { id: "critical-disk-management", pattern: /\b(?:diskpart|format(?:\.com)?|mkfs(?:\.\w+)?|fdisk)\b/i },
  { id: "critical-power-control", pattern: /\b(?:shutdown(?:\.exe)?|stop-computer|restart-computer|reboot|poweroff)\b/i },
  { id: "critical-boot-config", pattern: /\b(?:bcdedit|bootrec|manage-bde)\b/i },
  { id: "critical-system-registry", pattern: /\breg(?:\.exe)?\s+delete\s+(?:HKLM|HKEY_LOCAL_MACHINE)\\/i }
];

const MUTATING_COMMAND = /\b(?:remove-item|del|erase|rd|rmdir|rm|move-item|move|rename-item|ren|copy-item|cp|set-content|out-file|new-item|mkdir|md|git\s+clean)\b/i;

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

function matchesRule(rule, toolName, command) {
  if (rule.enabled === false) return false;
  if (rule.toolName && rule.toolName !== "*" && rule.toolName !== toolName) return false;
  const prefix = normalize(rule.commandPrefix).toLowerCase();
  return !prefix || command.toLowerCase().startsWith(prefix);
}

export class PolicyEngine {
  constructor(input = {}) {
    this.rules = [];
    this.setRules(input.rules ?? []);
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

    if (toolName === "shell.exec") {
      const critical = CRITICAL_COMMANDS.find((guard) => guard.pattern.test(command));
      if (critical) {
        return {
          decision: "deny",
          source: "builtin",
          ruleId: critical.id,
          reason: "Command is blocked by a non-overridable system safety guard."
        };
      }
      if (MUTATING_COMMAND.test(command)) {
        const escapedPath = extractAbsolutePaths(command).find((candidate) =>
          !isWithinWorkspace(workspacePath, candidate));
        if (escapedPath) {
          return {
            decision: "deny",
            source: "builtin",
            ruleId: "workspace-boundary",
            reason: `Mutating command targets a path outside the workspace: ${escapedPath}`
          };
        }
      }
    }

    if (input.arguments?.targetPath) {
      const targetPath = path.resolve(workspacePath, String(input.arguments.targetPath));
      if (!isWithinWorkspace(workspacePath, targetPath)) {
        return {
          decision: "deny",
          source: "builtin",
          ruleId: "workspace-boundary",
          reason: "Tool target must stay inside the attached workspace."
        };
      }
    }

    const explicit = this.rules.find((rule) => matchesRule(rule, toolName, command));
    if (explicit) {
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
    if (input.permissionMode === "full") {
      return { decision: "allow", source: "permission", ruleId: "", reason: "Full-access mode permits this tool." };
    }
    if (input.permissionMode === "agent" && descriptor.risk !== "high") {
      return { decision: "allow", source: "permission", ruleId: "", reason: "Agent mode permits low/medium risk tools." };
    }
    return { decision: "ask", source: "default", ruleId: "", reason: "User approval is required." };
  }
}
