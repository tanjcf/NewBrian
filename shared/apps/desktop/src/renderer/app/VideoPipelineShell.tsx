import { useEffect, useState } from "react";
import type { BrainVideoPipelineState } from "@codex-forge/protocol/brain-video-runtime";

export type VideoPipelineStep = "script" | "storyboard" | "generate" | "tracks" | "mux" | "export";

export type VideoPipelineShellProps = {
  projectId?: string;
  activeStep?: VideoPipelineStep;
};

type Shot = {
  id: string;
  title: string;
  line: string;
  prompt: string;
  clip: string;
  ready: boolean;
  transition: string;
};

const steps: Array<{ key: VideoPipelineStep; label: string }> = [
  { key: "script", label: "脚本" },
  { key: "storyboard", label: "分镜" },
  { key: "generate", label: "单镜生成" },
  { key: "tracks", label: "本镜音视频轨" },
  { key: "mux", label: "合成" },
  { key: "export", label: "导出" }
];

const seedShots: Shot[] = [
  { id: "shot-001", title: "产品特写", line: "从细节看见品质。", prompt: "暖光下产品缓缓推进特写，浅景深，商业广告质感", clip: "shot_001.mp4", ready: false, transition: "fade" },
  { id: "shot-002", title: "办公室协作", line: "和团队一起高效协作。", prompt: "明亮办公区双人协作，镜头轻柔左摇，角色一致", clip: "shot_002.mp4", ready: false, transition: "cut" },
  { id: "shot-003", title: "品牌 Logo", line: "选择 BRAIN，把想法做成片。", prompt: "软白底 Logo 光扫入画，极简品牌落版", clip: "shot_003.mp4", ready: false, transition: "fade" }
];

async function pollVideoRender(renderId: string, onTick: (status: string) => void) {
  const getStatus = window.codecn?.getVideoRenderStatus;
  if (!getStatus) return { status: "SUCCEEDED", renderId };
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await getStatus({ renderId });
    onTick(String(state?.status || "RUNNING"));
    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(String(state?.status || ""))) return state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("视频渲染超时");
}

