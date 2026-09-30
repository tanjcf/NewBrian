import { useEffect, useState } from "react";
import type { BrainGamePreviewState, BrainGameProjectInspection } from "@codex-forge/protocol";
import { GameTemplateWizard } from "./GameTemplateWizard";

const engineNames: Record<BrainGameProjectInspection["engine"], string> = {
  web: "Web 游戏", godot: "Godot", unity: "Unity", unreal: "Unreal Engine", unknown: "未识别"
};

const assetLabels: Array<[keyof BrainGameProjectInspection["assets"], string]> = [
  ["scripts", "脚本"], ["scenes", "场景"], ["images", "图片"], ["audio", "音频"],
  ["video", "视频"], ["models", "模型"], ["other", "其他"]
];

const activePreviewStatuses = new Set<BrainGamePreviewState["status"]>(["STARTING", "RUNNING", "READY", "STOPPING"]);

const previewStatusNames: Record<BrainGamePreviewState["status"], string> = {
  STARTING: "正在启动", RUNNING: "等待预览就绪", READY: "可以试玩", STOPPING: "正在停止",
  SUCCEEDED: "已结束", FAILED: "启动失败", CANCELLED: "已停止"
};

export function GameWorkspace({ projectId, conversationId }: { projectId?: string; conversationId?: string }) {
  const [inspection, setInspection] = useState<BrainGameProjectInspection | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [preview, setPreview] = useState<BrainGamePreviewState | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [evidencePath, setEvidencePath] = useState("");
  const [artifacts, setArtifacts] = useState<any[]>([]);

  useEffect(() => {
    let active = true;
    if (!projectId || !window.newbrain?.inspectBrainGameProject) {
      setInspection(null); setStatus("idle"); setError("");
      return () => { active = false; };
    }
    setStatus("loading"); setError("");
    void window.newbrain.inspectBrainGameProject({ projectId }).then((result) => {
      if (!active) return;
      setInspection(result); setStatus("ready");
    }).catch((reason: unknown) => {
      if (!active) return;
      const detail = reason instanceof Error ? reason.message : String(reason);
      setInspection(null); setStatus("error");
      setError(detail.includes("BRAIN_LOCAL_WORKSPACE_REQUIRED") ? "该项目尚未关联本地文件夹，请先从左侧项目绑定本地工程。" : "游戏工程检查失败，请确认本地项目仍可访问。");
    });
    return () => { active = false; };
  }, [projectId, refreshVersion]);

  useEffect(() => {
    if (!projectId || !preview || !activePreviewStatuses.has(preview.status) || !window.newbrain?.getBrainGamePreviewStatus) return;
    let active = true;
    const timer = window.setInterval(() => {
      void window.newbrain?.getBrainGamePreviewStatus({ projectId }).then((state) => {
        if (active) setPreview(state);
      }).catch(() => undefined);
    }, 750);
    return () => { active = false; window.clearInterval(timer); };
  }, [projectId, preview?.status]);

  useEffect(() => { setPreview(null); setPreviewError(""); setPreviewBusy(false); setEvidencePath(""); }, [projectId]);

  useEffect(() => {
    if (!projectId || !window.newbrain?.listBrainArtifacts) { setArtifacts([]); return; }
    void window.newbrain.listBrainArtifacts({ projectId }).then((items) => setArtifacts(Array.isArray(items) ? items : [])).catch(() => setArtifacts([]));
  }, [projectId, refreshVersion, preview?.status]);

  const previewCommand = inspection?.preview.supported
    ? [inspection.preview.command, ...(inspection.preview.args || [])].filter(Boolean).join(" ")
    : "";

  const startPreview = async () => {
    if (!projectId || !window.newbrain?.startBrainGamePreview) return;
    setPreviewBusy(true); setPreviewError("");
    try {
      setPreview(await window.newbrain.startBrainGamePreview({ projectId, ...(conversationId ? { conversationId } : {}) }));
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      if (!detail.includes("BRAIN_GAME_PREVIEW_DECLINED")) setPreviewError("试玩启动失败，请检查工程启动脚本或任务日志。");
    } finally { setPreviewBusy(false); }
  };

  const stopPreview = async () => {
    if (!projectId || !window.newbrain?.stopBrainGamePreview) return;
    setPreviewBusy(true); setPreviewError("");
    try { setPreview(await window.newbrain.stopBrainGamePreview({ projectId })); }
    catch { setPreviewError("未能停止试玩进程，请查看任务状态。"); }
    finally { setPreviewBusy(false); }
  };

  const openPreview = async () => {
    if (preview?.status !== "READY" || !preview.previewUrl || !window.newbrain?.openBrowserPreview) return;
    setPreviewError("");
    try { await window.newbrain.openBrowserPreview(preview.previewUrl); }
    catch { setPreviewError("试玩页面打开失败，请确认预览服务仍在运行。"); }
  };

  const captureEvidence = async () => {
    if (preview?.status !== "READY" || !window.newbrain?.captureBrowserPreview) return;
    setPreviewBusy(true); setPreviewError("");
    try {
      const result = await window.newbrain.captureBrowserPreview();
      setEvidencePath(result.path);
    } catch { setPreviewError("试玩截图保存失败，请先打开试玩页面。"); }
    finally { setPreviewBusy(false); }
  };

  return <section className="brain-game-plugin" aria-label="游戏制作项目检查" data-testid="brain-game-workspace">
    <header>
      <div><span>游戏制作</span><strong>{inspection?.displayName || "项目资产与试玩"}</strong></div>
      <button type="button" onClick={() => setRefreshVersion((value) => value + 1)} disabled={!projectId || status === "loading"}>{status === "loading" ? "检查中…" : "重新检查"}</button>
    </header>
    {status === "idle" ? <div className="brain-workspace-plugin-empty" data-testid="brain-game-idle"><strong>请选择游戏项目</strong><span>关联本地工程后，BRAIN 会识别引擎、资产和安全试玩入口。</span></div> : null}
    {status === "error" ? <div className="brain-workspace-plugin-empty error"><strong>暂时无法检查</strong><span>{error}</span></div> : null}
    {inspection ? <>
      <dl className="brain-game-summary">
        <div><dt>工程类型</dt><dd data-testid="brain-game-engine">{engineNames[inspection.engine]}</dd></div>
        <div><dt>扫描范围</dt><dd>{inspection.scannedEntries} 项{inspection.truncated ? "（已截断）" : ""}</dd></div>
        <div><dt>工程标记</dt><dd>{inspection.markers.join("、") || "无"}</dd></div>
      </dl>
      <section className="brain-game-assets"><h3>项目资产</h3><div>{assetLabels.map(([key, label]) => <article key={key}><strong>{inspection.assets[key]}</strong><span>{label}</span></article>)}</div></section>
      <GameTemplateWizard projectId={projectId} onCreated={() => setRefreshVersion((value) => value + 1)} />
      {artifacts.length ? <section className="brain-game-artifacts" data-testid="brain-game-artifacts"><h3>跨场景产物</h3>{artifacts.map((artifact) => <article key={artifact.id}><strong>{artifact.artifactType}</strong><span>{artifact.storageKey}</span><em>{artifact.sourceWorkspaceKey || "未知来源"}</em></article>)}</section> : null}
      <section className="brain-game-preview" data-testid="brain-game-preview"><h3>可运行预览</h3>
        {previewCommand ? <><code>{previewCommand}</code><small>启动前会显示系统确认框；命令由主进程重新检查工程后确定，本面板不能传入或修改命令。</small>
          {preview ? <div className={`brain-game-preview-state ${preview.status.toLowerCase()}`} role="status" data-testid="brain-game-preview-status"><strong>{previewStatusNames[preview.status]}</strong>{preview.previewUrl ? <span>{preview.previewUrl}</span> : null}{preview.errorCode ? <small>错误代码：{preview.errorCode}</small> : null}</div> : null}
          {preview?.status === "READY" ? <div className="brain-game-preview-actions"><button type="button" onClick={() => void openPreview()}>打开试玩</button><button type="button" onClick={() => void captureEvidence()} disabled={previewBusy}>保存试玩截图</button></div> : null}
          {evidencePath ? <small data-testid="brain-game-evidence">试玩证据已保存：{evidencePath}</small> : null}
          {preview?.output ? <details><summary>运行日志</summary><pre>{preview.output}</pre></details> : null}
          {previewError ? <p className="error">{previewError}</p> : null}
          {preview && activePreviewStatuses.has(preview.status)
            ? <button type="button" onClick={() => void stopPreview()} disabled={previewBusy || preview.status === "STOPPING"}>{preview.status === "STOPPING" ? "停止中…" : "停止试玩"}</button>
            : <button type="button" onClick={() => void startPreview()} disabled={previewBusy}>{previewBusy ? "等待确认…" : "启动试玩"}</button>}
        </> : <p>尚未发现可验证的试玩入口。可在项目中配置受支持的启动脚本后重新检查。</p>}
      </section>
      {inspection.warnings.length ? <section className="brain-game-warnings"><h3>注意事项</h3>{inspection.warnings.map((warning) => <p key={warning}>{warning}</p>)}</section> : null}
      {inspection.engine === "unreal" ? <section className="brain-game-unreal-guide" data-testid="brain-game-unreal-guide">
        <h3>Unreal 工程引导</h3>
        <p>检测到 Unreal 工程时，请先在 Epic Games Launcher 登录并安装对应引擎版本，再用 Epic 打开 .uproproject 文件。</p>
        <button type="button" data-testid="brain-game-ensure-epic" onClick={() => void window.newbrain?.ensureBrainEngine?.({ engineId: "epic-launcher" }).catch(() => undefined)}>检测 Epic Launcher</button>
      </section> : null}
    </> : null}
  </section>;
}
