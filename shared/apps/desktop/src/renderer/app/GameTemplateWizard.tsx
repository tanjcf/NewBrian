import { useState } from "react";

export function GameTemplateWizard(props: { projectId?: string; projectName?: string; onCreated?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [engine, setEngine] = useState<"web" | "unreal">("web");
  const [ueProjectName, setUeProjectName] = useState(props.projectName || "BrainGame");
  const [ueEngineVersion, setUeEngineVersion] = useState("5.4");

  const create = async () => {
    if (!props.projectId) {
      setMessage("请先选择已绑定本地文件夹的游戏项目。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (engine === "web") {
        if (!window.newbrain?.createBrainGameWebTemplate) throw new Error("Web 模板 API 不可用");
        const result = await window.newbrain.createBrainGameWebTemplate({ projectId: props.projectId });
        setMessage(`Web 模板已创建 · ${result.previewUrl}`);
      } else {
        if (!window.newbrain?.createBrainGameUnrealTemplate) throw new Error("UE5 模板 API 不可用");
        const result = await window.newbrain.createBrainGameUnrealTemplate({
          projectId: props.projectId,
          projectName: ueProjectName.trim() || props.projectName || "BrainGame",
          engineAssociation: ueEngineVersion
        });
        setMessage(`UE5 工程已创建 · ${result.uprojectPath} · 策划已导出到 ${result.docsRoot || "Docs/BRAIN"}`);
      }
      props.onCreated?.();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "模板创建失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="brain-game-template-wizard" data-testid="brain-game-template-wizard">
      <header>
        <strong>项目脚手架</strong>
        <small>AI 策划 + 手动编辑 + 导出 UE5 可打开工程</small>
      </header>
      <div className="brain-game-template-engine-tabs" role="tablist" aria-label="引擎类型">
        <button type="button" role="tab" aria-selected={engine === "web"} className={engine === "web" ? "active" : ""} onClick={() => setEngine("web")}>Web 试玩</button>
        <button type="button" role="tab" aria-selected={engine === "unreal"} className={engine === "unreal" ? "active" : ""} onClick={() => setEngine("unreal")}>UE5 工程</button>
      </div>
      {engine === "unreal" ? (
        <div className="brain-game-template-ue-fields">
          <label>
            <span>工程名（.uproject）</span>
            <input aria-label="UE 工程名" value={ueProjectName} onChange={(event) => setUeProjectName(event.target.value)} disabled={busy} placeholder="BrainGame" />
          </label>
          <label>
            <span>引擎版本</span>
            <select aria-label="UE 引擎版本" value={ueEngineVersion} onChange={(event) => setUeEngineVersion(event.target.value)} disabled={busy}>
              <option value="5.3">5.3</option>
              <option value="5.4">5.4</option>
              <option value="5.5">5.5</option>
            </select>
          </label>
          <small>将创建 .uproject、Config（Enhanced Input + GameplayTags）、Docs/BRAIN 策划目录，并同步当前四个策划 Tab 内容。</small>
        </div>
      ) : (
        <small>一键生成 package.json 与本地试玩入口（5173）。</small>
      )}
      <button
        type="button"
        data-testid={engine === "web" ? "brain-game-create-web-template" : "brain-game-create-unreal-template"}
        onClick={() => void create()}
        disabled={!props.projectId || busy}
      >
        {busy ? "创建中…" : engine === "web" ? "创建 Web 游戏模板" : "创建 UE5 工程并导出策划"}
      </button>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
