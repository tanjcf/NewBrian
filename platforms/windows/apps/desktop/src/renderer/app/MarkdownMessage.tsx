import { Component, isValidElement, memo, useEffect, useId, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { isArtifactFilePath, isLocalFileLink, parseLocalFileReference, resolveLocalFileLinkTarget, type LocalFileReference } from "./local-file-link";
import { normalizeStreamingMarkdown, safeMarkdownUrl } from "./streaming-markdown";
import { LocalFileContextMenu, positionLocalFileMenu, type LocalFileMenuState } from "./LocalFileContextMenu";

type OpenLocalFile = (filePath: string, location?: Omit<LocalFileReference, "filePath">) => void;

class MarkdownErrorBoundary extends Component<{ content: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Markdown rendering failed", error, info.componentStack);
  }

  componentDidUpdate(previous: { content: string }) {
    if (this.state.failed && previous.content !== this.props.content) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="markdown-render-error" role="alert">
      <strong>Markdown 渲染失败</strong>
      <button type="button" onClick={() => this.setState({ failed: false })}>重试</button>
      <pre>{this.props.content}</pre>
    </div>;
  }
}

function openLocalFile(workspaceId: string, reference: LocalFileReference, onOpenLocalFile?: OpenLocalFile) {
  if (onOpenLocalFile) onOpenLocalFile(reference.filePath, reference);
  else window.dispatchEvent(new CustomEvent("newbrain:open-local-file", { detail: { workspaceId, ...reference } }));
}

