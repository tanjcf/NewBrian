export const brainWorkspaceKeys = [
  "quant",
  "game",
  "video",
  "music",
  "data",
  "software",
  "document"
] as const;

export type BrainWorkspaceKey = (typeof brainWorkspaceKeys)[number];

export interface BrainWorkspaceDto {
  workspaceKey: BrainWorkspaceKey;
  displayName: string;
  enabled: boolean;
  capabilities: string[];
  defaultModelRoute: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrainProjectDto {
  id: string;
  name: string;
  primaryWorkspaceKey: BrainWorkspaceKey;
  status: "ACTIVE" | "ARCHIVED";
  lastConversationId: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
}

export interface BrainConversationDto {
  id: string;
  projectId: string;
  title: string;
  workspaceSnapshot: BrainWorkspaceKey;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

export interface BrainMessageDto {
  id: string;
  conversationId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallsJson: string;
  sourceRefsJson: string;
  requestId: string;
  createdAt: string;
}

export interface BrainProjectListInput {
  workspaceKey?: BrainWorkspaceKey;
  includeArchived?: boolean;
}

export interface BrainProjectCreateInput {
  name: string;
  primaryWorkspaceKey: BrainWorkspaceKey;
}

export interface BrainProjectGetInput { projectId: string }

export interface BrainProjectUpdateInput extends BrainProjectGetInput {
  name?: string;
  status?: "ACTIVE" | "ARCHIVED";
}

export interface BrainProjectWorkspaceInput extends BrainProjectGetInput {
  workspaceKey: BrainWorkspaceKey;
  enabled: boolean;
}

export interface BrainConversationCreateInput extends BrainProjectGetInput {
  title: string;
  workspaceKey?: BrainWorkspaceKey;
}

export interface BrainConversationGetInput { conversationId: string }

export interface BrainMessageAppendInput extends BrainConversationGetInput {
  role: BrainMessageDto["role"];
  content: string;
  toolCallsJson?: string;
  sourceRefsJson?: string;
  requestId?: string;
}

export interface BrainDraftSaveInput extends BrainConversationGetInput, BrainProjectGetInput {
  content: string;
}

export const brainWorkspaceIpcChannels = {
  workspaceList: "brain:workspace:list",
  projectList: "brain:project:list",
  projectCreate: "brain:project:create",
  projectGet: "brain:project:get",
  projectUpdate: "brain:project:update",
  projectWorkspaceEnable: "brain:project:workspace-enable",
  conversationCreate: "brain:conversation:create",
  conversationGet: "brain:conversation:get",
  messageList: "brain:message:list",
  messageAppend: "brain:message:append",
  draftGet: "brain:draft:get",
  draftSave: "brain:draft:save"
} as const;
