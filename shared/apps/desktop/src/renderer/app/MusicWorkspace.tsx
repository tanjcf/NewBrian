import { useEffect, useMemo, useState } from "react";
import { ProjectFilePicker, type ProjectFileOption } from "./ProjectFilePicker";

type Clip = { id: string; trackType: "audio" | "midi"; sourceFileId: string; startMs: number; durationMs: number };

export function MusicWorkspace({
  projectId,
  files = [],
  selectedFileId = "",
  onSelectFile
}: {
  projectId?: string;
  files?: ProjectFileOption[];
  selectedFileId?: string;
  onSelectFile?: (fileId: string) => void;
}) {
  const [timeline, setTimeline] = useState<any>();
  const [localFileId, setLocalFileId] = useState(selectedFileId || files[0]?.id || "");
  const [status, setStatus] = useState("正在加载音乐时间线");
  const [render, setRender] = useState<any>();
  const selectedFile = onSelectFile ? selectedFileId : localFileId;
  const setSelectedFile = (fileId: string) => {
    if (onSelectFile) onSelectFile(fileId);
    else setLocalFileId(fileId);
  };

  const load = async () => {
    if (!projectId || !window.codecn?.getMusicTimeline) { setStatus("请选择音乐项目"); return; }
    try { setTimeline(await window.codecn.getMusicTimeline({ projectId })); setStatus("时间线已加载"); }
    catch { setStatus("尚未创建音乐时间线"); }
  };
  useEffect(() => { void load(); }, [projectId]);
  useEffect(() => {
    if (onSelectFile) return;
    if (!localFileId && files[0]?.id) setLocalFileId(files[0].id);
  }, [files, localFileId, onSelectFile]);
  useEffect(() => {
    if (!render?.renderId || !window.codecn?.getMusicRenderStatus || ["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(render.status)) return;
    const timer = window.setInterval(() => void window.codecn.getMusicRenderStatus({ renderId: render.renderId }).then((value: any) => {
      setRender(value);
      if (["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(value.status)) setStatus(`音乐渲染${value.status === "SUCCEEDED" ? "完成" : `结束：${value.status}`}`);
    }), 1000);
    return () => window.clearInterval(timer);
  }, [render?.renderId, render?.status]);

  const clips: Clip[] = timeline?.clips || [];
  const duration = Math.max(Number(timeline?.durationMs || 0), 10_000);
  const tracks = useMemo(() => (["audio", "midi"] as const).map((type) => ({ type, clips: clips.filter((clip) => clip.trackType === type) })), [clips]);
  const add = async (trackType: "audio" | "midi") => {
    if (!projectId || !selectedFile || !window.codecn?.addMusicClip) { setStatus("请先选择项目文件"); return; }
    try {
      setTimeline(await window.codecn.addMusicClip({
        projectId, trackType, sourceFileId: selectedFile, startMs: Number(timeline?.durationMs || 0),
        durationMs: 5_000, sourceInMs: 0, gain: 1, pan: 0
      }));
      setStatus(`${trackType === "audio" ? "音频" : "MIDI"}片段已加入`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "片段添加失败");
    }
  };
  const renderMix = async () => {
    if (!projectId || !window.codecn?.startMusicRender) return;
    try { setRender(await window.codecn.startMusicRender({ projectId, outputRelativePath: "renders/mix-output.wav" })); setStatus("音乐渲染中"); }
    catch (error) { setStatus(error instanceof Error ? error.message : "音乐渲染失败"); }
  };

  return (
    <main className="brain-video-module brain-music-module" data-testid="brain-music-workspace">
      <header className="brain-video-header">
        <div><span>音乐创作</span><strong>{timeline?.title || "未命名音乐项目"}</strong></div>
        <small data-testid="brain-music-status">{status} · 渲染前需要审批</small>
      </header>
      <section className="brain-video-toolbar">
        <ProjectFilePicker testId="brain-music-file-select" files={files} value={selectedFile} onChange={setSelectedFile} />
        <button type="button" data-testid="brain-music-add-audio" onClick={() => void add("audio")}>加入音频</button>
        <button type="button" onClick={() => void add("midi")}>加入 MIDI</button>
        <button type="button" onClick={() => void load()}>刷新</button>
        <button type="button" data-testid="brain-music-render" onClick={() => void renderMix()}>渲染混音</button>
        {render && ["STARTING", "RUNNING"].includes(render.status)
          ? <button type="button" data-testid="brain-music-cancel" onClick={() => void window.codecn.cancelMusicRender?.({ renderId: render.renderId })}>取消渲染</button>
          : null}
      </section>
      <section className="brain-music-info" data-testid="brain-music-preview">
        <span>采样率 {timeline?.sampleRate || 48_000} Hz</span>
        <span>{timeline?.channels === 1 ? "单声道" : "双声道"}</span>
        <span data-testid="brain-music-render-state">{render ? `渲染状态：${render.status}` : "波形/MIDI 产物将在渲染后显示"}</span>
        {render?.status === "SUCCEEDED" ? <strong data-testid="brain-music-preview-result">混音预览就绪 · {render.outputPath}</strong> : null}
      </section>
      <section className="brain-video-timeline">
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
      </section>
    </main>
  );
}
