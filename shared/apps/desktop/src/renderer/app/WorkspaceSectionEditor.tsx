import { useEffect, useMemo, useState } from "react";
import type { BrainWorkspaceKey, BrainWorkspaceSectionDto } from "@codex-forge/protocol";

interface WorkspaceSectionEditorProps {
  projectId?: string;
  workspaceKey: BrainWorkspaceKey;
  sectionKey: string;
  title: string;
  description: string;
  prompts: string[];
  onGenerate?: (focusPrompt?: string) => Promise<string>;
}

const emptySection = (projectId: string, workspaceKey: BrainWorkspaceKey, sectionKey: string): BrainWorkspaceSectionDto => ({
  schemaVersion: 1, projectId, workspaceKey, sectionKey, content: "", revision: 0, createdAt: "", updatedAt: ""
});

export function WorkspaceSectionEditor(props: WorkspaceSectionEditorProps) {
  const [section, setSection] = useState<BrainWorkspaceSectionDto>(() => emptySection(props.projectId || "", props.workspaceKey, props.sectionKey));
  const [content, setContent] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "saving" | "generating" | "error" | "conflict">("idle");
  const [message, setMessage] = useState("");
  const dirty = content !== section.content;

  const updatedLabel = useMemo(() => {
    if (!section.updatedAt) return "尚未保存";
    const date = new Date(section.updatedAt);
    return Number.isNaN(date.valueOf()) ? `修订 ${section.revision}` : `修订 ${section.revision} · ${date.toLocaleString("zh-CN")}`;
  }, [section.revision, section.updatedAt]);

  const load = async () => {
    if (!props.projectId || !window.newbrain?.getBrainWorkspaceSection) {
      const empty = emptySection(props.projectId || "", props.workspaceKey, props.sectionKey);
      setSection(empty); setContent(""); setState("idle"); setMessage("");
      return;
    }
    setState("loading"); setMessage("");
    try {
      const result = await window.newbrain.getBrainWorkspaceSection({ projectId: props.projectId, workspaceKey: props.workspaceKey, sectionKey: props.sectionKey });
      setSection(result); setContent(result.content); setState("ready");
    } catch (reason) {
      setState("error");
      setMessage(reason instanceof Error ? reason.message : "创作稿加载失败");
    }
  };

  useEffect(() => { void load(); }, [props.projectId, props.workspaceKey, props.sectionKey]);

  const save = async () => {
    if (!props.projectId || !window.newbrain?.saveBrainWorkspaceSection || !dirty) return;
    setState("saving"); setMessage("");
    try {
      const result = await window.newbrain.saveBrainWorkspaceSection({
        projectId: props.projectId, workspaceKey: props.workspaceKey, sectionKey: props.sectionKey,
        content, expectedRevision: section.revision
      });
      setSection(result); setContent(result.content); setState("ready"); setMessage("已保存到当前项目");
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      setState(detail.includes("BRAIN_WORKSPACE_SECTION_CONFLICT") ? "conflict" : "error");
      setMessage(detail.includes("BRAIN_WORKSPACE_SECTION_CONFLICT") ? "该创作稿已在其他窗口修改，请重新加载后合并内容。" : "创作稿保存失败。");
    }
  };

  const generate = async (focusPrompt?: string) => {
    if (!props.onGenerate) return;
    setState("generating"); setMessage("");
    try {
      const generated = await props.onGenerate(focusPrompt);
      if (generated.trim()) {
        setContent(generated.trim());
        setMessage(focusPrompt ? `已生成「${focusPrompt}」相关内容，请确认后保存。` : "AI 初稿已生成，请确认后保存。");
      } else {
        setMessage("模型没有返回可用内容。");
      }
      setState("ready");
    } catch (reason) {
      setState("error");
      setMessage(reason instanceof Error ? reason.message : "AI 生成失败");
    }
  };

  return <section className="brain-section-editor" aria-label={props.title} data-testid={`brain-section-${props.sectionKey}`}>
    <header>
      <div><span>{props.workspaceKey === "game" ? "游戏制作" : "BRAIN"}</span><strong>{props.title}</strong><small>{props.description}</small></div>
      <div className="brain-section-editor-actions">
        <small>{updatedLabel}{dirty ? " · 未保存" : ""}</small>
        {props.onGenerate ? (
          <button type="button" className="brain-section-generate-btn" data-testid="brain-section-generate" onClick={() => void generate()} disabled={!props.projectId || state === "generating" || state === "saving"}>
            {state === "generating" ? "生成中…" : "AI 生成"}
          </button>
        ) : null}
        <button type="button" onClick={() => void save()} disabled={!props.projectId || !dirty || state === "saving" || state === "generating"}>{state === "saving" ? "保存中…" : "保存"}</button>
      </div>
    </header>
    {!props.projectId ? <div className="brain-workspace-plugin-empty"><strong>请先选择项目</strong><span>创作稿按项目与工作台独立保存。</span></div> : <>
      <div className="brain-section-editor-prompts" aria-label="创作提示">
        {props.prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="brain-section-prompt-chip"
            disabled={!props.onGenerate || state === "generating"}
            onClick={() => props.onGenerate ? void generate(prompt) : undefined}
          >
            {prompt}
          </button>
        ))}
      </div>
      <textarea aria-label={`${props.title}内容`} value={content} onChange={(event) => setContent(event.target.value)} disabled={state === "loading" || state === "generating"} placeholder={state === "loading" ? "正在加载创作稿…" : state === "generating" ? "AI 正在生成…" : `在这里编写${props.title}，或点击 AI 生成`} />
      {message ? <p className={`brain-section-editor-message ${state}`}>{message}</p> : null}
      {state === "conflict" ? <button className="brain-section-editor-reload" type="button" onClick={() => void load()}>重新加载最新版本</button> : null}
    </>}
  </section>;
}
