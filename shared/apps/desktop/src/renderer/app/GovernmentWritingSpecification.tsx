import { useEffect, useMemo, useState } from "react";

type SpecificationSnapshot = any;

function isStyleRequirement(item: { key?: string; label?: string; value?: string }) {
  const haystack = `${item.key ?? ""}\n${item.label ?? ""}\n${item.value ?? ""}`;
  return /文体|文种|体裁|语言|文风|语气|修辞|数据|可考|引用|原话|篇幅|字数/u.test(haystack);
}

function toMarkdown(content: any) {
  if (!content) return "";
  const requirements = Array.isArray(content.requirements) ? content.requirements : [];
  const core = requirements.filter((item: any) => !isStyleRequirement(item));
  const style = requirements.filter((item: any) => isStyleRequirement(item));
  const lines = ["# 写作任务", "", String(content.task ?? ""), "", "# 核心要求", ""];
  for (const item of core) {
    lines.push(`${item.label}：${item.value}${item.status === "pending" ? "（待确认）" : ""}`, "");
  }
  const cases = Array.isArray(content.cases) ? content.cases : [];
  if (cases.length) {
    lines.push("案例选取：", "");
    for (const item of cases) lines.push(`- ${item.name}：${item.plannedUse}（核验：${item.status}）`);
    lines.push("");
  }
  lines.push("# 案例与官方证据", "");
  for (const item of cases) {
    lines.push(`## ${item.name}`, "", item.plannedUse, "");
    for (const evidence of item.evidence ?? []) {
      lines.push(`- ${evidence.title}｜${evidence.authority}｜${evidence.url}｜状态:${evidence.status}`);
    }
    lines.push("");
  }
  lines.push("# 结构模板", "");
  for (const section of content.structure ?? []) {
    const length = section.targetCharacters == null ? "未指定" : `${section.targetCharacters}字`;
    lines.push(`- ${section.title}：${section.points}｜建议篇幅:${length}｜核验:${section.verification}`);
  }
  lines.push("", "# 写作风格约束", "");
  if (!style.length) lines.push("（请在核心要求中补充文体、语言、数据使用、引用规范和篇幅。）", "");
  else {
    for (const item of style) {
      lines.push(`${item.label}：${item.value}${item.status === "pending" ? "（待确认）" : ""}`, "");
    }
  }
  lines.push("```json", JSON.stringify(content, null, 2), "```");
  return lines.join("\n");
}

function fromMarkdown(markdown: string) {
  const json = markdown.match(/```json\s*([\s\S]*?)```/iu)?.[1];
  if (!json) throw new Error("Markdown 中缺少 JSON 规格正文。");
  return JSON.parse(json);
}

