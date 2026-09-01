export interface BootstrapEnvironmentConfigItem {
  id: string;
  label?: string;
  enabled?: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
}

export interface BootstrapConfigFile {
  environments: BootstrapEnvironmentConfigItem[];
}

export interface DesktopBootstrapTaskDefinition {
  id: string;
  label: string;
  enabled: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
}

export type DesktopBootstrapTaskStatus = "pending" | "running" | "ready" | "manual_required";

export interface DesktopBootstrapTaskState {
  id: string;
  label: string;
  status: DesktopBootstrapTaskStatus;
  detail?: string;
  startedAt?: string;
  completedAt?: string;
}

interface BootstrapRuntimeState {
  status: DesktopBootstrapTaskStatus;
  updatedAt: string;
  reason?: string;
  version?: string;
}

export interface DesktopBootstrapStateFile {
  overall?: {
    status: DesktopBootstrapTaskStatus;
    currentTaskId?: string;
    message?: string;
    updatedAt: string;
  };
  tasks?: DesktopBootstrapTaskState[];
  conda?: BootstrapRuntimeState & { initializedAt?: string; source?: "system" | "managed"; condaPath?: string };
  python?: BootstrapRuntimeState & { pythonPath?: string };
  node?: BootstrapRuntimeState & { nodePath?: string; source?: "system" | "sandbox" | "managed" };
  projectDeps?: BootstrapRuntimeState & { packageManager?: "pnpm" | "npm"; installCwd?: string };
}

export const defaultBootstrapConfig: BootstrapConfigFile = {
  environments: [
    { id: "conda", label: "Conda 环境", enabled: true },
    { id: "python", label: "Python 运行时", enabled: true },
    { id: "node", label: "Node.js 运行时", enabled: true },
    { id: "project-deps", label: "项目依赖", enabled: true }
  ]
};

export function normalizeBootstrapConfig(
  parsed: Partial<BootstrapConfigFile>,
  fallback: BootstrapConfigFile = defaultBootstrapConfig
): BootstrapConfigFile {
  const environments = Array.isArray(parsed.environments)
    ? parsed.environments
        .map((item) => ({
          id: typeof item?.id === "string" ? item.id.trim() : "",
          label: typeof item?.label === "string" ? item.label.trim() : undefined,
          enabled: item?.enabled !== false,
          command: typeof item?.command === "string" ? item.command.trim() : undefined,
          args: Array.isArray(item?.args) ? item.args.filter((arg): arg is string => typeof arg === "string") : undefined,
          cwd: typeof item?.cwd === "string" ? item.cwd.trim() : undefined
        }))
        .filter((item) => item.id)
    : [];
  return environments.length > 0 ? { environments } : fallback;
}

export function createBootstrapTaskDefinitions(config: BootstrapConfigFile): DesktopBootstrapTaskDefinition[] {
  return config.environments
    .filter((item) => item.enabled !== false)
    .map((item) => ({
      id: item.id,
      label: item.label?.trim() || item.id,
      enabled: item.enabled !== false,
      command: item.command,
      args: item.args,
      cwd: item.cwd
    }));
}

export function mergeBootstrapTaskStates(
  definitions: DesktopBootstrapTaskDefinition[],
  state?: DesktopBootstrapStateFile | null
): DesktopBootstrapTaskState[] {
  const existingTasks = Array.isArray(state?.tasks) ? state.tasks : [];
  return definitions.map((definition) => {
    const existing = existingTasks.find((task) => task.id === definition.id);
    const runtime = definition.id === "conda" ? state?.conda
      : definition.id === "python" ? state?.python
        : definition.id === "node" ? state?.node
          : definition.id === "project-deps" ? state?.projectDeps
            : undefined;
    const runtimeStatus = runtime?.status === "ready" || runtime?.status === "manual_required" ? runtime.status : undefined;
    const status = definition.id === "node"
      ? existing?.status ?? runtimeStatus ?? "pending"
      : runtimeStatus ?? existing?.status ?? "pending";
    const runtimeDetail = runtime?.reason ?? (definition.id === "python" || definition.id === "node" ? runtime?.version : undefined);
    const detail = definition.id === "node" ? existing?.detail ?? runtimeDetail : runtimeDetail ?? existing?.detail;
    return {
      id: definition.id,
      label: definition.label,
      status,
      detail,
      startedAt: existing?.startedAt,
      completedAt: existing?.completedAt ?? runtime?.updatedAt
    };
  });
}

export function createBootstrapStatusPayload(
  state: DesktopBootstrapStateFile | null | undefined,
  tasks: DesktopBootstrapTaskState[]
) {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((task) => task.status === "ready" || task.status === "manual_required").length;
  const progressPercent = totalTasks === 0 ? 100 : Math.round((completedTasks / totalTasks) * 100);
  const hasRunning = tasks.some((task) => task.status === "running");
  const hasPending = tasks.some((task) => task.status === "pending");
  const hasManualRequired = tasks.some((task) => task.status === "manual_required");
  const status: DesktopBootstrapTaskStatus = hasRunning || hasPending
    ? (hasRunning ? "running" : "pending")
    : hasManualRequired ? "manual_required" : "ready";
  return {
    overall: {
      status,
      currentTaskId: state?.overall?.currentTaskId,
      message: state?.overall?.message,
      updatedAt: state?.overall?.updatedAt ?? state?.conda?.updatedAt,
      totalTasks,
      completedTasks,
      progressPercent
    },
    tasks,
    conda: {
      status: state?.conda?.status ?? "pending" as const,
      initializedAt: state?.conda?.initializedAt,
      updatedAt: state?.conda?.updatedAt,
      source: state?.conda?.source,
      condaPath: state?.conda?.condaPath,
      reason: state?.conda?.reason
    }
  };
}
