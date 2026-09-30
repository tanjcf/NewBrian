export type BrainSoftwareTaskStatus = "PENDING" | "AWAITING_APPROVAL" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type BrainSoftwareOperation = "test" | "build" | "format" | "lint" | "deploy" | "run-script";
export interface BrainSoftwareTaskRequest { projectId: string; conversationId?: string; operation: BrainSoftwareOperation; scriptId: string; args: string[]; maxOutputBytes: number; }
export interface BrainSoftwareTaskState { schemaVersion: 1; id: string; projectId: string; operation: BrainSoftwareOperation; scriptId: string; status: BrainSoftwareTaskStatus; requestId: string; startedAt: string; finishedAt: string; errorCode: string; output: string; artifactIds: string[]; }
export interface BrainSoftwareScript { id: string; label: string; operation: BrainSoftwareOperation; executable: string; args: string[]; cwd: string; source: "package-json" | "workspace-config"; }
