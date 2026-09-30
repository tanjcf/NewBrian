export interface VideoVoiceRole {
  id: string;
  name: string;
  description: string;
  reason: string;
  candidates: string[];
  voiceId: string;
  confirmed: boolean;
}
export interface VideoVoiceLine {
  id: string;
  shotId: string;
  roleId: string;
  text: string;
  direction: string;
}
export interface VideoVoiceVersion {
  id: string;
  lineId: string;
  text: string;
  voiceId: string;
  provider: string;
  relativePath: string;
  createdAt: string;
}
export interface VideoVoiceCasting {
  roles: VideoVoiceRole[];
  lines: VideoVoiceLine[];
  versions: VideoVoiceVersion[];
  accepted: Record<string, string>;
  source: string;
}
export interface VideoVoiceAnalysisInput {
  script: string;
  shots: Array<{ id: string; line: string; title: string }>;
  preference?: string;
}
