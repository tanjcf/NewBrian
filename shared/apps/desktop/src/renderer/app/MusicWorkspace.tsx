import { useEffect, useMemo, useState } from "react";
import { ProjectFilePicker, type ProjectFileOption } from "./ProjectFilePicker";

type Clip = { id: string; trackType: "audio" | "midi"; sourceFileId: string; startMs: number; durationMs: number };

export function MusicWorkspace({
  projectId,
  files = [],
  selectedFileId = "",
  onSelectFile,
  activeView = "audio"
}: {
  projectId?: string;
  files?: ProjectFileOption[];
  selectedFileId?: string;
  onSelectFile?: (fileId: string) => void;
  activeView?: "audio" | "tracks" | "export";
}) {
  const [timeline, setTimeline] = useState<any>();
  const [localFileId, setLocalFileId] = useState(selectedFileId || files[0]?.id || "");
  const [status, setStatus] = useState("正在加载音乐时间线");
  const [render, setRender] = useState<any>();
  const [mediaInfo, setMediaInfo] = useState<{ durationMs?: number; sampleRate?: number } | null>(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState("");
  const [mixPreviewUrl, setMixPreviewUrl] = useState("");
  const selectedFile = onSelectFile ? selectedFileId : localFileId;
  const setSelectedFile = (fileId: string) => {
    if (onSelectFile) onSelectFile(fileId);
    else setLocalFileId(fileId);
  };

  const load = async () => {
    if (!projectId || !window.newbrain?.getMusicTimeline) { setStatus("请选择音乐项目"); return; }
    try { setTimeline(await window.newbrain.getMusicTimeline({ projectId })); setStatus("时间线已加载"); }
    catch { setStatus("尚未创建音乐时间线"); }
  };
  useEffect(() => { void load(); }, [projectId]);
  useEffect(() => {
    if (onSelectFile) return;
    if (!localFileId && files[0]?.id) setLocalFileId(files[0].id);
  }, [files, localFileId, onSelectFile]);
  useEffect(() => {
    if (!projectId || !selectedFile || activeView !== "audio" || !window.newbrain?.getBrainFilePreviewUrl) {
      setSourcePreviewUrl("");
      return;
    }
    void window.newbrain.getBrainFilePreviewUrl({ projectId, fileId: selectedFile })
      .then((url) => setSourcePreviewUrl(url))
      .catch(() => setSourcePreviewUrl(""));
  }, [projectId, selectedFile, activeView]);
  useEffect(() => {
    if (!projectId || !render?.outputFileId || render.status !== "SUCCEEDED" || !window.newbrain?.getBrainFilePreviewUrl) {
      setMixPreviewUrl("");
      return;
    }
    void window.newbrain.getBrainFilePreviewUrl({ projectId, fileId: render.outputFileId })
      .then((url) => setMixPreviewUrl(url))
      .catch(() => setMixPreviewUrl(""));
  }, [projectId, render?.outputFileId, render?.status]);
  useEffect(() => {
    if (!render?.renderId || !window.newbrain?.getMusicRenderStatus || ["SUCCEEDED", "FAILED", "CANCELLED"].includes(render.status)) return;
    const timer = window.setInterval(() => void window.newbrain.getMusicRenderStatus({ renderId: render.renderId }).then((value: any) => {
      setRender(value);
      if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(value.status)) setStatus(`音乐渲染${value.status === "SUCCEEDED" ? "完成" : `结束：${value.status}`}`);
    }), 1000);
    return () => window.clearInterval(timer);
  }, [render?.renderId, render?.status]);
  useEffect(() => {
    if (!projectId || !render?.outputFileId || render.status !== "SUCCEEDED" || !window.newbrain?.inspectMusicMedia) return;
    void window.newbrain.inspectMusicMedia({ projectId, sourceFileId: render.outputFileId })
      .then((info) => setMediaInfo(info))
      .catch(() => setMediaInfo(null));
  }, [projectId, render?.outputFileId, render?.status]);

  const clips: Clip[] = timeline?.clips || [];
  const duration = Math.max(Number(timeline?.durationMs || 0), 10_000);
  const tracks = useMemo(() => (["audio", "midi"] as const).map((type) => ({ type, clips: clips.filter((clip) => clip.trackType === type) })), [clips]);
  const add = async (trackType: "audio" | "midi") => {
    if (!projectId || !selectedFile || !window.newbrain?.addMusicClip) { setStatus("请先选择项目文件"); return; }
    try {
      setTimeline(await window.newbrain.addMusicClip({
        projectId, trackType, sourceFileId: selectedFile, startMs: Number(timeline?.durationMs || 0),
        durationMs: 5_000, sourceInMs: 0, gain: 1, pan: 0
      }));
      setStatus(`${trackType === "audio" ? "音频" : "MIDI"}片段已加入`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "片段添加失败");
    }
  };
  const renderMix = async () => {
    if (!projectId || !window.newbrain?.startMusicRender) return;
    try { setRender(await window.newbrain.startMusicRender({ projectId, outputRelativePath: "renders/mix-output.wav" })); setStatus("音乐渲染中"); }
    catch (error) { setStatus(error instanceof Error ? error.message : "音乐渲染失败"); }
  };

  return (
    <main className="brain-video-module brain-music-module" data-testid="brain-music-workspace">
      <header className="brain-video-header">
        <div><span>音乐创作</span><strong>{activeView === "audio" ? "项目与音频" : activeView === "tracks" ? timeline?.title || "未命名音乐项目" : "混音导出"}</strong></div>
        <small data-testid="brain-music-status">{status} · 渲染前需要审批</small>
      </header>
      <section className="brain-video-toolbar">
        {activeView === "audio" ? <ProjectFilePicker testId="brain-music-file-select" files={files} value={selectedFile} onChange={setSelectedFile} /> : null}
        {activeView === "audio" ? <button type="button" data-testid="brain-music-add-audio" onClick={() => void add("audio")}>加入音频</button> : null}
        {activeView === "audio" ? <button type="button" onClick={() => void add("midi")}>加入 MIDI</button> : null}
        <button type="button" onClick={() => void load()}>刷新</button>
        {activeView === "export" ? <button type="button" data-testid="brain-music-render" onClick={() => void renderMix()}>渲染混音</button> : null}
        {activeView === "export" && render && ["STARTING", "RUNNING"].includes(render.status)
          ? <button type="button" data-testid="brain-music-cancel" onClick={() => void window.newbrain.cancelMusicRender?.({ renderId: render.renderId })}>取消渲染</button>
          : null}
      </section>
      {activeView === "export" ? <section className="brain-music-info" data-testid="brain-music-preview">
        <span>采样率 {timeline?.sampleRate || 48_000} Hz</span>
        <span>{timeline?.channels === 1 ? "单声道" : "双声道"}</span>
        <span data-testid="brain-music-render-state">{render ? `渲染状态：${render.status}` : "波形/MIDI 产物将在渲染后显示"}</span>
          {render?.status === "SUCCEEDED" ? <>
          <strong data-testid="brain-music-preview-result">混音预览就绪 · {render.outputPath}</strong>
          <em data-testid="brain-music-output-file-id">{render.outputFileId || "无产物编号"}</em>
          {mediaInfo?.waveform?.length ? <div className="brain-music-waveform" data-testid="brain-music-waveform">{mediaInfo.waveform.slice(0, 64).map((sample, index) => <span key={index} style={{ height: `${Math.max(2, Math.abs(sample) * 100)}%` }} />)}</div> : null}
          <span data-testid="brain-music-media-info">时长 {Math.round((mediaInfo?.durationMs ?? timeline?.durationMs ?? 0) / 1000)} 秒 · {mediaInfo?.sampleRate ?? timeline?.sampleRate ?? 48_000} Hz</span>
          {render.outputPath ? <audio controls preload="metadata" data-testid="brain-music-audio-preview" src={mixPreviewUrl || undefined} /> : null}
        </> : null}
      </section> : null}
      {activeView === "audio" ? <section className="brain-media-file-list">{files.length ? files.map((file) => <button type="button" key={file.id} className={selectedFile === file.id ? "active" : ""} onClick={() => setSelectedFile(file.id)}><strong>{file.logicalName || file.originalName || file.id}</strong><small>{file.relativePath || file.storageKey || "项目音频"}</small></button>) : <div className="brain-resource-empty">项目还没有音频或 MIDI，请先从“文件”导入。</div>}</section> : null}
      {activeView === "audio" && sourcePreviewUrl ? <section className="brain-music-source-preview" data-testid="brain-music-source-preview"><strong>源文件试听</strong><audio controls preload="metadata" src={sourcePreviewUrl} /></section> : null}
      {activeView === "tracks" ? <section className="brain-video-timeline">
        <header><strong>音乐时间线</strong><span>{Math.round(duration / 1000)} 秒</span></header>
        {tracks.map(({ type, clips: trackClips }) => (
          <div className="brain-video-track" key={type}>
            <label>{type === "audio" ? "音频" : "MIDI"}</label>
            <div className="brain-video-track-lane">
              {trackClips.map((clip) => (
                <div className="brain-video-clip" key={clip.id} style={{ left: `${clip.startMs / duration * 100}%`, width: `${Math.max(4, clip.durationMs / duration * 100)}%` }}>
                  {clip.sourceFileId}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section> : null}
    </main>
  );
}