export function GovernmentWritingSpecification(props: {
  snapshot: SpecificationSnapshot;
  busy: boolean;
  onSave: (content: any, source: "user-structured" | "user-markdown") => Promise<void>;
  onApplySuggestions: (suggestionIds: string[]) => Promise<void>;
  onConfirm: (versionId: string) => Promise<void>;
  onRequestModelRevision: (instruction: string) => void;
  onRequestModelGuidance: (instruction: string) => void;
}) {
  const content = props.snapshot?.currentVersion?.content;
  const [mode, setMode] = useState<"structured" | "markdown">("structured");
  const [draft, setDraft] = useState<any>(content);
  const [markdown, setMarkdown] = useState(content ? toMarkdown(content) : "");
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState("");
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(content), [draft, content]);
  const hasUnsavedChanges = mode === "markdown" ? markdown !== toMarkdown(content) : dirty;

  useEffect(() => {
    if (dirty) return;
    setDraft(content);
    setMarkdown(content ? toMarkdown(content) : "");
    setSelectedSuggestions([]);
  }, [content, dirty]);

  if (!content) return null;
  const updateRequirement = (index: number, key: "label" | "value", value: string) => setDraft((current: any) => ({
    ...current,
    requirements: current.requirements.map((item: any, itemIndex: number) => itemIndex === index ? { ...item, [key]: value } : item)
  }));
  const addRequirement = () => setDraft((current: any) => ({
    ...current,
    requirements: [...current.requirements, { key: crypto.randomUUID(), label: "新增要求", value: "待补充", status: "confirmed" }]
  }));
  const updateSection = (index: number, key: string, value: unknown) => setDraft((current: any) => ({
    ...current,
    structure: current.structure.map((item: any, itemIndex: number) => itemIndex === index ? { ...item, [key]: value } : item)
  }));
  const updateCase = (index: number, key: string, value: unknown) => setDraft((current: any) => ({
    ...current,
    cases: current.cases.map((item: any, itemIndex: number) => itemIndex === index ? { ...item, [key]: value } : item)
  }));
  const updateEvidence = (caseIndex: number, evidenceIndex: number, key: string, value: string) => setDraft((current: any) => ({
    ...current,
    cases: current.cases.map((item: any, itemIndex: number) => itemIndex === caseIndex ? {
      ...item,
      evidence: item.evidence.map((evidence: any, sourceIndex: number) => sourceIndex === evidenceIndex ? { ...evidence, [key]: value } : evidence)
    } : item)
  }));
  const moveSection = (index: number, offset: number) => setDraft((current: any) => {
    const next = [...current.structure];
    const target = index + offset;
    if (target < 0 || target >= next.length) return current;
    [next[index], next[target]] = [next[target], next[index]];
    return { ...current, structure: next };
  });
  const addSection = () => setDraft((current: any) => ({
    ...current,
    structure: [...current.structure, { sectionId: crypto.randomUUID(), level: 1, title: "新章节", points: "待补充", evidenceIds: [], targetCharacters: null, verification: "待核验" }]
  }));
  const switchMode = (next: "structured" | "markdown") => {
    setError("");
    if (next === "markdown") setMarkdown(toMarkdown(draft));
    if (next === "structured") {
      try { setDraft(fromMarkdown(markdown)); } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return;
      }
    }
    setMode(next);
  };
  const save = async () => {
    setError("");
    try {
      await props.onSave(mode === "markdown" ? fromMarkdown(markdown) : draft, mode === "markdown" ? "user-markdown" : "user-structured");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const suggestions = props.snapshot.suggestions ?? [];
  const pendingRequirements = draft.requirements.filter((item: any) => item.status === "pending");

  return (
    <section className="government-writing-specification" data-testid="government-writing-specification">
      <header className="government-spec-header">
        <div><strong>写作规格 · 第 {props.snapshot.currentVersion.versionNumber} 版</strong><span>{props.snapshot.confirmedVersionId === props.snapshot.currentVersionId ? "已确认" : "待确认"}</span></div>
        <div className="government-spec-mode" role="tablist" aria-label="编辑模式">
          <button type="button" className={mode === "structured" ? "active" : ""} onClick={() => switchMode("structured")}>表格</button>
          <button type="button" className={mode === "markdown" ? "active" : ""} onClick={() => switchMode("markdown")}>Markdown</button>
        </div>
      </header>

      {mode === "markdown" ? (
        <textarea className="government-spec-markdown" value={markdown} onChange={(event) => setMarkdown(event.target.value)} aria-label="Markdown 写作规格" />
      ) : (
        <div className="government-spec-content">
          <section><h4>写作任务</h4><textarea value={draft.task} onChange={(event) => setDraft({ ...draft, task: event.target.value })} /></section>
          <section><h4>核心要求</h4><div className="government-spec-fields">{draft.requirements.map((item: any, index: number) => <label key={item.key}><input aria-label="要求名称" value={item.label} onChange={(event) => updateRequirement(index, "label", event.target.value)} /><textarea value={item.value} onChange={(event) => updateRequirement(index, "value", event.target.value)} />{item.status === "pending" ? <span className="government-spec-pending">待用户确认</span> : null}<div><button type="button" disabled={item.status !== "pending"} onClick={() => setDraft((current: any) => ({ ...current, requirements: current.requirements.map((requirement: any, itemIndex: number) => itemIndex === index ? { ...requirement, status: "confirmed" } : requirement) }))}>确认此项</button><button type="button" disabled={draft.requirements.length === 1} onClick={() => setDraft((current: any) => ({ ...current, requirements: current.requirements.filter((_: any, itemIndex: number) => itemIndex !== index) }))}>删除要求</button></div></label>)}</div><button type="button" onClick={addRequirement}>添加要求</button></section>
          <section><h4>案例与官方证据</h4><div className="government-spec-table-wrap"><table><thead><tr><th>案例</th><th>计划内容</th><th>核验状态</th><th>官方来源</th></tr></thead><tbody>{draft.cases.map((item: any, caseIndex: number) => <tr key={item.caseId}><td><input value={item.name} onChange={(event) => updateCase(caseIndex, "name", event.target.value)} /></td><td><textarea value={item.plannedUse} onChange={(event) => updateCase(caseIndex, "plannedUse", event.target.value)} /></td><td><select value={item.status} onChange={(event) => updateCase(caseIndex, "status", event.target.value)}><option value="verified">已核验</option><option value="partial">部分核验</option><option value="missing">缺少证据</option><option value="replace">建议替换</option></select></td><td>{item.evidence.map((evidence: any, evidenceIndex: number) => <div key={evidence.evidenceId} className="government-spec-evidence"><input aria-label="来源标题" value={evidence.title} onChange={(event) => updateEvidence(caseIndex, evidenceIndex, "title", event.target.value)} /><input aria-label="政府网页地址" value={evidence.url} onChange={(event) => updateEvidence(caseIndex, evidenceIndex, "url", event.target.value)} /><a href={evidence.url} target="_blank" rel="noreferrer">打开</a></div>)}</td></tr>)}</tbody></table></div></section>
          <section><h4>结构模板</h4><div className="government-spec-table-wrap"><table><thead><tr><th>章节</th><th>内容要点</th><th>建议篇幅</th><th>核验要求</th><th>操作</th></tr></thead><tbody>{draft.structure.map((item: any, index: number) => <tr key={item.sectionId}><td><input value={item.title} onChange={(event) => updateSection(index, "title", event.target.value)} /></td><td><textarea value={item.points} onChange={(event) => updateSection(index, "points", event.target.value)} /></td><td><input type="number" value={item.targetCharacters ?? ""} onChange={(event) => updateSection(index, "targetCharacters", event.target.value ? Number(event.target.value) : null)} /></td><td><textarea value={item.verification} onChange={(event) => updateSection(index, "verification", event.target.value)} /></td><td><button type="button" disabled={index === 0} onClick={() => moveSection(index, -1)}>上移</button><button type="button" disabled={index === draft.structure.length - 1} onClick={() => moveSection(index, 1)}>下移</button><button type="button" disabled={draft.structure.length === 1} onClick={() => setDraft((current: any) => ({ ...current, structure: current.structure.filter((_: any, itemIndex: number) => itemIndex !== index) }))}>删除</button></td></tr>)}</tbody></table></div><button type="button" onClick={addSection}>添加章节</button></section>
        </div>
      )}

      {suggestions.length ? <section className="government-spec-suggestions"><h4>修改建议</h4>{suggestions.map((suggestion: any) => <label key={suggestion.suggestionId}><input type="checkbox" checked={selectedSuggestions.includes(suggestion.suggestionId)} onChange={(event) => setSelectedSuggestions((current) => event.target.checked ? [...current, suggestion.suggestionId] : current.filter((id) => id !== suggestion.suggestionId))} /><span><strong>{suggestion.reason}</strong><br />建议改为：{suggestion.proposedValue}</span></label>)}<div><button type="button" disabled={props.busy} onClick={() => void props.onApplySuggestions(suggestions.map((item: any) => item.suggestionId))}>全部应用</button><button type="button" disabled={props.busy || !selectedSuggestions.length} onClick={() => void props.onApplySuggestions(selectedSuggestions)}>应用所选建议</button></div></section> : null}
      {error ? <p className="government-spec-error" role="alert">{error}</p> : null}
      <div className="government-spec-model-actions"><input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="输入修改方向" /><button type="button" onClick={() => props.onRequestModelRevision(instruction)}>让大模型修改</button><button type="button" onClick={() => props.onRequestModelGuidance(instruction)}>让大模型指导修改</button></div>
      <footer className="government-spec-actions">
        <span>当前版本：{props.snapshot.currentVersionId.slice(0, 8)}</span>
        <button type="button" disabled={props.busy || !hasUnsavedChanges} onClick={() => void save()}>保存新版本</button>
        <button type="button" className="primary" disabled={props.busy || hasUnsavedChanges || pendingRequirements.length > 0 || props.snapshot.confirmedVersionId === props.snapshot.currentVersionId} onClick={() => void props.onConfirm(props.snapshot.currentVersionId)}>确认并开始写作</button>
      </footer>
    </section>
  );
}
