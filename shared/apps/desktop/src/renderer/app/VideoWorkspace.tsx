import { useEffect, useMemo, useRef, useState } from "react";
import { ProjectFilePicker, type ProjectFileOption } from "./ProjectFilePicker";

type Clip = { id: string; trackType: "video" | "audio" | "subtitle"; sourceFileId: string; startMs: number; durationMs: number; text?: string };

export function VideoWorkspace({
  projectId,
  files = [],
  selectedFileId = "",
  onSelectFile,
  activeView = "media"
}: {
  projectId?: string;
  files?: ProjectFileOption[];
  selectedFileId?: string;
  onSelectFile?: (fileId: string) => void;
  activeView?: "media" | "timeline" | "export";
}) {
  const [timeline, setTimeline] = useState<any>(null);
  const [status, setStatus] = useState("正在加载时间线");
  const [localFileId, setLocalFileId] = useState(selectedFileId || files[0]?.id || "");
  const [render, setRender] = useState<any>();
  const loadGeneration = useRef(0);
  const selectedFile = onSelectFile ? selectedFileId : localFileId;
  const setSelectedFile = (fileId: string) => {
    if (onSelectFile) onSelectFile(fileId);
    else setLocalFileId(fileId);
  };

  const load = () => {
    if (!projectId || !window.newbrain?.getVideoTimeline) { setStatus("请选择视频项目"); return; }
    const generation = ++loadGeneration.current;
    setStatus("正在加载时间线");
    void window.newbrain.getVideoTimeline({ projectId }).then((value: any) => {
      if (generation !== loadGeneration.current) return;
      setTimeline(value);
      setStatus("时间线已保存");
    }).catch(() => {
      if (generation !== loadGeneration.current) return;
      setStatus("尚未创建时间线");
    });
  };

  useEffect(() => { void load(); }, [projectId]);
  useEffect(() => {
    if (onSelectFile) return;
    if (!localFileId && files[0]?.id) setLocalFileId(files[0].id);
  }, [files, localFileId, onSelectFile]);
  useEffect(() => {
    if (!render?.renderId || !window.newbrain?.getVideoRenderStatus || ["SUCCEEDED", "FAILED", "CANCELLED"].includes(render.status)) return;
    const timer = window.setInterval(() => void window.newbrain?.getVideoRenderStatus?.({ renderId: render.renderId }).then((value: any) => {
      setRender(value);
      if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(value.status)) setStatus(`视频渲染${value.status === "SUCCEEDED" ? "完成" : `结束：${value.status}`}`);
    }), 1000);
    return () => window.clearInterval(timer);
  }, [render?.renderId, render?.status]);

  const clips: Clip[] = timeline?.clips || [];
  const duration = Math.max(Number(timeline?.durationMs || 0), 10_000);
  const addClip = () => {
    if (!projectId || !selectedFile || !window.newbrain?.addVideoClip) { setStatus("请先选择项目文件"); return; }
    loadGeneration.current += 1;
    setStatus("正在加入片段");
    void window.newbrain.addVideoClip({ projectId, trackType: "video", sourceFileId: selectedFile, startMs: Number(timeline?.durationMs || 0), durationMs: 5_000, sourceInMs: 0 })
      .then((value: any) => { setTimeline(value); setStatus("片段已加入时间线"); })
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "片段添加失败"));
  };
  const startRender = async () => {
    if (!projectId || !window.newbrain?.startVideoRender) return;
    try { const value = await window.newbrain.startVideoRender({ projectId, outputRelativePath: "renders/output.mp4" }); setRender(value); setStatus("视频渲染中"); }
    catch (error) { setStatus(error instanceof Error ? error.message : "视频渲染失败"); }
  };
  const cancelRender = async () => {
    if (!render?.renderId || !window.newbrain?.cancelVideoRender) return;
    try { const value = await window.newbrain.cancelVideoRender({ renderId: render.renderId }); setRender(value); setStatus("视频渲染已取消"); }
    catch (error) { setStatus(error instanceof Error ? error.message : "取消渲染失败"); }
  };
  const grouped = useMemo(() => (["video", "audio", "subtitle"] as const).map((trackType) => ({ trackType, clips: clips.filter((clip) => clip.trackType === trackType) })), [clips]);
  return <main className="brain-video-module" data-testid="brain-video-workspace">
    <header className="brain-video-header"><div><span>视频制作</span><strong>{activeView === "media" ? "项目与素材" : activeView === "timeline" ? timeline?.title || "未命名时间线" : "视频导出"}</strong></div><small data-testid="brain-video-status">{status} · 渲染前需要审批</small></header>
    <section className="brain-video-toolbar">
      {activeView === "media" ? <ProjectFilePicker testId="brain-video-file-select" files={files} value={selectedFile} onChange={setSelectedFile} /> : null}
      {activeView === "media" ? <button type="button" data-testid="brain-video-add-clip" onClick={addClip}>加入时间线</button> : null}
      <button type="button" onClick={load}>刷新</button>
      {activeView === "export" ? <button type="button" data-testid="brain-video-render" onClick={() => void startRender()} disabled={!clips.some((clip) => clip.trackType === "video")}>渲染视频</button> : null}
      {activeView === "export" && render && ["STARTING", "RUNNING"].includes(render.status) ? <button type="button" data-testid="brain-video-cancel" onClick={() => void cancelRender()}>取消渲染</button> : null}
    </section>
    {activeView === "export" ? <section className="brain-video-preview" data-testid="brain-video-preview">
      {render?.status === "SUCCEEDED" ? (
        <div className="brain-video-preview-result" data-testid="brain-video-preview-result">
          <span>16:9</span>
          <strong>渲染预览就绪</strong>
          <small>{render.outputPath}</small>
          <em data-testid="brain-video-output-file-id">{render.outputFileId || "无产物编号"}</em>
        </div>
      ) : (
        <div className="brain-video-preview-empty"><span>16:9</span><strong>预览区</strong><small>添加视频片段后将在这里预览</small></div>
      )}
    </section> : null}
    {activeView === "media" ? <section className="brain-media-file-list">{files.length ? files.map((file) => <button type="button" key={file.id} className={selectedFile === file.id ? "active" : ""} onClick={() => setSelectedFile(file.id)}><strong>{file.logicalName || file.originalName || file.id}</strong><small>{file.relativePath || file.storageKey || "项目素材"}</small></button>) : <div className="brain-resource-empty">项目还没有可用素材，请先从“文件”导入。</div>}</section> : null}
    {activeView === "timeline" ? <section className="brain-video-timeline"><header><strong>时间线</strong><span data-testid="brain-video-timeline-meta">{timeline?.width || 1920}×{timeline?.height || 1080} · {timeline?.fps || 30} fps · {Math.round(duration / 1000)} 秒{render ? ` · 渲染：${render.status}` : ""}</span></header>{grouped.map(({ trackType, clips: trackClips }) => <div className="brain-video-track" key={trackType}><label>{trackType === "video" ? "视频" : trackType === "audio" ? "音频" : "字幕"}</label><div className="brain-video-track-lane">{trackClips.map((clip) => <div className="brain-video-clip" key={clip.id} style={{ left: `${clip.startMs / duration * 100}%`, width: `${Math.max(4, clip.durationMs / duration * 100)}%` }} title={clip.sourceFileId}>{clip.text || clip.sourceFileId}</div>)}</div></div>)}</section> : null}
  </main>;
}
