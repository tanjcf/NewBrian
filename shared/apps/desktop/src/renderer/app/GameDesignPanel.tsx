import { useEffect, useMemo, useState } from "react";
import type { BrainWorkspaceKey } from "@codex-forge/protocol";
import {
  emptyGameDesignFields,
  gameDesignSectionSchemas,
  parseGameDesignContent,
  stripJsonFence,
} from "./game-design-section-schemas";

export function GameDesignPanel(props: {
  projectId?: string;
  workspaceKey: BrainWorkspaceKey;
  sectionKey: string;
  title: string;
  description: string;
  onGenerate?: (focusPrompt?: string) => Promise<string>;
}) {
  const schema = gameDesignSectionSchemas[props.sectionKey] || gameDesignSectionSchemas.world;
  const [fields, setFields] = useState<Record<string, string>>(() => emptyGameDesignFields(schema));
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "saving" | "generating">("idle");
  const [message, setMessage] = useState("");
  const dirty = useMemo(() => JSON.stringify(fields) !== savedSnapshot, [fields, savedSnapshot]);

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return "尚未保存";
    const date = new Date(updatedAt);
    return Number.isNaN(date.valueOf()) ? `修订 ${revision}` : `修订 ${revision} · ${date.toLocaleString("zh-CN")}`;
  }, [revision, updatedAt]);

  const load = async () => {
    if (!props.projectId || !window.newbrain?.getBrainWorkspaceSection) return;
    setState("loading");
    try {
      const section = await window.newbrain.getBrainWorkspaceSection({
        projectId: props.projectId, workspaceKey: props.workspaceKey, sectionKey: props.sectionKey
      });
      const nextFields = parseGameDesignContent(section.content, schema);
      setFields(nextFields);
      setSavedSnapshot(JSON.stringify(nextFields));
      setRevision(section.revision);
      setUpdatedAt(section.updatedAt || "");
      setState("ready");
    } catch {
      const empty = emptyGameDesignFields(schema);
      setFields(empty);
      setSavedSnapshot(JSON.stringify(empty));
      setState("ready");
    }
  };

  useEffect(() => { void load(); }, [props.projectId, props.workspaceKey, props.sectionKey]);

  const save = async () => {
    if (!props.projectId || !window.newbrain?.saveBrainWorkspaceSection || !dirty) return;
    setState("saving");
    try {
      const result = await window.newbrain.saveBrainWorkspaceSection({
        projectId: props.projectId,
        workspaceKey: props.workspaceKey,
        sectionKey: props.sectionKey,
        content: JSON.stringify(fields, null, 2),
        expectedRevision: revision
      });
      setRevision(result.revision);
      setUpdatedAt(result.updatedAt || "");
      setSavedSnapshot(JSON.stringify(fields));
      setMessage("策划稿已保存");
      setState("ready");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "保存失败");
      setState("ready");
    }
  };

  const generate = async (focusPrompt?: string) => {
    if (!props.onGenerate) return;
    setState("generating"); setMessage("");
    try {
      const generated = stripJsonFence(await props.onGenerate(focusPrompt));
      const parsed = parseGameDesignContent(generated, schema);
      setFields(parsed);
      setMessage(focusPrompt ? `已生成「${focusPrompt}」相关内容，请确认后保存。` : "AI 初稿已生成，请确认后保存。");
      setState("ready");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "AI 生成失败");
      setState("ready");
    }
  };

  const update = (key: string, value: string) => setFields((current) => ({ ...current, [key]: value }));

  return (
    <section className="brain-section-editor brain-design-panel" data-testid={`brain-design-${props.sectionKey}`}>
      <header>
        <div><span>游戏制作</span><strong>{props.title}</strong><small>{props.description}</small></div>
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
      {!props.projectId ? <div className="brain-workspace-plugin-empty"><strong>请先选择项目</strong></div> : (
        <>
          <div className="brain-section-editor-prompts" aria-label="创作提示">
            {schema.prompts.map((prompt) => (
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
          <div className="brain-design-fields">
            {schema.fields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                {field.rows && field.rows > 1 ? (
                  <textarea value={fields[field.key] || ""} onChange={(e) => update(field.key, e.target.value)} rows={field.rows} disabled={state === "generating"} />
                ) : (
                  <input value={fields[field.key] || ""} onChange={(e) => update(field.key, e.target.value)} disabled={state === "generating"} />
                )}
              </label>
            ))}
            {message ? <p className={`brain-section-editor-message ${message.includes("失败") ? "error" : "ready"}`}>{message}</p> : null}
          </div>
        </>
      )}
    </section>
  );
}
