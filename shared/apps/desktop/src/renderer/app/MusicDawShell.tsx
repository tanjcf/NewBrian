import { useEffect, useState } from "react";
import type { BrainMusicDawState } from "@codex-forge/protocol/brain-music-runtime";

export type MusicDawStep = "gen" | "tracks" | "slice" | "export";

export type MusicDawShellProps = {
  projectId?: string;
  activeStep?: MusicDawStep;
  /** Bumps when Agent tools write DAW state so the right Tools panel reloads. */
  refreshToken?: number;
};

type Track = {
  id: string;
  name: string;
  clip: string;
  start: number;
  width: number;
  muted: boolean;
};

const steps: Array<{ key: MusicDawStep; label: string }> = [
  { key: "gen", label: "生成" },
  { key: "tracks", label: "音轨" },
  { key: "slice", label: "标记切片" },
  { key: "export", label: "导出" }
];

// Do not seed prototype tracks.  A DAW without a bound project must be empty;
// tracks only appear after they are loaded from or generated into the project.
const seedTracks: Track[] = [];

const markers = [
  { name: "Verse", left: 8 },
  { name: "Chorus", left: 42 },
  { name: "Bridge", left: 72 }
];

export function MusicDawShell({ projectId, activeStep, refreshToken = 0 }: MusicDawShellProps) {
  const [localStep, setLocalStep] = useState<MusicDawStep>("tracks");
  const [title, setTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [style, setStyle] = useState<unknown>("");
  const [dawTracks, setDawTracks] = useState(seedTracks);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState<string[]>([]);
  const [solo, setSolo] = useState<string>();
  const [sliceMode, setSliceMode] = useState<"mark" | "slice">("mark");
  const [segments, setSegments] = useState(["A Chorus 人声+鼓", "B Verse 人声+古筝", "C Bridge 弦乐"]);
  const [status, setStatus] = useState("本地草稿");
  const pane = activeStep ?? localStep;

  useEffect(() => {
    if (!projectId || !window.newbrain?.getBrainMusicDaw) return;
    void window.newbrain.getBrainMusicDaw({ projectId }).then((result: { state?: BrainMusicDawState }) => {
      if (!result.state) return;
      setTitle(result.state.title);
      setLyrics(result.state.lyrics);
      setStyle(result.state.style);
      setDawTracks(result.state.tracks);
      setMuted(result.state.tracks.filter((track) => track.muted).map((track) => track.id));
      if (result.state.segments.length) setSegments(result.state.segments.map(String));
      setStatus(refreshToken > 0 ? "已从 Agent / Rust 工程刷新" : "已从 Rust 工程加载");
    }).catch((error: unknown) => setStatus(`加载失败：${error instanceof Error ? error.message : String(error)}`));
  }, [projectId, refreshToken]);

  const state = (): BrainMusicDawState => ({
    title,
    lyrics,
    style,
    tracks: dawTracks.map((track) => ({ ...track, muted: muted.includes(track.id) })),
    markers,
    segments,
    exportFormat: "wav"
  });

  const persistDaw = async (cook = false) => {
    if (!projectId || !window.newbrain?.saveBrainMusicDaw) {
      setStatus(cook ? "已导出（本地草稿）" : "已保存（本地草稿）");
      return;
    }
    try {
      await window.newbrain.saveBrainMusicDaw({ projectId, state: state() });
      if (cook && window.newbrain.cookBrainMusicDaw) await window.newbrain.cookBrainMusicDaw({ projectId });
      setStatus(cook ? "已保存并生成 Rust 音乐产物" : "DAW 已保存");
    } catch (error) {
      setStatus(`操作失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const generateSong = async () => {
    if (!projectId) {
      setStatus("已保存生成参数（本地草稿）");
      return;
    }
    setStatus("正在请求 music_generate…");
    try {
      await persistDaw(false);
      if (window.newbrain?.generateBrainSceneMedia) {
        const prompt = [
          `Title: ${title}`,
          typeof style === "string" ? `Style: ${style}` : `Style: ${JSON.stringify(style)}`,
          `Lyrics:\n${lyrics}`
        ].join("\n");
        await window.newbrain.generateBrainSceneMedia({ projectId, kind: "music", prompt });
        setStatus("music_generate 已完成 · 可进入音轨编排");
        return;
      }
      setStatus("DAW 已保存（无媒体网关 IPC）");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(/凭证|网关|登录|gateway|auth/i.test(message)
        ? `网关不可用，已保留 DAW 草稿 · ${message}`
        : `生成失败：${message}`);
    }
  };

  const exportMix = async () => {
    if (!projectId || !window.newbrain?.startMusicRender) {
      await persistDaw(true);
      return;
    }
    setStatus("正在导出 mix…");
    try {
      await persistDaw(true);
      const started = await window.newbrain.startMusicRender({
        projectId,
        outputRelativePath: `exports/music-mix-${Date.now()}.wav`
      });
      setStatus(`FFmpeg 已启动 · ${started.renderId}`);
      const getStatus = window.newbrain.getMusicRenderStatus;
      if (getStatus) {
        for (let attempt = 0; attempt < 120; attempt += 1) {
          const tick = await getStatus({ renderId: started.renderId });
          if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(String(tick?.status || ""))) {
            setStatus(tick?.status === "SUCCEEDED"
              ? `导出完成 · ${tick.outputPath || started.outputPath || "exports/*.wav"}`
              : `导出结束：${tick?.status}${tick?.errorCode ? ` · ${tick.errorCode}` : ""}`);
            return;
          }
          setStatus(`FFmpeg ${tick?.status || "RUNNING"} · ${started.renderId}`);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      setStatus(`渲染已提交 · ${started.renderId}`);
    } catch (error) {
      setStatus(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const chooseStep = (key: MusicDawStep) => {
    // Parent WorkspaceModules owns scene tabs when activeStep is set — do not claim control here.
    if (activeStep) return;
    setLocalStep(key);
    setStatus(`已切换到${steps.find((item) => item.key === key)?.label}`);
  };

  const toggleMuted = (id: string) => {
    setMuted((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const timeline = (withSlice = false) => (
    <div className="brain-music-daw__ruler" aria-label="时间线">
      <span className="brain-music-daw__tick" style={{ left: "0%" }}>0:00</span>
      <span className="brain-music-daw__tick" style={{ left: "25%" }}>0:30</span>
      <span className="brain-music-daw__tick" style={{ left: "50%" }}>1:00</span>
      <span className="brain-music-daw__tick" style={{ left: "75%" }}>1:30</span>
      {markers.map((marker) => (
        <span key={marker.name} className="brain-music-daw__marker" style={{ left: `${marker.left}%` }}>{marker.name}</span>
      ))}
      {withSlice && <span className="brain-music-daw__slice-box" style={{ left: "42%", width: "28%" }}>切片 A</span>}
      {!withSlice && <span className="brain-music-daw__playhead" style={{ left: playing ? "42%" : "18%" }} />}
    </div>
  );

  const tracks = (withSlice = false) => (
    <div className="brain-music-daw__tracks">
      {dawTracks.map((track) => (
        <article key={track.id} className={`brain-music-daw__track${muted.includes(track.id) ? " brain-music-daw__track--muted" : ""}`}>
          <div className="brain-music-daw__track-meta">
            <strong>{track.name}</strong>
            <span>
              <button type="button" className={muted.includes(track.id) ? "brain-music-daw__toggle--active" : ""} onClick={() => toggleMuted(track.id)}>M</button>
              <button type="button" className={solo === track.id ? "brain-music-daw__toggle--active" : ""} onClick={() => setSolo(solo === track.id ? undefined : track.id)}>S</button>
            </span>
          </div>
          <div className="brain-music-daw__lane">
            <div className={`brain-music-daw__clip brain-music-daw__clip--${track.id}`} style={{ left: `${track.start}%`, width: `${track.width}%` }}>
              {track.clip}
            </div>
            {withSlice && <span className="brain-music-daw__slice-box" style={{ left: "42%", width: "28%" }} />}
          </div>
        </article>
      ))}
    </div>
  );

  return (
    <section className="brain-music-daw" aria-label="音乐多轨工作台" data-testid="brain-music-daw-shell">
      <header className="brain-music-daw__header">
        <div>
          <strong>{title || "音乐工作台"}</strong>
          <span>{projectId ? `工程 ${projectId}` : "未绑定工程"} · {status}</span>
        </div>
        <span className="brain-music-daw__summary">{dawTracks.length ? `${dawTracks.length} 音轨` : "暂无音轨"}</span>
      </header>

      {!activeStep ? (
        <nav className="brain-music-daw__steps" aria-label="音乐功能">
          {steps.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`brain-music-daw__step${pane === item.key ? " brain-music-daw__step--active" : ""}`}
              aria-current={pane === item.key ? "step" : undefined}
              onClick={() => chooseStep(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}

      <div className="brain-music-daw__pane" role="tabpanel">
        {pane === "gen" && (
          <div className="brain-music-daw__section">
            <h3>生成整曲</h3>
            <label className="brain-music-daw__field">Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="brain-music-daw__field">Lyrics<textarea value={lyrics} onChange={(event) => setLyrics(event.target.value)} /></label>
            <label className="brain-music-daw__field">Style<input value={typeof style === "string" ? style : JSON.stringify(style)} onChange={(event) => setStyle(event.target.value)} /></label>
            <button type="button" className="brain-music-daw__primary" onClick={() => void generateSong()}>✦ 生成整曲</button>
          </div>
        )}

        {pane === "tracks" && (
          <div className="brain-music-daw__section">
            <div className="brain-music-daw__toolbar">
              <button type="button" className="brain-music-daw__primary" onClick={() => setPlaying(!playing)}>{playing ? "❚❚" : "▶"}</button>
              <button type="button" onClick={() => setPlaying(false)}>■</button>
              <button type="button" onClick={() => {
                if (!projectId) {
                  setStatus("请先绑定音乐工程后再新增音轨");
                  return;
                }
                setStatus("请通过生成整曲或导入媒体添加真实音轨；不会创建空壳演示轨");
              }}>＋ 音轨</button>
              <span>{dawTracks.length ? `${dawTracks.length} 音轨` : "暂无音轨"}</span>
            </div>
            {timeline()}
            {tracks()}
            <footer className="brain-music-daw__footer">
              <span>{solo ? `Solo：${dawTracks.find((track) => track.id === solo)?.name}` : `静音 ${muted.length}/${dawTracks.length} 轨`}</span>
              <button type="button" className="brain-music-daw__primary" onClick={() => chooseStep("slice")}>进入标记切片</button>
            </footer>
          </div>
        )}

        {pane === "slice" && (
          <div className="brain-music-daw__section">
            <div className="brain-music-daw__toolbar">
              <button type="button" className={sliceMode === "mark" ? "brain-music-daw__toggle--active" : ""} onClick={() => setSliceMode("mark")}>＋ 标记</button>
              <button type="button" className={sliceMode === "slice" ? "brain-music-daw__toggle--active" : ""} onClick={() => setSliceMode("slice")}>✂ 切片选区</button>
              <span>选区：Chorus 0:52–1:28</span>
            </div>
            {timeline(true)}
            {tracks(true)}
            <aside className="brain-music-daw__segments">
              <h4>切片片段（可重排）</h4>
              <div>{segments.map((segment) => <button key={segment} type="button">{segment}</button>)}</div>
              <p>顺序：{segments.map((segment) => segment[0]).join(" → ")} · 静音轨不参与合成</p>
            </aside>
            <footer className="brain-music-daw__footer">
              <button type="button" onClick={() => setSegments((current) => current.length > 1 ? [current[1]!, current[0]!, ...current.slice(2)] : current)}>调整顺序 A←→B</button>
              <button type="button" className="brain-music-daw__primary" onClick={() => void persistDaw()}>▶ 保存切片编排</button>
            </footer>
          </div>
        )}

        {pane === "export" && (
          <div className="brain-music-daw__section">
            <h3>导出</h3>
            <div className="brain-music-daw__export-grid">
              <label>音频格式<select><option>MP3</option><option>WAV</option><option>FLAC</option><option>M4A</option><option>OGG</option></select></label>
              <label>采样率 / 声道<select><option>48k 立体声</option><option>44.1k 立体声</option><option>48k 单声道</option></select></label>
              <label>响度<select><option>-14 LUFS</option><option>-16 LUFS</option><option>不处理</option></select></label>
            </div>
            <div className="brain-music-daw__checks">
              <label><input type="checkbox" defaultChecked /> 成曲 mix</label>
              <label><input type="checkbox" defaultChecked /> 切片重合成</label>
              <label><input type="checkbox" /> stems.zip</label>
            </div>
            <p>{title ? `将导出 · ${title}.mp3` : "填写标题并生成真实音频后导出"}</p>
            <button type="button" className="brain-music-daw__primary" onClick={() => void exportMix()}>保存并导出</button>
          </div>
        )}
      </div>
    </section>
  );
}