function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const diagramId = `newbrain-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: "neutral" });
      const result = await mermaid.render(diagramId, source);
      if (active) { setSvg(result.svg); setError(""); }
    }).catch((reason: unknown) => {
      if (active) { setSvg(""); setError(reason instanceof Error ? reason.message : "Mermaid 图表无法渲染"); }
    });
    return () => { active = false; };
  }, [reactId, source]);

  if (error) return <div className="markdown-mermaid-error" role="alert"><strong>Mermaid 图表无法渲染</strong><span>{error}</span><pre>{source}</pre></div>;
  if (!svg) return <div className="markdown-mermaid-loading">正在渲染图表…</div>;
  return <div className="markdown-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const child = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
  const className = child?.props.className ?? "";
  const language = /(?:^|\s)language-([^\s]+)/.exec(className)?.[1] ?? "text";
  const source = String(child?.props.children ?? "").replace(/\n$/, "");
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(source.split("\n").length > 24);
  const [wrap, setWrap] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const canCollapse = source.split("\n").length > 24;
  useEffect(() => () => { if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current); }, []);
  if (language.toLowerCase() === "mermaid") return <MermaidDiagram source={source} />;
  const codeContent = language.toLowerCase() === "diff"
    ? <code>{source.split("\n").map((line, index) => <span className={line.startsWith("+") && !line.startsWith("+++") ? "diff-add" : line.startsWith("-") && !line.startsWith("---") ? "diff-remove" : line.startsWith("@@") ? "diff-hunk" : undefined} key={`${index}-${line.slice(0, 24)}`}>{line}{index < source.split("\n").length - 1 ? "\n" : ""}</span>)}</code>
    : children;
  return <div className="markdown-code-shell">
    <div className="markdown-code-toolbar"><span>{language}</span><div>
      {canCollapse ? <button type="button" onClick={() => setCollapsed((value) => !value)}>{collapsed ? "展开" : "折叠"}</button> : null}
      <button type="button" aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>{wrap ? "取消换行" : "自动换行"}</button>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(source).then(() => { setCopied(true); if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current); copiedTimer.current = window.setTimeout(() => setCopied(false), 1400); }); }}>{copied ? "已复制" : "复制"}</button>
    </div></div>
    <pre className={`markdown-code-block${collapsed ? " is-collapsed" : ""}${wrap ? " is-wrapped" : ""}`}>{codeContent}</pre>
  </div>;
}

function markdownComponents(workspaceId?: string, onOpenLocalFile?: OpenLocalFile): Components {
  return {
    a({ href = "", children, ...props }) {
      const visibleTarget = typeof children === "string" ? children.trim() : "";
      const localTarget = resolveLocalFileLinkTarget(href, visibleTarget);
      const reference = onOpenLocalFile && localTarget ? parseLocalFileReference(localTarget) : null;
      const local = Boolean(reference);
      const localHref = reference ? localTarget! : "";
      const citation = reference?.line ? `第 ${reference.line}${reference.endLine ? `–${reference.endLine}` : ""} 行` : "";
      return <a {...props} href={local ? localHref : safeMarkdownUrl(href)} target={local ? undefined : "_blank"} rel={local ? undefined : "noreferrer"}
        title={local ? `${citation ? `${citation} · ` : ""}在 NewBrain 中打开` : props.title}
        data-local-file-path={reference?.filePath} data-local-file-line={reference?.line}
        data-local-file-end-line={reference?.endLine} data-local-file-column={reference?.column}
        onClick={local ? (event) => { event.preventDefault(); openLocalFile(workspaceId || "", reference!, onOpenLocalFile); } : undefined}
      >{children}{citation ? <span className="markdown-file-line-badge">{citation}</span> : null}</a>;
    },
    code({ className, children, ...props }) {
      const value = String(children).replace(/\n$/, "");
      const isBlock = Boolean(className?.startsWith("language-") || value.includes("\n"));
      const reference = parseLocalFileReference(value);
      const localArtifact = Boolean(!isBlock && onOpenLocalFile && isArtifactFilePath(reference.filePath) && isLocalFileLink(reference.filePath));
      if (localArtifact) return <a href={value} className="markdown-artifact-link" title="在 NewBrain 中打开"
        data-local-file-path={reference.filePath} data-local-file-line={reference.line} data-local-file-end-line={reference.endLine}
        onClick={(event) => { event.preventDefault(); openLocalFile(workspaceId || "", reference, onOpenLocalFile); }}
      ><code {...props}>{children}</code>{reference.line ? <span className="markdown-file-line-badge">第 {reference.line}{reference.endLine ? `–${reference.endLine}` : ""} 行</span> : null}</a>;
      return <code {...props} className={className}>{children}</code>;
    },
    input({ type, ...props }) { return <input {...props} type={type} disabled={type === "checkbox" || props.disabled} />; },
    pre({ children }) { return <CodeBlock>{children}</CodeBlock>; },
    table({ children }) { return <div className="markdown-table-wrap"><table>{children}</table></div>; }
  };
}

const MarkdownDocument = memo(function MarkdownDocument({ content, components }: { content: string; components: Components }) {
  return <ReactMarkdown components={components} remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} urlTransform={safeMarkdownUrl}>
    {content}
  </ReactMarkdown>;
});

type MarkdownSection = { level: number; heading: string; body: string[]; children: MarkdownSection[] };

function parseMarkdownSections(content: string) {
  const root: MarkdownSection = { level: 0, heading: "", body: [], children: [] };
  const stack = [root];
  let fence = "";
  for (const line of content.split("\n")) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = "";
    }
    const heading = !fence ? line.match(/^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/) : null;
    if (!heading) {
      stack.at(-1)!.body.push(line);
      continue;
    }
    const section: MarkdownSection = { level: heading[1].length, heading: heading[2], body: [], children: [] };
    while (stack.at(-1)!.level >= section.level) stack.pop();
    stack.at(-1)!.children.push(section);
    stack.push(section);
  }
  return root;
}

function MarkdownSectionView({ section, components, path }: { section: MarkdownSection; components: Components; path: string }) {
  return <details className={`markdown-section markdown-section-level-${section.level}`} open>
    <summary><MarkdownDocument content={`${"#".repeat(section.level)} ${section.heading}`} components={components} /></summary>
    <div className="markdown-section-content">
      {section.body.join("\n").trim() ? <MarkdownDocument content={section.body.join("\n")} components={components} /> : null}
      {section.children.map((child, index) => <MarkdownSectionView
        key={`${path}-${index}`}
        section={child}
        components={components}
        path={`${path}-${index}`}
      />)}
    </div>
  </details>;
}

const CollapsibleMarkdownDocument = memo(function CollapsibleMarkdownDocument({ content, components }: { content: string; components: Components }) {
  const sections = useMemo(() => parseMarkdownSections(content), [content]);
  const sectionCount = useMemo(() => {
    let count = 0;
    const visit = (items: MarkdownSection[]) => items.forEach((item) => { count += 1; visit(item.children); });
    visit(sections.children);
    return count;
  }, [sections]);
  if (!sections.children.length || sectionCount > 200) return <MarkdownDocument content={content} components={components} />;
  return <>
    {sections.body.join("\n").trim() ? <MarkdownDocument content={sections.body.join("\n")} components={components} /> : null}
    {sections.children.map((section, index) => <MarkdownSectionView
      key={`s-${index}`}
      section={section}
      components={components}
      path={`${index}`}
    />)}
  </>;
});

function useStreamingSnapshot(content: string, isStreaming: boolean) {
  const [snapshot, setSnapshot] = useState(content);
  const latest = useRef(content);
  const frame = useRef<number | null>(null);
  latest.current = content;

  useEffect(() => {
    if (!isStreaming) {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
      setSnapshot(content);
      return;
    }
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      setSnapshot(latest.current);
    });
  }, [content, isStreaming]);

  useEffect(() => () => { if (frame.current !== null) window.cancelAnimationFrame(frame.current); }, []);
  return isStreaming ? snapshot : content;
}

function MarkdownMessageView({ content, workspaceId, onOpenLocalFile, isStreaming = false }: {
  content: string;
  workspaceId?: string;
  onOpenLocalFile?: OpenLocalFile;
  priorOrderedItemCount?: number;
  isStreaming?: boolean;
}) {
  const [fileMenu, setFileMenu] = useState<LocalFileMenuState | null>(null);
  const [showSource, setShowSource] = useState(false);
  const streamingSnapshot = useStreamingSnapshot(content, isStreaming);
  const renderableContent = useMemo(() => normalizeStreamingMarkdown(streamingSnapshot, isStreaming), [streamingSnapshot, isStreaming]);
  const components = useMemo(() => markdownComponents(workspaceId, onOpenLocalFile), [workspaceId, onOpenLocalFile]);

  return <div className={`markdown-message${isStreaming ? " markdown-message-streaming" : ""}`} onContextMenu={(event) => {
    const link = (event.target as HTMLElement).closest<HTMLElement>("[data-local-file-path]");
    const filePath = link?.dataset.localFilePath;
    if (!filePath || !workspaceId) return;
    event.preventDefault();
    setFileMenu(positionLocalFileMenu(link, {
        filePath,
        line: Number(link?.dataset.localFileLine) || undefined,
        endLine: Number(link?.dataset.localFileEndLine) || undefined,
        column: Number(link?.dataset.localFileColumn) || undefined
      }, { x: event.clientX, y: event.clientY }));
  }}>
    {!isStreaming ? <div className="markdown-view-toolbar"><button type="button" aria-pressed={showSource} onClick={() => setShowSource((value) => !value)}>{showSource ? "渲染视图" : "查看源码"}</button></div> : null}
    {showSource ? <pre className="markdown-source-view"><code>{content}</code></pre> : <MarkdownErrorBoundary content={renderableContent}>
        {/*
          Windows-only: Chromium scroll anchoring + stick-to-bottom fights Collapsible
          heading remounts while tokens stream, so answer text jumps up/down. Other OS
          builds do not hit this; keep flat MarkdownDocument only on Windows.
        */}
        {isStreaming
          ? <MarkdownDocument content={renderableContent} components={components} />
          : <CollapsibleMarkdownDocument content={renderableContent} components={components} />}
      </MarkdownErrorBoundary>}
    {fileMenu && workspaceId ? <LocalFileContextMenu menu={fileMenu} workspaceId={workspaceId}
      onClose={() => setFileMenu(null)} /> : null}
  </div>;
}

export const MarkdownMessage = memo(MarkdownMessageView);
