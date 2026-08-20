import { useEffect, useMemo, useState } from "react";

type Clip = { id: string; trackType: "video" | "audio" | "subtitle"; sourceFileId: string; startMs: number; durationMs: number; text?: string };

export function VideoWorkspace({ projectId, files = [] }: { projectId?: string; files?: Array<{ id: string; relativePath?: string; originalName?: string }> }) {
  const [timeline, setTimeline] = useState<any>(null);
  const [status, setStatus] = useState("正在加载时间线");
  const [selectedFile, setSelectedFile] = useState(files[0]?.id || "");
  const load = () => {
    if (!projectId || !window.codecn?.getVideoTimeline) { setStatus("请选择视频项目"); return; }
    setStatus("正在加载时间线");
    void window.codecn.getVideoTimeline({ projectId }).then((value: any) => { setTimeline(value); setStatus("时间线已保存"); }).catch(() => setStatus("尚未创建时间线"));
  };
  useEffect(() => { void load(); }, [projectId]);
  const clips: Clip[] = timeline?.clips || [];
  const duration = Math.max(Number(timeline?.durationMs || 0), 10_000);
  const addClip = () => {
    if (!projectId || !selectedFile || !window.codecn?.addVideoClip) { setStatus("请先选择项目文件"); return; }
    void window.codecn.addVideoClip({ projectId, trackType: "video", sourceFileId: selectedFile, startMs: Number(timeline?.durationMs || 0), durationMs: 5_000, sourceInMs: 0 })
      .then((value: any) => { setTimeline(value); setStatus("片段已加入时间线"); }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "片段添加失败"));
  };
  const grouped = useMemo(() => (["video", "audio", "subtitle"] as const).map((trackType) => ({ trackType, clips: clips.filter((clip) => clip.trackType === trackType) })), [clips]);
  return <main className="brain-video-module">
    <header className="brain-video-header"><div><span>视频制作</span><strong>{timeline?.title || "未命名时间线"}</strong></div><small>{status} · 渲染前需要审批</small></header>
    <section className="brain-video-toolbar"><select value={selectedFile} onChange={(event) => setSelectedFile(event.target.value)}><option value="">选择项目文件</option>{files.map((file) => <option key={file.id} value={file.id}>{file.originalName || file.relativePath || file.id}</option>)}</select><button type="button" onClick={addClip}>加入片段</button><button type="button" onClick={load}>刷新</button></section>
    <section className="brain-video-preview"><div className="brain-video-preview-empty"><span>16:9</span><strong>预览区</strong><small>添加视频片段后将在这里预览</small></div></section>
    <section className="brain-video-timeline"><header><strong>时间线</strong><span>{timeline?.width || 1920}×{timeline?.height || 1080} · {timeline?.fps || 30} fps · {Math.round(duration / 1000)} 秒</span></header>{grouped.map(({ trackType, clips: trackClips }) => <div className="brain-video-track" key={trackType}><label>{trackType === "video" ? "视频" : trackType === "audio" ? "音频" : "字幕"}</label><div className="brain-video-track-lane">{trackClips.map((clip) => <div className="brain-video-clip" key={clip.id} style={{ left: `${clip.startMs / duration * 100}%`, width: `${Math.max(4, clip.durationMs / duration * 100)}%` }} title={clip.sourceFileId}>{clip.text || clip.sourceFileId}</div>)}</div></div>)}</section>
  </main>;
}