export function VideoPipelineShell({ projectId, activeStep }: VideoPipelineShellProps) {
  const [localStep, setLocalStep] = useState<VideoPipelineStep>("generate");
  const [shotIndex, setShotIndex] = useState(0);
  const [script, setScript] = useState("【主题】产品宣传片 · 桌面硬件\n【时长】约 12 秒 · 3 镜 · 16:9\n\n【旁白】\n镜1：从细节看见品质。\n镜2：和团队一起高效协作。\n镜3：选择 BRAIN，把想法做成片。");
  const [shots, setShots] = useState(seedShots);
  const [readyShots, setReadyShots] = useState<string[]>([]);
  const [transitions, setTransitions] = useState(["淡入淡出 · 0.3s", "硬切"]);
  const [status, setStatus] = useState("本地草稿");
  const pane = activeStep ?? localStep;
  const shot = shots[shotIndex] ?? shots[0]!;

  useEffect(() => {
    if (!projectId || !window.codecn?.getBrainVideoPipeline) return;
    void window.codecn.getBrainVideoPipeline({ projectId }).then((result: { state?: BrainVideoPipelineState }) => {
      if (!result.state) return;
      setScript(result.state.script);
      const loaded = result.state.shots.map((item, index) => ({ ...item, id: `shot-${index + 1}` }));
      setShots(loaded);
      setReadyShots(loaded.filter((item) => item.ready).map((item) => item.id));
      setTransitions(loaded.slice(0, -1).map((item) => item.transition || "cut"));
      setStatus("已从 Rust 工程加载");
    }).catch((error: unknown) => setStatus(`加载失败：${error instanceof Error ? error.message : String(error)}`));
  }, [projectId]);

  const state = (): BrainVideoPipelineState => ({
    script,
    shots: shots.map(({ id: _id, ...item }, index) => ({
      ...item,
      ready: readyShots.includes(`shot-${index + 1}`),
      transition: transitions[index] ?? item.transition
    })),
    exportFormat: "mp4"
  });

  const savePipeline = async () => {
    if (!projectId || !window.codecn?.saveBrainVideoPipeline) return;
    await window.codecn.saveBrainVideoPipeline({ projectId, state: state() });
  };

  const muxAndExport = async (label: string) => {
    if (!projectId || !window.codecn?.startVideoRender) {
      setStatus(`${label}（本地草稿 · 无渲染 IPC）`);
      return;
    }
    setStatus(`正在${label}…`);
    try {
      await savePipeline();
      if (window.codecn.cookBrainVideoPipeline) await window.codecn.cookBrainVideoPipeline({ projectId });
      const started = await window.codecn.startVideoRender({
        projectId,
        outputRelativePath: `renders/pipeline-${Date.now()}.mp4`,
        source: "pipeline"
      });
      setStatus(`FFmpeg 已启动 · ${started.renderId}`);
      const finished = await pollVideoRender(started.renderId, (tick) => setStatus(`FFmpeg ${tick} · ${started.renderId}`));
      if (finished?.status === "SUCCEEDED") setStatus(`${label}完成 · ${finished.outputPath || started.outputPath || "renders/*.mp4"}`);
      else setStatus(`${label}结束：${finished?.status || "unknown"}${finished?.errorCode ? ` · ${finished.errorCode}` : ""}`);
    } catch (error) {
      setStatus(`${label}失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const chooseStep = (key: VideoPipelineStep) => {
    if (!activeStep) setLocalStep(key);
    setStatus(activeStep ? `当前步骤由父级控制：${key}` : `已切换到${steps.find((item) => item.key === key)?.label}`);
  };

  const generateShot = async (id: string) => {
    const index = shots.findIndex((item) => item.id === id);
    const target = shots[index];
    if (!projectId || index < 0) {
      setStatus("请先绑定视频工程后再生成分镜，不会做本地假生成");
      return;
    }
    setStatus(`正在生成 ${id}…`);
    try {
      if (!window.codecn?.generateBrainSceneMedia) {
        setStatus("当前构建未接入 video_generate，无法生成分镜");
        return;
      }
      await window.codecn.generateBrainSceneMedia({
        projectId,
        kind: "video",
        prompt: target?.prompt || target?.title || id,
        shotIndex: index
      });
      if (window.codecn?.markBrainVideoShot) {
        await window.codecn.markBrainVideoShot({ projectId, shotIndex: index, ready: true });
      }
      setReadyShots((current) => current.includes(id) ? current : [...current, id]);
      setStatus(`${id} 已走 video_generate 并标记就绪`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`生成失败：${message}`);
    }
  };

  const shotTabs = (
    <div className="brain-video-pipe__shot-tabs" role="tablist" aria-label="分镜头">
      {shots.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={`brain-video-pipe__shot-tab${index === shotIndex ? " brain-video-pipe__shot-tab--active" : ""}`}
          aria-selected={index === shotIndex}
          onClick={() => setShotIndex(index)}
        >
          镜 {index + 1}<small>{item.title}</small>
        </button>
      ))}
    </div>
  );

  return (
    <section className="brain-video-pipe" aria-label="视频制作流水线" data-testid="brain-video-pipeline-shell">
      <header className="brain-video-pipe__header">
        <div className="brain-video-pipe__heading">
          <strong>产品宣传片 · 自动成片</strong>
          <span>{projectId ? `工程 ${projectId}` : "未绑定工程"} · FFmpeg / video_generate · {status}</span>
        </div>
        <button type="button" className="brain-video-pipe__run" onClick={() => void Promise.all(shots.map((item) => generateShot(item.id)))}>
          ▶ 生成全部未完成镜
        </button>
      </header>

      <nav className="brain-video-pipe__steps" aria-label="成片步骤">
        {steps.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`brain-video-pipe__step${pane === item.key ? " brain-video-pipe__step--active" : ""}`}
            aria-current={pane === item.key ? "step" : undefined}
            onClick={() => chooseStep(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="brain-video-pipe__pane" role="tabpanel">
        {pane === "script" && (
          <div className="brain-video-pipe__section">
            <h3>脚本</h3>
            <p>主题、旁白文案、成片结构（LLM 可改，也可手改）</p>
            <textarea
              className="brain-video-pipe__editor"
              value={script}
              onChange={(event) => setScript(event.target.value)}
            />
            <button type="button" className="brain-video-pipe__action" onClick={() => {
              if (!projectId) {
                setStatus("请先绑定视频工程后再重写脚本");
                return;
              }
              if (!window.codecn?.saveBrainWorkspaceSection) {
                setStatus("当前构建未接入工程分区保存，无法 AI 重写脚本");
                return;
              }
              setStatus("正在保存脚本到工程分区…");
              void window.codecn.saveBrainWorkspaceSection({
                projectId,
                workspaceKey: "video",
                sectionKey: "script",
                content: script,
                expectedRevision: 0
              }).then(() => setStatus("脚本已保存；请在对话中请求模型改写，或使用工作台 AI 生成入口"))
                .catch((error: unknown) => setStatus(`脚本保存失败：${error instanceof Error ? error.message : String(error)}`));
            }}>✦ 保存脚本到工程</button>
          </div>
        )}

        {pane === "storyboard" && (
          <div className="brain-video-pipe__section">
            <h3>分镜 · 素材 + Workflow</h3>
            <p>每镜独立维护剧本、参考图、提示词和镜间转场。</p>
            {shotTabs}
            <div className="brain-video-pipe__transition-list">
              {transitions.map((transition, index) => (
                <label key={`${index}-${transition}`} className="brain-video-pipe__transition">
                  <span>镜 {index + 1} → 镜 {index + 2}</span>
                  <select value={transition} onChange={(event) => setTransitions((current) => current.map((item, i) => i === index ? event.target.value : item))}>
                    <option>硬切</option><option>淡入淡出 · 0.3s</option><option>淡入淡出 · 0.6s</option><option>叠化</option><option>划像 · 左</option><option>模糊过渡</option>
                  </select>
                </label>
              ))}
            </div>
            <article key={shot.id} className="brain-video-pipe__shot-card">
              <strong>镜 {shotIndex + 1} · {shot.title}</strong>
              <label>本镜剧本 / 台词<textarea defaultValue={shot.line} /></label>
              <div className="brain-video-pipe__image-grid">
                <button type="button">＋ 角色图 / AI 生成</button><button type="button">＋ 场景图 / AI 生成</button>
              </div>
              <label>提示词 Prompt<textarea defaultValue={shot.prompt} /></label>
              <div className="brain-video-pipe__workflow">LLM 细化 → 参考图 → video_generate → 质检 → 输出 clip</div>
            </article>
          </div>
        )}

        {pane === "generate" && (
          <div className="brain-video-pipe__section">
            <h3>单镜生成</h3>
            <p>每镜可单独生成或重新生成；全部就绪后进入合成。</p>
            <label className="brain-video-pipe__field">默认模型<select><option>Seedance / video_generate</option><option>可灵</option><option>Runway Gen-3</option></select></label>
            <div className="brain-video-pipe__shot-list">
              {shots.map((item, index) => (
                <article key={item.id} className={`brain-video-pipe__shot-row${index === shotIndex ? " brain-video-pipe__shot-row--active" : ""}`} onClick={() => setShotIndex(index)}>
                  <b>{index + 1}</b><span><strong>{item.title}</strong><small>{item.clip} · 视频轨 + 旁白轨</small></span>
                  <em>{readyShots.includes(item.id) ? "已就绪" : "未生成"}</em>
                  <button type="button" onClick={() => void generateShot(item.id)}>{readyShots.includes(item.id) ? "重新生成" : "生成本镜"}</button>
                </article>
              ))}
            </div>
            <div className="brain-video-pipe__ready">完成 {readyShots.length}/3 · {readyShots.length === 3 ? "合成已解锁" : "合成未解锁"}</div>
          </div>
        )}

        {pane === "tracks" && (
          <div className="brain-video-pipe__section">
            <h3>本镜音视频轨</h3><p>独立修改每镜视频轨、音频轨、入出点与旁白。</p>
            {shotTabs}
            <div className="brain-video-pipe__tracks">
              <div className="brain-video-pipe__track"><b>视频轨 V{shotIndex + 1}</b><span>{shot.clip} · 0–4s</span><button type="button">裁剪入出点</button><button type="button">仅重生成视频</button></div>
              <div className="brain-video-pipe__track brain-video-pipe__track--audio"><b>音频轨 A{shotIndex + 1}</b><span>旁白 · {shot.line}</span><button type="button">静音</button><button type="button">✦ 重生成 TTS</button></div>
            </div>
          </div>
        )}

        {pane === "mux" && (
          <div className="brain-video-pipe__section">
            <h3>合成</h3><p>按分镜转场执行 FFmpeg concat / lavfi，并登记渲染任务。</p>
            <div className="brain-video-pipe__timeline">{shots.map((item) => <span key={item.id}>{item.title}</span>)}</div>
            <div className="brain-video-pipe__tags">{transitions.map((item, index) => <span key={item}>{index + 1}→{index + 2} {item}</span>)}</div>
            <button type="button" className="brain-video-pipe__action" onClick={() => void muxAndExport("合成")}>▶ 保存并合成</button>
          </div>
        )}

        {pane === "export" && (
          <div className="brain-video-pipe__section">
            <h3>导出</h3><p>选择成片格式，可选附带工程包。</p>
            <div className="brain-video-pipe__export-grid">
              <label>视频格式<select><option>MP4 · H.264</option><option>MP4 · H.265</option><option>WebM · VP9</option><option>MOV · ProRes</option><option>GIF</option></select></label>
              <label>分辨率 / 帧率<select><option>720p · 30fps</option><option>1080p · 30fps</option><option>1080p · 24fps</option><option>4K · 30fps</option></select></label>
            </div>
            <label className="brain-video-pipe__check"><input type="checkbox" /> 同时导出剪映工程</label>
            <label className="brain-video-pipe__check"><input type="checkbox" defaultChecked /> 登记到产物面板</label>
            <button type="button" className="brain-video-pipe__action" onClick={() => void muxAndExport("导出")}>保存并导出</button>
          </div>
        )}
      </div>
    </section>
  );
}
