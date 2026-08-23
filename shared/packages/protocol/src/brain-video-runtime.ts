/**
 * BRAIN Video Runtime v1 — protocol contract (video scene sub-architecture).
 * Architecture: docs/architecture/brain-video-runtime-v1.md
 */

export const BRAIN_VIDEO_RUNTIME_VERSION = "brain-video-runtime-v1" as const;

export const brainVideoCoreOperations = {
  inspect: "video.inspect",
  probe: "video.probe",
  pipelineGet: "video.pipeline_get",
  pipelineSave: "video.pipeline_save",
  markShot: "video.mark_shot",
  cook: "video.cook",
  render: "video.render",
  subtitleShift: "video.subtitle_shift"
} as const;

export type BrainVideoCoreOperation =
  (typeof brainVideoCoreOperations)[keyof typeof brainVideoCoreOperations];

export const brainVideoDesignSectionKeys = ["script", "storyboard", "caption"] as const;
export type BrainVideoDesignSectionKey = (typeof brainVideoDesignSectionKeys)[number];

export interface BrainVideoShot {
  title: string;
  line: string;
  prompt: string;
  clip: string;
  ready: boolean;
  transition: string;
}

export interface BrainVideoPipelineState {
  schemaVersion?: number;
  pipeline?: typeof BRAIN_VIDEO_RUNTIME_VERSION;
  script: string;
  shots: BrainVideoShot[];
  exportFormat: string;
}

export interface BrainVideoPipelineSavePayload {
  state: BrainVideoPipelineState;
}

export interface BrainVideoMarkShotPayload {
  shot_index: number;
  ready: boolean;
}

export const brainVideoCookedPaths = {
  metaDir: ".brain-video",
  manifestFile: ".brain-video/manifest.json",
  pipelineFile: ".brain-video/pipeline.json",
  pipelineEditorFile: ".brain-video/pipeline-editor.json",
  docsRoot: "Docs/BRAIN",
  scriptDoc: "Docs/BRAIN/script.md",
  storyboardDoc: "Docs/BRAIN/storyboard.json",
  subtitlesDoc: "Docs/BRAIN/subtitles.srt",
  exportsDir: "exports"
} as const;

export interface BrainVideoCookPayload {
  script?: string;
  shots?: BrainVideoShot[];
}

export interface BrainVideoCookResult {
  pipeline: typeof BRAIN_VIDEO_RUNTIME_VERSION;
  docsRoot: string;
  exportedFiles: string[];
  manifestPath: string;
}

export function requiresVideoCoreApproval(operation: BrainVideoCoreOperation): boolean {
  return operation !== brainVideoCoreOperations.inspect
    && operation !== brainVideoCoreOperations.probe
    && operation !== brainVideoCoreOperations.pipelineGet;
}
