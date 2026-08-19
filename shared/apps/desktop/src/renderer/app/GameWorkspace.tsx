import { useEffect, useState } from "react";
import type { BrainGameProjectInspection } from "@codex-forge/protocol";

const engineNames: Record<BrainGameProjectInspection["engine"], string> = {
  web: "Web 游戏", godot: "Godot", unity: "Unity", unreal: "Unreal Engine", unknown: "未识别"
};

const assetLabels: Array<[keyof BrainGameProjectInspection["assets"], string]> = [
  ["scripts", "脚本"], ["scenes", "场景"], ["images", "图片"], ["audio", "音频"],
  ["video", "视频"], ["models", "模型"], ["other", "其他"]
];

export function GameWorkspace({ projectId, onRequestPreview }: { projectId?: string; onRequestPreview: (request: string) => void }) {
  const [inspection, setInspection] = useState<BrainGameProjectInspection | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let active = true;
    if (!projectId || !window.codecn?.inspectBrainGameProject) {
      setInspection(null); setStatus("idle"); setError("");
      return () => { active = false; };
    }
    setStatus("loading"); setError("");
    void window.codecn.inspectBrainGameProject({ projectId }).then((result) => {
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

  const previewCommand = inspection?.preview.supported
    ? [inspection.preview.command, ...(inspection.preview.args || [])].filter(Boolean).join(" ")
    : "";

  return <section className="brain-game-plugin" aria-label="游戏制作项目检查">
    <header>
      <div><span>游戏制作</span><strong>{inspection?.displayName || "项目资产与试玩"}</strong></div>
      <button type="button" onClick={() => setRefreshVersion((value) => value + 1)} disabled={!projectId || status === "loading"}>{status === "loading" ? "检查中…" : "重新检查"}</button>
    </header>
    {status === "idle" ? <div className="brain-workspace-plugin-empty"><strong>请选择游戏项目</strong><span>关联本地工程后，BRAIN 会识别引擎、资产和安全试玩入口。</span></div> : null}
    {status === "error" ? <div className="brain-workspace-plugin-empty error"><strong>暂时无法检查</strong><span>{error}</span></div> : null}
    {inspection ? <>
      <dl className="brain-game-summary">
        <div><dt>工程类型</dt><dd>{engineNames[inspection.engine]}</dd></div>
        <div><dt>扫描范围</dt><dd>{inspection.scannedEntries} 项{inspection.truncated ? "（已截断）" : ""}</dd></div>
        <div><dt>工程标记</dt><dd>{inspection.markers.join("、") || "无"}</dd></div>
      </dl>
      <section className="brain-game-assets"><h3>项目资产</h3><div>{assetLabels.map(([key, label]) => <article key={key}><strong>{inspection.assets[key]}</strong><span>{label}</span></article>)}</div></section>
      <section className="brain-game-preview"><h3>可运行预览</h3>
        {previewCommand ? <><code>{previewCommand}</code><small>启动会经过当前项目权限审批；本面板不会绕过审批直接执行命令。</small><button type="button" onClick={() => onRequestPreview(`请在当前游戏项目中经过权限审批后运行试玩命令 \`${previewCommand}\`，确认预览地址可以打开，并记录启动结果、错误日志和试玩验证证据。`)}>生成试玩请求</button></> : <p>尚未发现可验证的试玩入口。可在项目中配置受支持的启动脚本后重新检查。</p>}
      </section>
      {inspection.warnings.length ? <section className="brain-game-warnings"><h3>注意事项</h3>{inspection.warnings.map((warning) => <p key={warning}>{warning}</p>)}</section> : null}
    </> : null}
  </section>;
}
