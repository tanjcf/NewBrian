import { isAbsolute, join, relative, resolve } from "node:path";
import { isBrainWorkspaceKey, type DesktopPreferences } from "@codex-forge/protocol";
import {
  DEFAULT_BROWSER_USE_PREFERENCES,
  normalizeBrowserUsePreferencesPartial,
  type BrowserUsePreferences
} from "./browser-agent-policy.ts";

export interface DesktopPreferencesNormalizationContext {
  defaults: DesktopPreferences;
  workspaceStateRoot: string;
  isPackaged: boolean;
}

export function createDefaultDesktopPreferences(workspaceStateRoot: string, environment: NodeJS.ProcessEnv = process.env): DesktopPreferences {
  return {
  appearance: {
    theme: "light",
    density: "comfortable",
    reduceMotion: false,
    accentColor: "#339CFF",
    backgroundColor: "#FFFFFF",
    foregroundColor: "#1A1C1F",
    uiFontFamily: "Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif",
    codeFontFamily: "Cascadia Code, Consolas, monospace",
    contrast: 60,
    uiFontSize: 14,
    codeFontSize: 12,
    sidebarTranslucent: true,
    pointerCursor: false,
    diffMarks: "color"
  },
  configuration: {
    requireApprovalForShell: false,
    saveResponses: false,
    telemetryEnabled: false
  },
  personalization: {
    workMode: "coding",
    proactiveUpdates: true,
    includeVerificationSummary: true,
    reviewFindingsFirst: true,
    // Safe default: specialty skills wake only from explicit composer selection.
    autoSkillEnabled: true
  },
  permissions: {
    fullAccess: false
  },
  hooks: {
    beforeCommand: true,
    afterCommand: true,
    beforeCommit: true,
    afterTask: true,
    beforeCommandScript: "",
    afterCommandScript: "",
    beforeCommitScript: "",
    afterTaskScript: ""
  },
  git: {
    statusCommand: "git status --short --branch",
    branchPrefix: "codex/",
    showDiffBeforeCommit: true,
    confirmBeforePush: true,
    pullRequestMergeMethod: "merge",
    forcePushWithLease: false,
    createDraftPullRequests: true,
    autoDeleteOldWorktrees: true,
    autoDeleteWorktreeLimit: 15,
    commitInstructions: ""
  },
  environment: {
    defaultOpenTarget: "visual-studio",
    terminalShell: process.platform === "win32" ? "powershell.exe" : "/bin/zsh",
    extraEnv: {},
    autoBootstrapConda: true
  },
  editor: {
    language: "auto",
    sendShortcut: "enter",
    followBehavior: "queue"
  },
  popup: {
    shortcut: "",
    defaultProjectlessChat: false
  },
  dictation: {
    microphone: "system",
    holdShortcut: "",
    toggleShortcut: "",
    keepBarVisible: false,
    dictionaryOpen: true,
    dictionaryEntries: []
  },
  notifications: {
    turnComplete: "when-unfocused",
    permission: true,
    question: true
  },
  worktree: {
    defaultIsolated: true,
    keepArchived: false,
    rootDir: join(workspaceStateRoot, "worktrees")
  },
  browser: {
    ...DEFAULT_BROWSER_USE_PREFERENCES,
    autoOpenPreview: false,
    preserveTabs: true,
    highResScreenshots: false,
    previewUrl: "http://127.0.0.1:3000"
  },
  // Desktop searches/installs OpenClaw skills directly from ClawHub (clawhub.ai).
  market: {
    directClawhubAllowed: true
  },
  // Empty = unset; first launch still defaults to 场景学习探索 via workspace-selection.
  brain: {
    selectedWorkspaceKey: ""
  },
  launchAtLogin: true,
  shortcuts: {}
  };
}
export function normalizeDesktopPreferencesValue(
  input: Partial<DesktopPreferences> | undefined,
  context: DesktopPreferencesNormalizationContext
): DesktopPreferences {
  const extraEnv =
    input?.environment?.extraEnv && typeof input.environment.extraEnv === "object"
      ? Object.fromEntries(
          Object.entries(input.environment.extraEnv)
            .map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : ""])
            .filter(([key]) => key)
        )
      : context.defaults.environment.extraEnv;
  const normalizeWorktreeRootDir = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed) {
      return context.defaults.worktree.rootDir;
    }
    const resolved = resolve(trimmed);
    const relativeToStateRoot = relative(context.workspaceStateRoot, resolved);
    if (
      context.isPackaged &&
      (relativeToStateRoot.startsWith("..") || isAbsolute(relativeToStateRoot))
    ) {
      return context.defaults.worktree.rootDir;
    }
    return resolved;
  };

  return {
    appearance: {
      theme:
        input?.appearance?.theme === "dark" || input?.appearance?.theme === "system"
          ? input.appearance.theme
          : context.defaults.appearance.theme,
      density: input?.appearance?.density === "compact" ? "compact" : context.defaults.appearance.density,
      reduceMotion:
        typeof input?.appearance?.reduceMotion === "boolean"
          ? input.appearance.reduceMotion
          : context.defaults.appearance.reduceMotion,
      accentColor: /^#[0-9a-f]{6}$/i.test(String(input?.appearance?.accentColor ?? "")) ? String(input?.appearance?.accentColor) : context.defaults.appearance.accentColor,
      backgroundColor: /^#[0-9a-f]{6}$/i.test(String(input?.appearance?.backgroundColor ?? "")) ? String(input?.appearance?.backgroundColor) : context.defaults.appearance.backgroundColor,
      foregroundColor: /^#[0-9a-f]{6}$/i.test(String(input?.appearance?.foregroundColor ?? "")) ? String(input?.appearance?.foregroundColor) : context.defaults.appearance.foregroundColor,
      uiFontFamily: String(input?.appearance?.uiFontFamily ?? "").trim() || context.defaults.appearance.uiFontFamily,
      codeFontFamily: String(input?.appearance?.codeFontFamily ?? "").trim() || context.defaults.appearance.codeFontFamily,
      contrast: Math.max(0, Math.min(100, Number(input?.appearance?.contrast ?? context.defaults.appearance.contrast) || context.defaults.appearance.contrast)),
      uiFontSize: Math.max(11, Math.min(28, Number(input?.appearance?.uiFontSize ?? context.defaults.appearance.uiFontSize) || context.defaults.appearance.uiFontSize)),
      codeFontSize: Math.max(10, Math.min(24, Number(input?.appearance?.codeFontSize ?? context.defaults.appearance.codeFontSize) || context.defaults.appearance.codeFontSize)),
      sidebarTranslucent: typeof input?.appearance?.sidebarTranslucent === "boolean" ? input.appearance.sidebarTranslucent : context.defaults.appearance.sidebarTranslucent,
      pointerCursor: typeof input?.appearance?.pointerCursor === "boolean" ? input.appearance.pointerCursor : context.defaults.appearance.pointerCursor,
      diffMarks: input?.appearance?.diffMarks === "marks" ? "marks" : context.defaults.appearance.diffMarks
    },
    configuration: {
      requireApprovalForShell:
        typeof input?.configuration?.requireApprovalForShell === "boolean"
          ? input.configuration.requireApprovalForShell
          : context.defaults.configuration.requireApprovalForShell,
      saveResponses:
        typeof input?.configuration?.saveResponses === "boolean"
          ? input.configuration.saveResponses
          : context.defaults.configuration.saveResponses,
      telemetryEnabled:
        typeof input?.configuration?.telemetryEnabled === "boolean"
          ? input.configuration.telemetryEnabled
          : context.defaults.configuration.telemetryEnabled
    },
    personalization: {
      workMode:
        input?.personalization?.workMode === "everyday"
          ? "everyday"
          : context.defaults.personalization.workMode,
      proactiveUpdates:
        typeof input?.personalization?.proactiveUpdates === "boolean"
          ? input.personalization.proactiveUpdates
          : context.defaults.personalization.proactiveUpdates,
      includeVerificationSummary:
        typeof input?.personalization?.includeVerificationSummary === "boolean"
          ? input.personalization.includeVerificationSummary
          : context.defaults.personalization.includeVerificationSummary,
      reviewFindingsFirst:
        typeof input?.personalization?.reviewFindingsFirst === "boolean"
          ? input.personalization.reviewFindingsFirst
          : context.defaults.personalization.reviewFindingsFirst,
      autoSkillEnabled:
        typeof input?.personalization?.autoSkillEnabled === "boolean"
          ? input.personalization.autoSkillEnabled
          : context.defaults.personalization.autoSkillEnabled
    },
    permissions: {
      fullAccess:
        typeof input?.permissions?.fullAccess === "boolean"
          ? input.permissions.fullAccess
          : context.defaults.permissions.fullAccess
    },
    hooks: {
      beforeCommand:
        typeof input?.hooks?.beforeCommand === "boolean"
          ? input.hooks.beforeCommand
          : context.defaults.hooks.beforeCommand,
      afterCommand:
        typeof input?.hooks?.afterCommand === "boolean"
          ? input.hooks.afterCommand
          : context.defaults.hooks.afterCommand,
      beforeCommit:
        typeof input?.hooks?.beforeCommit === "boolean"
          ? input.hooks.beforeCommit
          : context.defaults.hooks.beforeCommit,
      afterTask:
        typeof input?.hooks?.afterTask === "boolean" ? input.hooks.afterTask : context.defaults.hooks.afterTask,
      beforeCommandScript: input?.hooks?.beforeCommandScript?.trim() || "",
      afterCommandScript: input?.hooks?.afterCommandScript?.trim() || "",
      beforeCommitScript: input?.hooks?.beforeCommitScript?.trim() || "",
      afterTaskScript: input?.hooks?.afterTaskScript?.trim() || ""
    },
    git: {
      statusCommand: input?.git?.statusCommand?.trim() || context.defaults.git.statusCommand,
      branchPrefix: input?.git?.branchPrefix?.trim() || context.defaults.git.branchPrefix,
      showDiffBeforeCommit:
        typeof input?.git?.showDiffBeforeCommit === "boolean"
          ? input.git.showDiffBeforeCommit
          : context.defaults.git.showDiffBeforeCommit,
      confirmBeforePush:
        typeof input?.git?.confirmBeforePush === "boolean"
          ? input.git.confirmBeforePush
          : context.defaults.git.confirmBeforePush,
      pullRequestMergeMethod: input?.git?.pullRequestMergeMethod === "squash" ? "squash" : "merge",
      forcePushWithLease:
        typeof input?.git?.forcePushWithLease === "boolean"
          ? input.git.forcePushWithLease
          : context.defaults.git.forcePushWithLease,
      createDraftPullRequests:
        typeof input?.git?.createDraftPullRequests === "boolean"
          ? input.git.createDraftPullRequests
          : context.defaults.git.createDraftPullRequests,
      autoDeleteOldWorktrees:
        typeof input?.git?.autoDeleteOldWorktrees === "boolean"
          ? input.git.autoDeleteOldWorktrees
          : context.defaults.git.autoDeleteOldWorktrees,
      autoDeleteWorktreeLimit: Math.max(1, Math.min(100, Number(input?.git?.autoDeleteWorktreeLimit) || context.defaults.git.autoDeleteWorktreeLimit)),
      commitInstructions: String(input?.git?.commitInstructions ?? "")
    },
    environment: {
      defaultOpenTarget:
        input?.environment?.defaultOpenTarget === "system" || input?.environment?.defaultOpenTarget === "explorer"
          ? input.environment.defaultOpenTarget
          : context.defaults.environment.defaultOpenTarget,
      terminalShell: input?.environment?.terminalShell?.trim() || context.defaults.environment.terminalShell,
      extraEnv,
      autoBootstrapConda:
        typeof input?.environment?.autoBootstrapConda === "boolean"
          ? input.environment.autoBootstrapConda
          : context.defaults.environment.autoBootstrapConda
    },
    editor: {
      language:
        input?.editor?.language === "zh-CN" || input?.editor?.language === "en-US"
          ? input.editor.language
          : context.defaults.editor.language,
      sendShortcut: input?.editor?.sendShortcut === "mod-enter" ? "mod-enter" : context.defaults.editor.sendShortcut,
      followBehavior: input?.editor?.followBehavior === "guide" ? "guide" : context.defaults.editor.followBehavior
    },
    popup: {
      shortcut: String(input?.popup?.shortcut ?? "").trim(),
      defaultProjectlessChat:
        typeof input?.popup?.defaultProjectlessChat === "boolean"
          ? input.popup.defaultProjectlessChat
          : context.defaults.popup.defaultProjectlessChat
    },
    dictation: {
      microphone: input?.dictation?.microphone === "default" ? "default" : context.defaults.dictation.microphone,
      holdShortcut: String(input?.dictation?.holdShortcut ?? "").trim(),
      toggleShortcut: String(input?.dictation?.toggleShortcut ?? "").trim(),
      keepBarVisible:
        typeof input?.dictation?.keepBarVisible === "boolean"
          ? input.dictation.keepBarVisible
          : context.defaults.dictation.keepBarVisible,
      dictionaryOpen:
        typeof input?.dictation?.dictionaryOpen === "boolean"
          ? input.dictation.dictionaryOpen
          : context.defaults.dictation.dictionaryOpen,
      dictionaryEntries: Array.isArray(input?.dictation?.dictionaryEntries)
        ? input.dictation.dictionaryEntries
            .map((entry) => ({
              timestamp: String(entry?.timestamp ?? "").trim(),
              phrase: String(entry?.phrase ?? "").trim()
            }))
            .filter((entry) => entry.timestamp || entry.phrase)
        : context.defaults.dictation.dictionaryEntries
    },
    notifications: {
      turnComplete:
        input?.notifications?.turnComplete === "never" || input?.notifications?.turnComplete === "always"
          ? input.notifications.turnComplete
          : context.defaults.notifications.turnComplete,
      permission:
        typeof input?.notifications?.permission === "boolean"
          ? input.notifications.permission
          : context.defaults.notifications.permission,
      question:
        typeof input?.notifications?.question === "boolean"
          ? input.notifications.question
          : context.defaults.notifications.question
    },
    worktree: {
      defaultIsolated:
        typeof input?.worktree?.defaultIsolated === "boolean"
          ? input.worktree.defaultIsolated
          : context.defaults.worktree.defaultIsolated,
      keepArchived:
        typeof input?.worktree?.keepArchived === "boolean"
          ? input.worktree.keepArchived
          : context.defaults.worktree.keepArchived,
      rootDir: normalizeWorktreeRootDir(input?.worktree?.rootDir)
    },
    browser: normalizeBrowserUsePreferencesPartial(input?.browser as Partial<BrowserUsePreferences> | undefined, {
      ...DEFAULT_BROWSER_USE_PREFERENCES,
      ...context.defaults.browser
    } as BrowserUsePreferences),
    market: {
      // Default closed. Only an explicit true in saved prefs (or env override in service) reopens.
      directClawhubAllowed:
        typeof input?.market?.directClawhubAllowed === "boolean"
          ? input.market.directClawhubAllowed
          : context.defaults.market.directClawhubAllowed
    },
    brain: {
      selectedWorkspaceKey: isBrainWorkspaceKey(input?.brain?.selectedWorkspaceKey)
        ? input.brain.selectedWorkspaceKey
        : context.defaults.brain.selectedWorkspaceKey
    },
    launchAtLogin:
      typeof input?.launchAtLogin === "boolean"
        ? input.launchAtLogin
        : context.defaults.launchAtLogin,
    shortcuts:
      input?.shortcuts && typeof input.shortcuts === "object"
        ? Object.fromEntries(
            Object.entries(input.shortcuts)
              .map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : ""])
              .filter(([key, value]) => key && value)
          )
        : context.defaults.shortcuts
  };
}
