import type { WorkspaceArtifactPreview } from "@codex-forge/protocol";

type MusicPreview = Extract<WorkspaceArtifactPreview, { kind: "audio" }>;

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size >= 10_240 ? 0 : 1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkspaceMusicPlayer(props: { preview: MusicPreview }) {
  const previewUrl = String(props.preview.previewUrl || "");
  const mimeType = String(props.preview.mimeType || "audio/mpeg");
  return (
    <div className="workspace-artifact-music" data-testid="workspace-music-player">
      <div className="workspace-artifact-music__meta">
        <strong>{props.preview.name || "音频文件"}</strong>
        <span>{mimeType}{props.preview.size ? ` · ${formatFileSize(props.preview.size)}` : ""}</span>
      </div>
      <audio controls preload="metadata" src={previewUrl || undefined} />
      {!previewUrl ? <div className="search-file-preview-state error">媒体预览地址缺失。</div> : null}
    </div>
  );
}
