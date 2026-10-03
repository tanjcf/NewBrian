// @ts-nocheck
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PreviewPlacement } from "./desktop-model";
import { MarkdownMessage } from "./MarkdownMessage";
import { NovelTtsButton } from "./NovelTtsButton";
import { AssistantThinkingPanel } from "./AssistantThinkingPanel";
import { automationIntentExamples, isAutomationCreationRequest, parseAutomationIntent, resolveAutomationCreationText } from "./parseAutomationIntent";
import { copyTextToClipboard } from "./clipboard-text";
import {
  artifactPathsReferToSameFile,
  buildFilePreviewDiagnosticContext,
  classifyArtifactPreviewPayload,
  classifyFilePreviewError,
  classifySoftFilePreviewFailure,
  classifyTextPreviewPayload,
  FILE_PREVIEW_MAX_ATTEMPTS,
  FILE_PREVIEW_TIMEOUT_MS,
  filePreviewRetryDelayMs,
  findMatchingArtifactTab,
  formatFilePreviewStatus,
  isAudioPreviewFileName,
  isReusableArtifactPreview,
  isStaleFilePreviewRequest,
  isWorkspaceArtifactPreviewPath,
  patchArtifactTabsForRequest,
  withFilePreviewTimeout,
  type FilePreviewIssue
} from "./file-preview-policy";
import {
  estimateContextMeter,
  formatContextMeterBreakdown,
  formatContextTokens,
  readServerEstimatedTokens
} from "./context-meter-policy";
import { ComposerTextarea, type ComposerTextareaHandle } from "./ComposerTextarea";
import { buildApprovalUx } from "./approval-ux.ts";
import {
  conversationRefKey,
  filterConversationRefCandidates,
  injectConversationRefsIntoQuestion,
  mergeConversationRef,
  replaceComposerMentionRange,
  selectRecentConversationTurns,
  type ConversationRef,
  type ConversationRefCandidate
} from "./conversation-refs.ts";
import { DeliveryPreferenceChip } from "./DeliveryPreferenceChip";
import {
  EMPTY_DELIVERY_PREFERENCE_CHIP,
  normalizeDeliveryPreferenceChip,
  type DeliveryPreferenceChipState
} from "./delivery-preference-chip.ts";
import {
  COMPOSER_TEXTAREA_DEFAULT_HEIGHT,
  COMPOSER_TEXTAREA_HEIGHT_STORAGE_KEY,
  COMPOSER_TEXTAREA_MAX_HEIGHT,
  nextComposerTextareaHeight,
  readStoredComposerTextareaHeight
} from "./composer-resize.ts";
import { SidebarIcon } from "./SidebarIcon";
import { buildResearchWritingSources, defaultResearchWritingSession, researchWritingStorageKey, type DynamicResearchIntakeQuestion, type DynamicResearchPlanStep, type ResearchWritingSession } from "./research-writing";
import { isCustomModelSelection } from "../../shared/custom-model-endpoint";
import { CustomModelEndpointMenu } from "./CustomModelEndpointMenu";
import { sanitizeVisibleModelContent } from "../../shared/model-content-visibility.js";
import { GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED } from "../../shared/product-flags.js";
import { isSubscriptionInactiveError } from "../../shared/model-user-facing-error.ts";
import { builtinPluginCatalog } from "../../shared/builtin-plugins";
import { executionKindDescription, executionKindLabel } from "../../shared/plugin-execution";
import { projectPersistedActivities } from "./persisted-activity-policy";
import {
  groupActivitiesByUserMessage,
  resolveActiveReasoningRequestId,
  resolvePendingApprovalThreadKey,
  resolveSelectedThreadOwnsLiveApproval,
  threadStillNeedsApproval
} from "./thread-activity-policy";
import { stripApprovalWaitNotice } from "../../shared/approval-wait-notice.ts";
import { sortCodexSidebarThreads, type CodexSidebarSortMode } from "./codex-sidebar-model";
import { resolveLocalArtifactHref } from "./local-file-link";
import { crossSceneRecentProjects, filterWorkspaceCatalogByScene, isUserVisibleThread, orderSidebarProjects, projectSearchResults, normalizeWorkspaceCatalog, resolveCatalogBrainWorkspaceKey, resolveSceneExecutionWorkspace, resolveUserVisibleThreadSelection, sceneChatWorkspaces } from "./workspace-visibility";
import {
  buildLegacyConversationThreadMappings,
  mergeConversationThreadMappings,
  resolveBrainProjectForWorkspace,
  parseLegacyConversationThreadId,
  resolveLegacyConversationIdForThread,
  shouldSyncBrainConversationThread
} from "./brain-project-binding";
import {
  LEGACY_SIDEBAR_ROW_STORAGE_KEY,
  resolveLegacySidebarRowForThread,
  resolveSidebarRowThreadTarget,
  shouldPreferSidebarRowThreadRestore
} from "./thread-hydration";
import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from "@aiden0z/pptx-renderer";
import { HolonWorkspace } from "./HolonWorkspace";
import { ExpertsMarketplace } from "./ExpertsMarketplace";
import { WorkspaceArtifactViewerHost } from "./artifact-viewer-registry";
import { DocumentAnnotationLayer } from "./DocumentAnnotationLayer";
import { annotationPageNumber, attachMarkOverlay, buildAnnotationChatReference, bindDocxPreviewParagraphs, buildMarkingAnchor, documentAnchorsNeedChunkRefresh, isValidDocumentMarkRect, linesFromPreviewRect, resolveDocxAnchorFromMark, resolveMarkdownAnchorFromMark, resolvePdfAnchorFromMark, resolvePptxAnchorFromMark, resolveTxtAnchorFromMark, resolveXlsxAnchorFromMark } from "./document-annotation-policy";
import { captureAnnotationSnapshot, dataUrlToArrayBuffer, resolveAnnotationSnapshotPreview } from "./document-annotation-snapshot";
import { DocumentMarkingLayer, DocumentMarkPromptProvider, renderTextLineMarks } from "./DocumentMarkingLayer";
import { WorkspaceSpreadsheetViewer } from "./WorkspaceSpreadsheetViewer";
import { ANNOTATION_MARKING_COLORS } from "@codex-forge/protocol";
import type { AnnotationMarkingTool } from "@codex-forge/protocol";
import { QuantWorkspace } from "./QuantWorkspace";
import { GameWorkspace } from "./GameWorkspace";
import { GameLevelEditor } from "./GameLevelEditor";
import { GameDesignPanel } from "./GameDesignPanel";
import { VideoStoryboardPanel } from "./VideoStoryboardPanel";
import { VideoCaptionPanel } from "./VideoCaptionPanel";
import { MusicCompositionPanel } from "./MusicCompositionPanel";
import { VideoWorkspace } from "./VideoWorkspace";
import { VideoPipelineShell } from "./VideoPipelineShell";
import { MusicWorkspace } from "./MusicWorkspace";
import { MusicDawShell } from "./MusicDawShell";
import { DataWorkspace } from "./DataWorkspace";
import { DataJuliusShell } from "./DataJuliusShell";
import { SoftwareWorkspace } from "./SoftwareWorkspace";
import { FlowWorkspace } from "./FlowWorkspace";
import { DocumentWorkspace } from "./DocumentWorkspace";
import { WorkspaceSectionEditor } from "./WorkspaceSectionEditor";
import {
  INTERNAL_CHAT_WORKSPACE_ID,
  brainWorkspaceModes,
  isBrainWorkspaceKey,
  type BrainWorkspaceKey
} from "@codex-forge/protocol";
import {
  BRAIN_WORKSPACE_SELECTION_KEY,
  LEGACY_BRAIN_WORKSPACE_SELECTION_KEY,
  rememberBrainWorkspaceCatalog,
  restoreBrainWorkspaceSelection,
  selectBrainWorkspace
} from "./workspace-selection";

const fallbackBrainWorkspaces = brainWorkspaceModes.map((workspace) => ({ ...workspace, enabled: true }));

const brainWorkspaceIcon = (workspaceKey: string) =>
  brainWorkspaceModes.find((workspace) => workspace.workspaceKey === workspaceKey)?.icon || "folder";

const brainWorkspaceCapabilityTabs: Record<BrainWorkspaceKey, ReadonlyArray<{ key: string; label: string }>> = {
  // 场景学习探索 = NewBrain 原生工作台：右侧只保留项目资源（文件/产物/任务），无业务场景专属 Tools 页签。
  explore: [],
  quant: [
    { key: "market", label: "行情" },
    { key: "portfolio", label: "组合" },
    { key: "strategy", label: "策略" },
    { key: "radar", label: "雷达" },
    { key: "research", label: "研究笔记" }
  ],
  game: [
    { key: "level", label: "关卡" }, { key: "project", label: "项目与文件" },
    { key: "design", label: "游戏策划" }, { key: "world", label: "角色与世界观" },
    { key: "combat", label: "战斗设计" }, { key: "assets", label: "资产与测试" }
  ],
  video: [
    { key: "script", label: "脚本" }, { key: "storyboard", label: "分镜" },
    { key: "generate", label: "单镜生成" }, { key: "tracks", label: "本镜音视频轨" }
  ],
  music: [
    { key: "gen", label: "生成" }, { key: "tracks", label: "音轨" },
    { key: "slice", label: "标记切片" }, { key: "export", label: "导出" }
  ],
  data: [
    { key: "analysis", label: "Julius" }, { key: "import", label: "数据导入" },
    { key: "table", label: "数据表格" }, { key: "clean", label: "数据清洗" },
    { key: "chart", label: "图表" }, { key: "flow", label: "决策 Flow" }
  ],
  software: [
    { key: "terminal", label: "终端" }, { key: "code", label: "代码" },
    { key: "test", label: "测试" }, { key: "deploy", label: "部署" },
    { key: "flow", label: "Flow" }, { key: "files", label: "项目文件" }
  ],
  document: [
    { key: "preview", label: "文稿" }, { key: "review", label: "审校" },
    { key: "files", label: "项目与文件" }
  ]
};
import { WorkspaceHtmlViewer } from "./workspace-html-viewer";
import { WorkspaceVideoViewer } from "./workspace-video-viewer";
import { LocalFileContextMenu, positionLocalFileMenu, type LocalFileMenuState } from "./LocalFileContextMenu";
import {
  positionComposerPickerMenu,
  type ComposerPickerMenuPosition
} from "./composer-picker-menu-position";
import { respondToDelegatedAgentApproval } from "./delegated-agent-approval";
import { summarizeDelegatedAgents } from "./delegated-agent-summary";
import { clearStaleThreadApprovalInCatalog, markThreadApprovalSettlingInCatalog } from "./thread-order";
import {
  findLivePendingApprovalActivity,
  markApprovalActivitiesSettling,
  resolveEffectiveApproval
} from "./assistant-activity-merge";
import { recoverActiveThreadRetry } from "./generation-failure-recovery";
import { GovernmentWritingSpecification } from "./GovernmentWritingSpecification";
import { mergeRefreshedModelConfig } from "./model-config-refresh";
import { combineComposerQuote } from "./composer-quote";
import {
  composerQueueForThread,
  enqueueComposerDraft,
  removeComposerQueueItem,
  requeueComposerItemFirst
} from "./composer-queue";
import { isComposerAttachmentErrorMessage, normalizeComposerAttachmentError } from "./composer-attachment-errors";
import {
  insertComposerAttachmentTokens,
  removeComposerAttachmentToken
} from "./composer-attachment-insert";
import {
  COMPOSER_FOCUS_ATTACHMENT_LIMIT,
  COMPOSER_MATERIALS_MENU_ITEMS,
  composerAttachmentAccessLabel,
  composerFocusCapacityHint
} from "./composer-materials-policy";
import {
  shouldShowAppUpdateAutoPrompt
} from "./app-update-progress-copy";
import { AppUpdateDialog } from "./AppUpdateDialog";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function PdfPage({ document, pageNumber, scale, markingTool = "select-rect", markingColor = ANNOTATION_MARKING_COLORS[0], savedAnnotations = [], pendingMark = null, onMarkComplete }: {
  document: any;
  pageNumber: number;
  scale: number;
  markingTool?: AnnotationMarkingTool;
  markingColor?: string;
  savedAnnotations?: any[];
  pendingMark?: { rect: { x: number; y: number; width: number; height: number }; tool: AnnotationMarkingTool; color: string } | null;
  onMarkComplete?: (input: { rect: { x: number; y: number; width: number; height: number }; viewport: { width: number; height: number }; page: number; basisWidth: number; basisHeight: number; captureTarget: HTMLElement }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [pageBasis, setPageBasis] = useState({ width: 0, height: 0 });
  useEffect(() => {
    let canceled = false;
    let renderTask: any;
    let textLayer: TextLayer | undefined;
    void document.getPage(pageNumber).then((page: any) => {
      if (canceled || !canvasRef.current || !pageRef.current || !textLayerRef.current) return;
      const basisViewport = page.getViewport({ scale: 1 });
      setPageBasis({ width: basisViewport.width, height: basisViewport.height });
      const viewport = page.getViewport({ scale: 1.35 * scale });
      const canvas = canvasRef.current;
      const pageElement = pageRef.current;
      const textElement = textLayerRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      pageElement.style.width = `${viewport.width}px`;
      pageElement.style.setProperty("--pdf-page-ratio", String(viewport.width / viewport.height));
      renderTask = page.render({ canvasContext: canvas.getContext("2d"), viewport });
      return page.getTextContent().then((textContent: any) => {
        if (canceled) return;
        textElement.replaceChildren();
        textLayer = new TextLayer({ textContentSource: textContent, container: textElement, viewport });
        return Promise.all([renderTask.promise, textLayer.render()]);
      });
    });
    return () => {
      canceled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [document, pageNumber, scale]);
  return <div ref={pageRef} className="workspace-artifact-pdf-page-shell" data-page-number={pageNumber}>
    <canvas ref={canvasRef} className="workspace-artifact-pdf-page" />
    <div ref={textLayerRef} className="workspace-artifact-pdf-text-layer textLayer" />
    <DocumentMarkingLayer
      active={Boolean(onMarkComplete)}
      tool={markingTool}
      color={markingColor}
      savedAnnotations={savedAnnotations}
      pendingMark={pendingMark}
      pageFilter={pageNumber}
      onComplete={({ rect, viewport, host }) => {
        if (!pageBasis.width || !pageBasis.height) return;
        onMarkComplete?.({ rect, viewport, page: pageNumber, basisWidth: pageBasis.width, basisHeight: pageBasis.height, captureTarget: pageRef.current || host });
      }}
    />
  </div>;
}

function WorkspaceDocxViewer({ html, anchors, annotationActive, markingTool, markingColor, savedAnnotations, pendingMark, onMarkComplete }: {
  html: string;
  anchors: any[];
  annotationActive: boolean;
  markingTool: AnnotationMarkingTool;
  markingColor: string;
  savedAnnotations: any[];
  pendingMark: { rect: { x: number; y: number; width: number; height: number }; tool: AnnotationMarkingTool; color: string } | null;
  onMarkComplete: (input: { rect: { x: number; y: number; width: number; height: number }; viewport: { width: number; height: number }; host: HTMLElement }) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!contentRef.current) return;
    bindDocxPreviewParagraphs(contentRef.current, anchors);
  }, [html, anchors]);
  return (
    <div className="workspace-artifact-docx-shell">
      <div className="workspace-artifact-docx-host">
        <div
          ref={contentRef}
          className="workspace-artifact-docx"
          data-testid="workspace-docx-viewer"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <DocumentMarkingLayer
          active={annotationActive}
          tool={markingTool}
          color={markingColor}
          savedAnnotations={savedAnnotations}
          pendingMark={pendingMark}
          onComplete={({ rect, viewport, host }) => {
            onMarkComplete({ rect, viewport, host: contentRef.current || host });
          }}
        />
      </div>
    </div>
  );
}

function WorkspacePdfViewer({ dataUrl, annotationActive = false, markingTool = "select-rect", markingColor = ANNOTATION_MARKING_COLORS[0], savedAnnotations = [], pendingMark = null, onMarkComplete }: {
  dataUrl: string;
  annotationActive?: boolean;
  markingTool?: AnnotationMarkingTool;
  markingColor?: string;
  savedAnnotations?: any[];
  pendingMark?: { rect: { x: number; y: number; width: number; height: number }; tool: AnnotationMarkingTool; color: string } | null;
  onMarkComplete?: (input: { rect: { x: number; y: number; width: number; height: number }; viewport: { width: number; height: number }; page: number; basisWidth: number; basisHeight: number; captureTarget: HTMLElement }) => void;
}) {
  const [document, setDocument] = useState<any>(null);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const pagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let canceled = false;
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = window.atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const loadingTask = getDocument({ data: bytes });
    void loadingTask.promise
      .then((loadedDocument) => {
        if (!canceled) {
          setError("");
          setDocument(loadedDocument);
        }
      })
      .catch((reason: unknown) => {
        if (!canceled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      canceled = true;
      void loadingTask.destroy();
    };
  }, [dataUrl]);
  useEffect(() => {
    const viewport = pagesRef.current;
    if (!viewport || !document) return;
    const updateCurrentPage = () => {
      const pages = [...viewport.querySelectorAll<HTMLElement>("[data-page-number]")];
      const viewportTop = viewport.getBoundingClientRect().top + 24;
      const nearest = pages.reduce((best, page) => Math.abs(page.getBoundingClientRect().top - viewportTop) < Math.abs(best.getBoundingClientRect().top - viewportTop) ? page : best, pages[0]);
      if (nearest) setCurrentPage(Number(nearest.dataset.pageNumber || 1));
    };
    viewport.addEventListener("scroll", updateCurrentPage, { passive: true });
    return () => viewport.removeEventListener("scroll", updateCurrentPage);
  }, [document]);
  if (error) return <div className="search-file-preview-state error">PDF 加载失败：{error}</div>;
  if (!document) return <div className="search-file-preview-state">正在加载 PDF...</div>;
  const goToPage = (pageNumber: number) => {
    const nextPage = Math.min(document.numPages, Math.max(1, pageNumber));
    pagesRef.current?.querySelector(`[data-page-number="${nextPage}"]`)?.scrollIntoView({ block: "start" });
    setCurrentPage(nextPage);
  };
  return <div className="workspace-pdf-viewer">
    <div className="workspace-pdf-toolbar">
      <div>
        <button type="button" aria-label="上一页" title="上一页" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)}>‹</button>
        <span>{currentPage}/{document.numPages}</span>
        <button type="button" aria-label="下一页" title="下一页" disabled={currentPage >= document.numPages} onClick={() => goToPage(currentPage + 1)}>›</button>
      </div>
      <div>
        <button type="button" aria-label="缩小" title="缩小" disabled={scale <= 0.7} onClick={() => setScale((value) => Math.max(0.7, Number((value - 0.1).toFixed(1))))}>−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button type="button" aria-label="放大" title="放大" disabled={scale >= 1.6} onClick={() => setScale((value) => Math.min(1.6, Number((value + 0.1).toFixed(1))))}>+</button>
      </div>
    </div>
    <div className="workspace-artifact-pdf" ref={pagesRef}>{Array.from({ length: document.numPages }, (_, index) => (
      <PdfPage
        key={index + 1}
        document={document}
        pageNumber={index + 1}
        scale={scale}
        markingTool={markingTool}
        markingColor={markingColor}
        savedAnnotations={savedAnnotations}
        pendingMark={annotationActive && pendingMark ? pendingMark : null}
        onMarkComplete={annotationActive ? onMarkComplete : undefined}
      />
    ))}</div>
  </div>;
}

function WorkspacePptxViewer({ dataUrl }: {
  dataUrl: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PptxViewer | null>(null);
  const [state, setState] = useState<{ loading: boolean; error: string; slideCount: number; currentSlide: number }>({ loading: true, error: "", slideCount: 0, currentSlide: 0 });
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let canceled = false;
    const abortController = new AbortController();
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = window.atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    void PptxViewer.open(bytes.buffer, host, {
      renderMode: "slide",
      fitMode: "contain",
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      pdfjs: false,
      signal: abortController.signal,
      onSlideChange: (index) => setState((current) => ({ ...current, currentSlide: index }))
    })
      .then((viewer) => {
        if (canceled) {
          viewer.destroy();
          return;
        }
        viewerRef.current = viewer;
        setState({ loading: false, error: "", slideCount: viewer.slideCount, currentSlide: viewer.currentSlideIndex });
      })
      .catch((error: unknown) => {
        if (!canceled) setState({ loading: false, error: error instanceof Error ? error.message : String(error), slideCount: 0, currentSlide: 0 });
      });
    return () => {
      canceled = true;
      abortController.abort();
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [dataUrl]);
  return <div className="workspace-artifact-pptx" data-slide-count={state.slideCount}>
    {state.loading ? <div className="search-file-preview-state">正在加载演示文稿...</div> : null}
    {state.error ? <div className="search-file-preview-state error">PPTX 加载失败：{state.error}</div> : null}
    {!state.loading && !state.error ? <div className="workspace-pptx-toolbar">
      <button type="button" aria-label="上一页" title="上一页" disabled={state.currentSlide <= 0} onClick={() => void viewerRef.current?.goToSlide(state.currentSlide - 1)}>‹</button>
      <span>{state.currentSlide + 1}/{state.slideCount}</span>
      <button type="button" aria-label="下一页" title="下一页" disabled={state.currentSlide >= state.slideCount - 1} onClick={() => void viewerRef.current?.goToSlide(state.currentSlide + 1)}>›</button>
    </div> : null}
    <div className="workspace-artifact-pptx-stage">
      <div className="workspace-artifact-pptx-host" ref={hostRef} />
    </div>
  </div>;
}

const RESEARCH_WRITING_SKILL = "government-research-writing";
const RESEARCH_WRITING_PRODUCT_ENABLED = GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED;
const COMPOSER_PERMISSION_OPTIONS = [
  { id: "agent", name: "替我审批", detail: "自动审核操作，仅拦截明确高风险动作", icon: "shield-bolt" },
  { id: "full", name: "完全访问", detail: "可不受限制地访问互联网和本机文件", icon: "shield-unlock" }
] as const;

function permissionOption(permission: string) {
  // Old threads/preferences can still contain `approval`; migrate their
  // presentation and the next submitted turn to the agent-managed tier.
  return COMPOSER_PERMISSION_OPTIONS.find((option) => option.id === permission) ?? COMPOSER_PERMISSION_OPTIONS[0];
}

function builtinPluginIcon(packageName: string) {
  if (packageName === "documents") return "plugin-document";
  if (packageName === "pdf") return "plugin-pdf";
  if (packageName === "spreadsheets") return "plugin-spreadsheet";
  if (packageName === "presentations") return "plugin-presentation";
  if (packageName === "office") return "plugin-office";
  if (packageName === "template-creator" || packageName === "default-templates") return "skill-grid";
  if (packageName === "browser" || packageName === "sites") return "plugin-browser";
  if (packageName === "computer") return "computer";
  if (packageName === "visualize") return "plugin-visualize";
  if (packageName === "figma") return "plugin-figma";
  return "tool";
}

function BuiltinPluginIcon({ plugin }: { plugin: (typeof builtinPluginCatalog)[number] }) {
  return <span className={`composer-builtin-plugin-icon ${plugin.color}`} data-plugin={plugin.packageName} aria-hidden="true">
    <SidebarIcon name={builtinPluginIcon(plugin.packageName)} />
  </span>;
}

function composerSelectionIcon(skill: { name?: string } | null) {
  if (!skill?.name) return "skill-grid";
  if (skill.name === RESEARCH_WRITING_SKILL) return "skill-doc";
  return builtinPluginCatalog.some((plugin) => plugin.packageName === skill.name)
    ? builtinPluginIcon(skill.name)
    : "skills";
}

const DELIVERABLE_FILE_PATTERN = /\.(?:pdf|docx|xlsx|pptx|png|jpe?g|webp|gif|svg|txt|csv)$/i;

function formatArtifactSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function artifactExtension(filePath: string) {
  return filePath.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE";
}

function composerSkillLabel(skill: { name?: string }) {
  if (skill.name === RESEARCH_WRITING_SKILL) return "政务写作";
  return String(skill.name || "技能").replace(/-skill$/i, "");
}

/** Keep the marked thinking panel filled with Chinese process text, never English placeholders. */
function buildLiveReasoningProcess(reasoning: string, activities: any[] = [], planningFallback = "") {
  const cleaned = String(reasoning || "")
    .replace(/Analyzing the request, goals, constraints, and current context\.?\s*/gi, "")
    .trim();
  const processLines = activities
    .map((activity) => {
      const title = String(activity?.title || "").trim();
      const detail = String(activity?.detail || activity?.command || "").split("\n")[0].trim();
      if (!title) return "";
      return detail ? `${title}：${detail}` : title;
    })
    .filter(Boolean);
  const extras = processLines.filter((line) => {
    const tip = line.slice(0, Math.min(24, line.length));
    return tip && !cleaned.includes(tip);
  });
  const planning = planningFallback.trim()
    && !cleaned.includes(planningFallback.slice(0, Math.min(48, planningFallback.length)))
    ? planningFallback.trim()
    : "";
  const combined = [cleaned, planning, extras.join("\n")].filter(Boolean).join("\n\n").trim();
  return combined || "正在梳理任务目标、约束与当前上下文，过程会实时显示在这里。";
}

function formatLiveProcessSteps(activities: any[] = []) {
  return activities
    .map((activity) => {
      const title = String(activity?.title || "").trim();
      const detail = String(activity?.detail || activity?.command || "").split("\n")[0].trim();
      if (!title) return "";
      return { title, detail };
    })
    .filter(Boolean) as Array<{ title: string; detail: string }>;
}

const releasedFullAccessApprovalIds = new Set<string>();

export function WorkspaceModules(ctx: any) {
  const { previewMode } = ctx;
  const { WorkspaceTree, isSettingsFeature, activeFeature, setActiveFeature, featureItems, showsFeaturePanel, activeFeatureItem, renderFeaturePanel, projectsCollapsed, setProjectsCollapsed, workspaceCatalog, setWorkspaceCatalog, expandedWorkspaceIds, setExpandedWorkspaceIds, sortProjectsAscending, setSortProjectsAscending, showAddWorkspacePanel, setShowAddWorkspacePanel, newWorkspaceName, setNewWorkspaceName, newWorkspacePath, setNewWorkspacePath, api, createWorkspace, createBlankProject, addExistingProject, visibleWorkspaceCatalog, selectedWorkspace, workspaceHeaderStatus, snapshot, setSnapshot, syncSnapshot, expandedThreadListWorkspaceIds, setExpandedThreadListWorkspaceIds, sortThreadsForMenu, setSelectedWorkspaceId, setSelectedThreadId, selectWorkspaceThread, setArchivedThreadIds, setUnreadThreadIds, pinnedThreadIds, unreadThreadIds, threadContextMenu, setThreadContextMenu, handleThreadMenuAction, formatRelativeTimeLabel, formatSearchKind, reviewDrawerOpen, setReviewDrawerOpen, treeNodes, expandedPaths, activeTreePath, searchFilePreview, setSearchFilePreview, setExpandedPaths, setActiveTreePath, setPatchForm, setPreviewMode, setPreviewPlacement, runAction, displayUserAvatar, displayUserName, displayUserPlan, showAccountMenu, setShowAccountMenu, setActiveSettingsSection, handleLogout, title, previewPlacement, renderPreviewHeaderActions, errorMessage, setErrorMessage, conversationTurns, writeClipboard, setQuestion, composerImages, setComposerImages, queuedComposerDraft, setQueuedComposerDraft, queuedComposerDraftRef, questionRef, timelineItems, assistantActivities, assistantStartedAt, lastAssistantElapsedSeconds, selectedThread, activeThreadIds = [], activeThreadRequestIds = {}, liveModelContent = {}, liveReasoningSummaries = {}, settleApprovalRequest, settleLiveApprovalActivities, updateThreadMessages, selectedWorkspaceId, selectedThreadId, forkCurrentAnswer, selectedComposerTools, handleRemoveComposerTool, renderComposerToolFields, question, isAskingModel, isGlobalModelBusy, composerPermission, setComposerPermission, composerWorkspaceContext, setComposerWorkspaceContext, setShowMcpToolPicker, showMcpToolPicker, mcpDiscoveredTools, mcpServers, mcpDraft, setMcpDraft, editingMcpId, mcpHealth, mcpInspection, testingMcpId, resetMcpDraft, loadMcpDraft, handleSaveMcpServer, handleDeleteMcpServer, handleToggleMcpServer, handleTestMcpServer, handleInspectMcpServer, handleInsertMcpTool, modelConfig, setModelConfig, askModel, cancelCurrentModelRequest, shellCommand, setShellCommand, chatStatus, setChatStatus, renderPreviewPanel, renderSettingsWorkspace, searchQuery, setSearchQuery, searchResults, showSearchDialog, setShowSearchDialog, isComposingNewThread, setIsComposingNewThread, newThreadScope, setNewThreadScope, chatUsesProject, setChatUsesProject, desktopPreferences, saveDesktopPreferences, featureConfig, setFeatureConfig, skillDraft, setSkillDraft, pluginDraft, setPluginDraft, automationDraft, setAutomationDraft, resetFeatureDraft, loadFeatureDraft, saveFeature, editingFeatureId } = ctx;
  const { selectedComposerSkill, setSelectedComposerSkill, bindThreadComposerSkill, setSelectedComposerTools, composerSkillContext, setComposerSkillContext, composerModes, setComposerModes, usageExceptionFeedbackPreview, usageExceptionFeedbackBusy, cancelUsageExceptionFeedback, confirmUsageExceptionFeedback, reportGenerationFailureFeedback, appUpdateStatus, appUpdateBusy, appUpdateProgress, appUpdateDiscoverOpen, appUpdateApplied, startDesktopAppUpdate, applyDesktopAppUpdate, skipDesktopAppUpdate, dismissAppUpdateProgress, dismissAppUpdateDiscover, dismissAppliedAppUpdate } = ctx;
  const releaseInactiveModelRequest = ctx.releaseInactiveModelRequest;
  const [hoveredThread, setHoveredThread] = useState<any>(null);
  const [dismissedAppUpdateVersion, setDismissedAppUpdateVersion] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<any>(null);
  const [artifactTabs, setArtifactTabs] = useState<any[]>([]);
  const artifactTabsRef = useRef<any[]>([]);
  useEffect(() => {
    artifactTabsRef.current = artifactTabs;
  }, [artifactTabs]);
  const [ttsFollow, setTtsFollow] = useState<null | {
    scope: "preview" | "message";
    messageId?: string;
    line: number;
    endLine: number;
    totalLines: number;
    snippet: string;
  }>(null);
  const ttsFollowScrollKeyRef = useRef("");
  const scrollTtsFollowIntoView = useCallback((follow: {
    scope: "preview" | "message";
    messageId?: string;
    line: number;
    totalLines: number;
  }) => {
    const scrollKey = `${follow.scope}:${follow.messageId || ""}:${follow.line}`;
    if (ttsFollowScrollKeyRef.current === scrollKey) return;
    ttsFollowScrollKeyRef.current = scrollKey;
    if (follow.scope === "preview") {
      const el = document.querySelector(`.search-file-preview [data-preview-line="${follow.line}"]`);
      if (!(el instanceof HTMLElement)) return;
      const scroller = el.closest("pre");
      if (scroller instanceof HTMLElement) {
        const elRect = el.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        const nextTop = elRect.top - scrollerRect.top - scroller.clientHeight * 0.35 + scroller.scrollTop;
        scroller.scrollTop = Math.max(0, nextTop);
        return;
      }
      el.scrollIntoView({ block: "center", behavior: "auto" });
      return;
    }
    if (!follow.messageId) return;
    const article = document.querySelector(`[data-tts-message="${follow.messageId}"]`);
    if (!(article instanceof HTMLElement)) return;
    const scroller = article.closest(".project-chat-scroll");
    if (scroller instanceof HTMLElement) {
      const ratio = Math.min(1, Math.max(0, (follow.line - 1) / Math.max(1, follow.totalLines)));
      const articleTop = article.offsetTop;
      const targetY = articleTop + article.offsetHeight * ratio - scroller.clientHeight * 0.35;
      scroller.scrollTop = Math.max(0, targetY);
      return;
    }
    article.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, []);
  useEffect(() => {
    if (!ttsFollow) {
      ttsFollowScrollKeyRef.current = "";
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      scrollTtsFollowIntoView(ttsFollow);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ttsFollow, scrollTtsFollowIntoView]);
  const applyTtsFollow = useCallback((
    scope: "preview" | "message",
    messageId: string | undefined,
    target: { line: number; endLine: number; totalLines?: number; snippet: string } | null
  ) => {
    if (!target) {
      setTtsFollow((current) =>
        current
        && current.scope === scope
        && (scope !== "message" || current.messageId === messageId)
          ? null
          : current
      );
      return;
    }
    setTtsFollow((current) => {
      const next = {
        scope,
        messageId,
        line: target.line,
        endLine: target.endLine,
        totalLines: Math.max(1, target.totalLines || target.endLine || target.line),
        snippet: target.snippet
      };
      if (
        current
        && current.scope === next.scope
        && current.messageId === next.messageId
        && current.line === next.line
        && current.endLine === next.endLine
        && current.snippet === next.snippet
      ) {
        return current;
      }
      return next;
    });
  }, []);
  const [htmlPreviewRefreshToken, setHtmlPreviewRefreshToken] = useState(0);
  const [blankProjectDialogOpen, setBlankProjectDialogOpen] = useState(false);
  const [blankProjectName, setBlankProjectName] = useState("New project");
  const [brainWorkspaces, setBrainWorkspaces] = useState<any[]>([]);
  const [brainProjects, setBrainProjects] = useState<any[]>([]);
  const [brainRecentProjects, setBrainRecentProjects] = useState<any[]>([]);
  const [brainConversations, setBrainConversations] = useState<any[]>([]);
  const [brainMessages, setBrainMessages] = useState<any[]>([]);
  // Each BRAIN conversation owns one native NewBrain thread. Keeping this mapping
  // prevents the Composer from reusing whichever project thread was selected last.
  const [brainConversationThreads, setBrainConversationThreads] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem("newbrain.brain.conversation-threads");
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch { return {}; }
  });
  const activatedBrainThreadRef = useRef("");
  const legacySidebarRowHydratedRef = useRef(false);
  const composerTextareaRef = useRef<ComposerTextareaHandle | null>(null);
  const [composerDraftHistoryCaps, setComposerDraftHistoryCaps] = useState({ canUndo: false, canRedo: false });
  const [composerConversationRefs, setComposerConversationRefs] = useState<ConversationRef[]>([]);
  const [composerMentionQuery, setComposerMentionQuery] = useState<{ start: number; query: string; cursor: number } | null>(null);
  const [composerMentionIndex, setComposerMentionIndex] = useState(0);
  const [composerMentionBusy, setComposerMentionBusy] = useState(false);
  const textPreviewShellRef = useRef<HTMLDivElement | null>(null);
  const imagePreviewShellRef = useRef<HTMLDivElement | null>(null);
  const composerLayoutDraftTimerRef = useRef<number | null>(null);
  const [composerLayoutDraft, setComposerLayoutDraft] = useState("");
  const [composerTextareaHeight, setComposerTextareaHeight] = useState(() =>
    readStoredComposerTextareaHeight(typeof localStorage === "undefined" ? null : localStorage)
  );
  const [deliveryPreferenceChip, setDeliveryPreferenceChip] = useState<DeliveryPreferenceChipState>(EMPTY_DELIVERY_PREFERENCE_CHIP);
  const [deliveryPreferenceBusy, setDeliveryPreferenceBusy] = useState(false);
  const composerTextareaHeightRef = useRef(composerTextareaHeight);
  useEffect(() => {
    composerTextareaHeightRef.current = composerTextareaHeight;
    try { localStorage.setItem(COMPOSER_TEXTAREA_HEIGHT_STORAGE_KEY, String(composerTextareaHeight)); } catch { /* ignore */ }
  }, [composerTextareaHeight]);
  const startComposerTextareaResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const startY = event.clientY;
    const startHeight = composerTextareaHeightRef.current;
    handle.setPointerCapture?.(event.pointerId);
    const onMove = (moveEvent: PointerEvent) => {
      setComposerTextareaHeight(nextComposerTextareaHeight(startHeight, startY, moveEvent.clientY));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try { handle.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
  }, []);
  const [brainDraft, setBrainDraft] = useState("");
  const [brainMessageBusy, setBrainMessageBusy] = useState(false);
  const [brainFiles, setBrainFiles] = useState<any[]>([]);
  const [dataWorkspaceRefreshToken, setDataWorkspaceRefreshToken] = useState(0);
  const [brainTasks, setBrainTasks] = useState<any[]>([]);
  const [brainArtifacts, setBrainArtifacts] = useState<any[]>([]);
  const [brainAnnotations, setBrainAnnotations] = useState<any[]>([]);
  const [brainDocumentAnchors, setBrainDocumentAnchors] = useState<any[]>([]);
  const [activeBrainDocumentFileId, setActiveBrainDocumentFileId] = useState("");
  const [brainChangeSets, setBrainChangeSets] = useState<any[]>([]);
  const [brainChangeSetPreview, setBrainChangeSetPreview] = useState<any>(null);
  const [documentAnnotationActive, setDocumentAnnotationActive] = useState(false);
  const [pptxChatCollapsed, setPptxChatCollapsed] = useState(false);
  const [documentAnnotationCandidate, setDocumentAnnotationCandidate] = useState<any>(null);
  const [documentAnnotationInstruction, setDocumentAnnotationInstruction] = useState("");
  const [documentAnnotationBusy, setDocumentAnnotationBusy] = useState(false);
  const [documentMarkingTool, setDocumentMarkingTool] = useState<AnnotationMarkingTool>("select-rect");
  const [documentMarkingColor, setDocumentMarkingColor] = useState<string>(ANNOTATION_MARKING_COLORS[0]);
  const [documentAnnotationGeometry, setDocumentAnnotationGeometry] = useState<{ tool: AnnotationMarkingTool; color: string } | null>(null);
  const [documentAnnotationPendingMark, setDocumentAnnotationPendingMark] = useState<{ rect: { x: number; y: number; width: number; height: number }; tool: AnnotationMarkingTool; color: string } | null>(null);
  const [documentAnnotationSnapshot, setDocumentAnnotationSnapshot] = useState<{ dataUrl: string } | null>(null);
  const initialBrainWorkspaceSelection = useRef(restoreBrainWorkspaceSelection({
    serialized: (() => { try { return localStorage.getItem(BRAIN_WORKSPACE_SELECTION_KEY); } catch { return null; } })(),
    legacyWorkspaceKey: (() => { try { return localStorage.getItem(LEGACY_BRAIN_WORKSPACE_SELECTION_KEY); } catch { return null; } })(),
    preferredWorkspaceKey: desktopPreferences?.brain?.selectedWorkspaceKey
  }));
  const initialWorkspaceSceneTab = brainWorkspaceCapabilityTabs[initialBrainWorkspaceSelection.current.selection.selectedWorkspaceKey]?.[0]?.key || "files";
  const [brainResourceTab, setBrainResourceTab] = useState<"files" | "artifacts" | "tasks" | "scene">(() =>
    initialWorkspaceSceneTab === "files" || !brainWorkspaceCapabilityTabs[initialBrainWorkspaceSelection.current.selection.selectedWorkspaceKey]?.length
      ? "files"
      : "scene"
  );
  const [brainSceneTab, setBrainSceneTab] = useState(initialWorkspaceSceneTab);
  const brainResourcePanelRef = useRef<HTMLElement | null>(null);
  const pendingArtifactPreviewPathRef = useRef("");
  const openLocalFilePreviewRef = useRef<(filePath: string, location?: { line?: number; endLine?: number; column?: number; workspaceId?: string; displayName?: string; forceReload?: boolean }) => void>(() => undefined);
  const [brainResourceWidth, setBrainResourceWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem("brain.resource-panel-width"));
      return Number.isFinite(stored) && stored >= 320 && stored <= 760 ? stored : 480;
    } catch {
      return 480;
    }
  });
  /** side = 右侧 Tools；center = 放大占主区；hidden = 收起 */
  const [brainResourcePlacement, setBrainResourcePlacement] = useState<"side" | "center" | "hidden">("side");
  const [brainWorkspaceSelection, setBrainWorkspaceSelection] = useState(initialBrainWorkspaceSelection.current.selection);
  const [brainWorkspaceMigrated, setBrainWorkspaceMigrated] = useState(initialBrainWorkspaceSelection.current.migrated);
  const selectedBrainWorkspaceKey = brainWorkspaceSelection.selectedWorkspaceKey;
  const selectedBrainWorkspaceKeyRef = useRef(selectedBrainWorkspaceKey);
  selectedBrainWorkspaceKeyRef.current = selectedBrainWorkspaceKey;
  const brainPrefsHydratedRef = useRef(Boolean(isBrainWorkspaceKey(desktopPreferences?.brain?.selectedWorkspaceKey)));
  const persistedBrainPrefsKeyRef = useRef(
    isBrainWorkspaceKey(desktopPreferences?.brain?.selectedWorkspaceKey)
      ? desktopPreferences.brain.selectedWorkspaceKey
      : ""
  );
  const initialBrainCatalog = brainWorkspaceSelection.catalogs[selectedBrainWorkspaceKey];
  const [selectedBrainProjectId, setSelectedBrainProjectId] = useState(initialBrainCatalog?.projectId || "");
  const [selectedBrainConversationId, setSelectedBrainConversationId] = useState(initialBrainCatalog?.conversationId || "");
  const [selectedSidebarRow, setSelectedSidebarRow] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LEGACY_SIDEBAR_ROW_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [brainWorkspaceMenuOpen, setBrainWorkspaceMenuOpen] = useState(false);
  const [brainWorkspaceBusy, setBrainWorkspaceBusy] = useState(false);
  const [brainWorkspaceAvailability, setBrainWorkspaceAvailability] = useState<"loading" | "ready" | "unavailable">("loading");
  const brainWorkspaceMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    try {
      if (selectedSidebarRow) {
        localStorage.setItem(LEGACY_SIDEBAR_ROW_STORAGE_KEY, selectedSidebarRow);
      } else {
        localStorage.removeItem(LEGACY_SIDEBAR_ROW_STORAGE_KEY);
      }
    } catch { /* best effort */ }
  }, [selectedSidebarRow]);
  useEffect(() => {
    const capabilityTabs = brainWorkspaceCapabilityTabs[selectedBrainWorkspaceKey] || [];
    const firstCapability = capabilityTabs[0]?.key || "files";
    setBrainSceneTab(firstCapability);
    // 无场景专属 Tools（如场景学习探索）时，右侧回到 NewBrain 原生：文件/产物/任务。
    setBrainResourceTab(!capabilityTabs.length || firstCapability === "files" ? "files" : "scene");
  }, [selectedBrainWorkspaceKey]);
  useEffect(() => {
    if (!window.newbrain?.ensureBrainEnginesForScene) return;
    void window.newbrain.ensureBrainEnginesForScene({ workspaceKey: selectedBrainWorkspaceKey }).catch(() => undefined);
  }, [selectedBrainWorkspaceKey]);
  useEffect(() => {
    const frame = brainResourcePanelRef.current?.closest<HTMLElement>(".workspace-frame");
    if (!frame) return;
    frame.style.setProperty("--brain-resource-panel-width", `${brainResourceWidth}px`);
    try { localStorage.setItem("brain.resource-panel-width", String(brainResourceWidth)); } catch { /* local preferences may be unavailable */ }
    return () => frame.style.removeProperty("--brain-resource-panel-width");
  }, [brainResourceWidth]);
  // Center file preview shares the main row with chat; keep Tools on the side to avoid a 3-way grid fight.
  useEffect(() => {
    if (previewPlacement !== "center" || previewMode === "empty" || brainResourcePlacement !== "center") return;
    setBrainResourcePlacement("side");
  }, [previewPlacement, previewMode, brainResourcePlacement]);
  const attachBrainResourcePanel = useCallback((node: HTMLElement | null) => {
    brainResourcePanelRef.current = node;
    node?.closest<HTMLElement>(".workspace-frame")?.style.setProperty("--brain-resource-panel-width", `${brainResourceWidth}px`);
  }, [brainResourceWidth]);
  const resizeBrainResourcePanel = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const frame = brainResourcePanelRef.current?.closest<HTMLElement>(".workspace-frame");
    if (!frame) return;
    event.preventDefault();
    const frameRect = frame.getBoundingClientRect();
    const maximum = Math.max(320, Math.min(760, frameRect.width - 540));
    const update = (clientX: number) => setBrainResourceWidth(Math.round(Math.max(320, Math.min(maximum, frameRect.right - clientX))));
    const onMove = (moveEvent: PointerEvent) => update(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    update(event.clientX);
  }, []);
  const switchBrainWorkspace = useCallback((workspaceKey: BrainWorkspaceKey, catalogOverride?: { projectId?: string; conversationId?: string }) => {
    let nextCatalog = { projectId: "", conversationId: "" };
    setBrainWorkspaceSelection((current) => {
      const persisted = rememberBrainWorkspaceCatalog(current, current.selectedWorkspaceKey, {
        projectId: selectedBrainProjectId,
        conversationId: selectedBrainConversationId
      });
      let next = selectBrainWorkspace(persisted, workspaceKey);
      if (catalogOverride) {
        next = rememberBrainWorkspaceCatalog(next, workspaceKey, catalogOverride);
      }
      nextCatalog = next.catalogs[workspaceKey] ?? { projectId: "", conversationId: "" };
      return next;
    });
    setSelectedBrainProjectId(nextCatalog.projectId);
    setSelectedBrainConversationId(nextCatalog.conversationId);
    // Composer choices belong to the outgoing scene/thread. Keeping them here
    // can load a game project Skill into a video conversation.
    setSelectedComposerSkill(null);
    setSelectedComposerTools([]);
    setComposerSkillContext("");
    setComposerModes([]);
    const nextWorkspace = orderSidebarProjects(filterWorkspaceCatalogByScene(visibleWorkspaceCatalog, workspaceKey))[0];
    if (nextWorkspace) {
      setSelectedWorkspaceId(nextWorkspace.id);
      const nextThreadId = resolveUserVisibleThreadSelection(nextWorkspace.threads, null)?.id || "";
      setSelectedThreadId(nextThreadId);
      setIsComposingNewThread(!nextThreadId);
    } else {
      // The parent may retain its last global workspace selection, but it must
      // not retain an executable thread for the newly selected empty scene.
      setSelectedThreadId("");
      setIsComposingNewThread(true);
    }
    if (nextCatalog.conversationId) {
      setSelectedSidebarRow(`brain-conversation:${nextCatalog.conversationId}`);
    } else if (nextCatalog.projectId) {
      setSelectedSidebarRow(`brain-project:${nextCatalog.projectId}`);
    } else {
      setSelectedSidebarRow(null);
    }
    if (["extensions", "skills", "plugins", "automation", "mobile", "mcp", "holon", "experts"].includes(activeFeature)) {
      setActiveFeature("new-chat");
    }
    // 切场景时收起通用文件侧栏，恢复右侧场景专业面板（脚本/行情/关卡等）。
    setSearchFilePreview(null);
    setPreviewMode("empty");
    setPreviewPlacement("hidden");
    setBrainResourcePlacement("side");
  }, [activeFeature, selectedBrainProjectId, selectedBrainConversationId, setActiveFeature, setComposerModes, setComposerSkillContext, setIsComposingNewThread, setPreviewMode, setPreviewPlacement, setSearchFilePreview, setSelectedComposerSkill, setSelectedComposerTools, setSelectedThreadId, setSelectedWorkspaceId, visibleWorkspaceCatalog]);
  useEffect(() => {
    // Standalone / INTERNAL_CHAT drafts must not be stolen back into the scene
    // project (NewBrain keeps them on workspace:internal-chat).
    if (selectedWorkspace?.id === INTERNAL_CHAT_WORKSPACE_ID) return;
    if (isComposingNewThread && newThreadScope === "chat" && !chatUsesProject) return;
    const sceneProjects = filterWorkspaceCatalogByScene(visibleWorkspaceCatalog, selectedBrainWorkspaceKey);
    if (!sceneProjects.length) {
      // 无项目的场景只显示空状态。不要在这里清空全局工作区/线程：
      // 父层的工作区同步会把它恢复回来，清空与恢复会形成渲染更新循环。
      return;
    }
    if (selectedWorkspace?.id && sceneProjects.some((workspace) => workspace.id === selectedWorkspace.id)) return;
    const next = orderSidebarProjects(sceneProjects)[0];
    setSelectedWorkspaceId(next.id);
    // BRAIN conversation selection owns the active thread. Do not let scene-project
    // bootstrap overwrite it, or the chat scroll/context thrash on every catalog tick.
    if (selectedBrainConversationId) return;
    const threadId = resolveUserVisibleThreadSelection(next.threads, null)?.id || "";
    setSelectedThreadId(threadId);
    setIsComposingNewThread(!threadId);
  }, [selectedBrainWorkspaceKey, visibleWorkspaceCatalog, selectedWorkspace, selectedBrainConversationId, isComposingNewThread, newThreadScope, chatUsesProject, setSelectedWorkspaceId, setSelectedThreadId, setIsComposingNewThread]);
  useEffect(() => {
    const thread = selectedWorkspace?.threads?.find((item: { id?: string }) => item.id === selectedThreadId);
    if (!thread || isUserVisibleThread(thread)) return;
    const parentId = String((thread as { parentThreadId?: string }).parentThreadId || "").trim();
    const parent = parentId
      ? selectedWorkspace.threads.find((item: { id?: string }) => item.id === parentId && isUserVisibleThread(item))
      : undefined;
    const nextId = parent?.id || resolveUserVisibleThreadSelection(selectedWorkspace.threads, null)?.id || "";
    if (!nextId || nextId === selectedThreadId) return;
    setSelectedThreadId(nextId);
    const scope = selectedWorkspace.threads.find((item: { id?: string; scope?: string }) => item.id === nextId)?.scope;
    setSelectedSidebarRow(`${scope === "chat" ? "chat" : "project-thread"}:${selectedWorkspace.id}:${nextId}`);
  }, [selectedWorkspace, selectedThreadId, setSelectedThreadId]);
  const refreshBrainProjects = useCallback(async (workspaceKey = selectedBrainWorkspaceKey) => {
    if (!window.newbrain?.listBrainProjects) return [];
    const [projects, recents] = await Promise.all([
      window.newbrain.listBrainProjects({ workspaceKey, includeArchived: false }),
      window.newbrain.listBrainProjects({ includeArchived: false })
    ]);
    const nextProjects = Array.isArray(projects) ? projects : [];
    setBrainProjects(nextProjects);
    setBrainRecentProjects(Array.isArray(recents) ? recents : []);
    setSelectedBrainProjectId((current) => nextProjects.some((project) => project.id === current) ? current : (nextProjects[0]?.id || ""));
    return nextProjects;
  }, [selectedBrainWorkspaceKey]);
  const refreshBrainConversations = useCallback(async (projectId = selectedBrainProjectId) => {
    if (!projectId || !window.newbrain?.listBrainConversations) {
      setBrainConversations([]);
      setSelectedBrainConversationId("");
      return;
    }
    const allProjects = await window.newbrain.listBrainProjects({});
    const project = (Array.isArray(allProjects) ? allProjects : []).find((item) => item.id === projectId);
    const workspaceKey = project?.primaryWorkspaceKey || selectedBrainWorkspaceKey;
    let conversations = await window.newbrain.listBrainConversations({
      projectId,
      workspaceKey,
      includeArchived: false
    });
    let nextConversations = Array.isArray(conversations) ? conversations : [];
    if (
      !nextConversations.length
      && window.newbrain.createBrainConversation
      && !isComposingNewThread
      && !String(selectedSidebarRow || "").startsWith("project:")
    ) {
      try {
        const created = await window.newbrain.createBrainConversation({
          projectId,
          workspaceKey,
          title: "新对话"
        });
        nextConversations = [created];
      } catch (reason) {
        setErrorMessage(reason instanceof Error ? reason.message : String(reason));
      }
    }
    setBrainConversations(nextConversations);
    setSelectedBrainConversationId((current) => {
      if (current && nextConversations.some((conversation) => conversation.id === current)) return current;
      const sidebarRow = String(selectedSidebarRow || "");
      if (
        isComposingNewThread
        || sidebarRow.startsWith("project:")
        || sidebarRow.startsWith("project-thread:")
        || sidebarRow.startsWith("chat:")
        || sidebarRow.startsWith("task:")
      ) {
        return "";
      }
      return nextConversations[0]?.id || "";
    });
    const workspace = visibleWorkspaceCatalog.find((item) => item.id === project?.localWorkspaceId);
    if (workspace?.threads?.length) {
      setBrainConversationThreads((current) => mergeConversationThreadMappings(
        current,
        buildLegacyConversationThreadMappings({
          conversations: nextConversations,
          threads: workspace.threads
        })
      ));
    }
    setSelectedSidebarRow((current) => {
      if (
        current?.startsWith("feature:")
        || current?.startsWith("project:")
        || current?.startsWith("project-thread:")
        || current?.startsWith("chat:")
        || current?.startsWith("task:")
      ) {
        return current;
      }
      if (!current && selectedWorkspace?.id && selectedThread?.id) {
        return resolveLegacySidebarRowForThread({
          workspaceId: selectedWorkspace.id,
          threadId: selectedThread.id,
          scope: selectedThread.scope
        }) || current;
      }
      const preferred = current?.startsWith("brain-conversation:")
        ? current.slice("brain-conversation:".length)
        : "";
      const keep = preferred && nextConversations.some((conversation) => conversation.id === preferred)
        ? preferred
        : (nextConversations[0]?.id || "");
      const nextRow = keep ? `brain-conversation:${keep}` : current;
      return nextRow === current ? current : nextRow;
    });
  }, [selectedBrainProjectId, selectedBrainWorkspaceKey, visibleWorkspaceCatalog, isComposingNewThread, selectedSidebarRow, selectedWorkspace?.id, selectedThread?.id, selectedThread?.scope]);
  const bindBrainProjectToWorkspace = useCallback((
    workspaceId: string,
    options?: { conversationId?: string; composingNewThread?: boolean; projects?: readonly { id: string; localWorkspaceId?: string | null }[] }
  ) => {
    const normalizedWorkspaceId = String(workspaceId || "").trim();
    if (!normalizedWorkspaceId) return;
    const project = resolveBrainProjectForWorkspace(options?.projects ?? brainProjects, normalizedWorkspaceId);
    if (project) {
      setSelectedBrainProjectId(project.id);
    }
    const nextConversationId = String(options?.conversationId || "").trim();
    setSelectedBrainConversationId(nextConversationId);
    if (options?.composingNewThread) {
      activatedBrainThreadRef.current = "";
      setSelectedThreadId("");
      setIsComposingNewThread(true);
    }
  }, [brainProjects, setIsComposingNewThread, setSelectedThreadId]);
  useEffect(() => {
    let disposed = false;
    void (async () => {
      if (!window.newbrain?.listBrainWorkspaces) {
        setBrainWorkspaceAvailability("unavailable");
        return;
      }
      try {
        const workspaces = await window.newbrain.listBrainWorkspaces();
        if (disposed) return;
        const enabled = (Array.isArray(workspaces) ? workspaces : []).filter((item) => item?.enabled);
        setBrainWorkspaces(enabled);
        setBrainWorkspaceAvailability(enabled.length ? "ready" : "unavailable");
        // Do not wipe a restored last-scene when the catalog is still empty.
        if (!enabled.length) return;
        const currentKey = selectedBrainWorkspaceKeyRef.current;
        const selectedExists = enabled.some((item) => item.workspaceKey === currentKey);
        if (selectedExists) return;
        const nextKey = enabled.find((item) => item.workspaceKey === "explore")?.workspaceKey
          || enabled[0]?.workspaceKey
          || "explore";
        if (nextKey !== currentKey) switchBrainWorkspace(nextKey);
      } catch (error) {
        if (!disposed) {
          setBrainWorkspaceAvailability("unavailable");
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    const preferred = desktopPreferences?.brain?.selectedWorkspaceKey;
    if (!isBrainWorkspaceKey(preferred)) return;
    if (brainPrefsHydratedRef.current) return;
    brainPrefsHydratedRef.current = true;
    persistedBrainPrefsKeyRef.current = preferred;
    setBrainWorkspaceSelection((current) => {
      if (current.selectedWorkspaceKey === preferred) return current;
      return selectBrainWorkspace(current, preferred);
    });
  }, [desktopPreferences?.brain?.selectedWorkspaceKey]);
  useEffect(() => {
    try {
      localStorage.setItem(BRAIN_WORKSPACE_SELECTION_KEY, JSON.stringify(brainWorkspaceSelection));
      localStorage.removeItem(LEGACY_BRAIN_WORKSPACE_SELECTION_KEY);
      if (brainWorkspaceMigrated) setBrainWorkspaceMigrated(false);
    } catch { /* session-only fallback */ }
    const key = brainWorkspaceSelection.selectedWorkspaceKey;
    if (!isBrainWorkspaceKey(key) || key === persistedBrainPrefsKeyRef.current) return;
    if (typeof saveDesktopPreferences !== "function" || !desktopPreferences) return;
    persistedBrainPrefsKeyRef.current = key;
    brainPrefsHydratedRef.current = true;
    void saveDesktopPreferences({
      ...desktopPreferences,
      brain: {
        ...(desktopPreferences.brain || { selectedWorkspaceKey: "" }),
        selectedWorkspaceKey: key
      }
    }, { statusMessage: null }).catch(() => {
      // Disk preferences may be unavailable; localStorage remains the session fallback.
      persistedBrainPrefsKeyRef.current = "";
    });
  }, [brainWorkspaceSelection, brainWorkspaceMigrated, desktopPreferences, saveDesktopPreferences]);
  useEffect(() => {
    setBrainWorkspaceBusy(true);
    void refreshBrainProjects(selectedBrainWorkspaceKey)
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setBrainWorkspaceBusy(false));
  }, [selectedBrainWorkspaceKey, refreshBrainProjects]);
  useEffect(() => {
    setBrainWorkspaceSelection((current) => rememberBrainWorkspaceCatalog(current, current.selectedWorkspaceKey, {
      projectId: selectedBrainProjectId,
      conversationId: selectedBrainConversationId
    }));
  }, [selectedBrainProjectId, selectedBrainConversationId]);
  useEffect(() => {
    try { localStorage.setItem("newbrain.brain.conversation-threads", JSON.stringify(brainConversationThreads)); } catch { /* best effort */ }
  }, [brainConversationThreads]);
  useEffect(() => {
    void refreshBrainConversations(selectedBrainProjectId)
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)));
  }, [selectedBrainProjectId, selectedBrainWorkspaceKey, refreshBrainConversations]);
  // Prefer persisted sidebar row (`chat:` / `project-thread:`) over lastSelectedThreadId on startup.
  useEffect(() => {
    if (legacySidebarRowHydratedRef.current) return;
    if (!visibleWorkspaceCatalog.length) return;
    const row = String(selectedSidebarRow || "");
    if (!row.startsWith("chat:") && !row.startsWith("project-thread:")) {
      legacySidebarRowHydratedRef.current = true;
      return;
    }
    if (!shouldPreferSidebarRowThreadRestore({
      sidebarRow: row,
      selectedWorkspaceId,
      selectedThreadId,
      workspaces: visibleWorkspaceCatalog
    })) {
      legacySidebarRowHydratedRef.current = true;
      return;
    }
    const target = resolveSidebarRowThreadTarget({
      sidebarRow: row,
      workspaces: visibleWorkspaceCatalog
    });
    legacySidebarRowHydratedRef.current = true;
    if (!target) return;
    setSearchFilePreview(null);
    setIsComposingNewThread(false);
    setActiveFeature("new-chat");
    if (target.kind === "chat") {
      setNewThreadScope("chat");
      setChatUsesProject?.(false);
    } else {
      setNewThreadScope("project");
      setChatUsesProject?.(true);
      const legacyConversationId = resolveLegacyConversationIdForThread(target.thread.id);
      bindBrainProjectToWorkspace(target.workspace.id, {
        conversationId: brainConversations.some((conversation) => conversation.id === legacyConversationId)
          ? legacyConversationId
          : ""
      });
    }
    activatedBrainThreadRef.current = "";
    if (selectWorkspaceThread) {
      void selectWorkspaceThread(target.workspace.id, target.thread.id, { force: true });
      return;
    }
    setSelectedWorkspaceId(target.workspace.id);
    setSelectedThreadId(target.thread.id);
    if (!api?.activateWorkspaceThread) return;
    const activationKey = `${target.workspace.id}:${target.thread.id}`;
    activatedBrainThreadRef.current = activationKey;
    void api.activateWorkspaceThread({
      workspaceId: target.workspace.id,
      threadId: target.thread.id
    }).then((threadSnapshot) => {
      if (activatedBrainThreadRef.current !== activationKey) return;
      syncSnapshot(threadSnapshot, target.thread.id);
    }).catch((error) => {
      if (activatedBrainThreadRef.current === activationKey) activatedBrainThreadRef.current = "";
      setErrorMessage(error instanceof Error ? error.message : String(error));
    });
  }, [
    visibleWorkspaceCatalog,
    selectedSidebarRow,
    selectedWorkspaceId,
    selectedThreadId,
    brainConversations,
    api,
    bindBrainProjectToWorkspace,
    selectWorkspaceThread,
    setActiveFeature,
    setChatUsesProject,
    setErrorMessage,
    setIsComposingNewThread,
    setNewThreadScope,
    setSearchFilePreview,
    setSelectedThreadId,
    setSelectedWorkspaceId,
    syncSnapshot
  ]);
  useEffect(() => {
    if (!selectedBrainConversationId || !selectedBrainProjectId) return;
    const boundProject = resolveBrainProjectForWorkspace(brainProjects, selectedWorkspace?.id)
      ?? brainProjects.find((project) => project.id === selectedBrainProjectId);
    if (!shouldSyncBrainConversationThread({
      sidebarRow: selectedSidebarRow,
      selectedWorkspaceId: selectedWorkspace?.id,
      boundWorkspaceId: boundProject?.localWorkspaceId
    })) {
      return;
    }
    if (!brainConversations.some((conversation) => conversation.id === selectedBrainConversationId)) return;
    setNewThreadScope("project");
    setChatUsesProject?.(true);
    const row = `brain-conversation:${selectedBrainConversationId}`;
    setSelectedSidebarRow((current) => {
      if (current?.startsWith("feature:")) return current;
      if (
        current?.startsWith("project-thread:")
        || current?.startsWith("chat:")
        || current?.startsWith("task:")
      ) {
        return current;
      }
      return current === row ? current : row;
    });
    // BRAIN conversations are backed by their own native threads. Never leave
    // the previously selected project thread active while this effect runs.
    let mappedThreadId = String(brainConversationThreads[selectedBrainConversationId] || "").trim();
    const sidebarTarget = resolveSidebarRowThreadTarget({
      sidebarRow: selectedSidebarRow,
      workspaces: visibleWorkspaceCatalog
    });
    if (
      sidebarTarget
      && sidebarTarget.workspace.id === selectedWorkspace?.id
      && (!mappedThreadId || !selectedWorkspace?.threads?.some((thread: any) => thread.id === mappedThreadId))
    ) {
      mappedThreadId = sidebarTarget.thread.id;
    }
    if (
      !mappedThreadId
      && selectedThreadId
      && selectedWorkspace?.threads?.some((thread: any) => thread.id === selectedThreadId)
    ) {
      mappedThreadId = String(selectedThreadId);
    }
    if (!mappedThreadId) {
      const legacyThreadId = parseLegacyConversationThreadId(selectedBrainConversationId);
      if (legacyThreadId && selectedWorkspace?.threads?.some((thread: any) => thread.id === legacyThreadId)) {
        mappedThreadId = legacyThreadId;
      }
    }
    const mappedThreadBelongsToWorkspace = !mappedThreadId
      || Boolean(selectedWorkspace?.threads?.some((thread: any) => thread.id === mappedThreadId));
    if (!mappedThreadBelongsToWorkspace) {
      setBrainConversationThreads((current) => {
        if (!current[selectedBrainConversationId]) return current;
        const next = { ...current };
        delete next[selectedBrainConversationId];
        return next;
      });
      activatedBrainThreadRef.current = "";
      setSelectedThreadId("");
      setIsComposingNewThread(true);
      return;
    }
    if (brainConversationThreads[selectedBrainConversationId] !== mappedThreadId) {
      setBrainConversationThreads((current) => (
        current[selectedBrainConversationId] === mappedThreadId
          ? current
          : { ...current, [selectedBrainConversationId]: mappedThreadId }
      ));
    }
    // Guard same-id updates: setSelectedThreadId(same) used to re-activate the
    // thread and re-enter this effect via snapshot updates (chat jump + busy cursor).
    setSelectedThreadId((current) => (current === mappedThreadId ? current : mappedThreadId));
    setIsComposingNewThread((current) => {
      const next = !mappedThreadId;
      return current === next ? current : next;
    });
    if (!mappedThreadId || !selectedWorkspace?.id || !api?.activateWorkspaceThread) {
      activatedBrainThreadRef.current = "";
      return;
    }
    const activationKey = `${selectedWorkspace.id}:${mappedThreadId}`;
    if (activatedBrainThreadRef.current === activationKey) return;
    activatedBrainThreadRef.current = activationKey;
    void api.activateWorkspaceThread({
      workspaceId: selectedWorkspace.id,
      threadId: mappedThreadId
    }).then((threadSnapshot) => {
      if (activatedBrainThreadRef.current !== activationKey) return;
      syncSnapshot(threadSnapshot, mappedThreadId);
      // Activation without a live approval must not keep sticky awaiting-approval
      // from another turn/scene; clear only this thread's catalog badge.
      if (!threadSnapshot?.approval) {
        setWorkspaceCatalog((current: any) => clearStaleThreadApprovalInCatalog(
          current,
          selectedWorkspace.id,
          mappedThreadId
        ));
      }
    }).catch((error) => {
      if (activatedBrainThreadRef.current === activationKey) activatedBrainThreadRef.current = "";
      setErrorMessage(error instanceof Error ? error.message : String(error));
    });
  }, [selectedBrainConversationId, selectedBrainProjectId, selectedSidebarRow, brainConversations, brainConversationThreads, brainProjects, selectedWorkspace?.id, selectedThreadId, visibleWorkspaceCatalog, api, syncSnapshot, setErrorMessage, setIsComposingNewThread, setSelectedThreadId]);
  useEffect(() => {
    if (!selectedBrainConversationId || isComposingNewThread || !selectedThreadId) return;
    setBrainConversationThreads((current) => current[selectedBrainConversationId] === selectedThreadId
      ? current
      : { ...current, [selectedBrainConversationId]: selectedThreadId });
  }, [selectedBrainConversationId, selectedThreadId, isComposingNewThread]);
  useEffect(() => {
    let disposed = false;
    if (!selectedBrainConversationId || !window.newbrain?.listBrainMessages) {
      setBrainMessages([]);
      setBrainDraft("");
      return () => { disposed = true; };
    }
    void Promise.all([
      window.newbrain.listBrainMessages({ conversationId: selectedBrainConversationId }),
      window.newbrain.getBrainDraft?.({ conversationId: selectedBrainConversationId }) ?? Promise.resolve(null)
    ]).then(([messages, draft]) => {
      if (disposed) return;
      setBrainMessages(Array.isArray(messages) ? messages : []);
      const draftContent = draft?.content || "";
      setBrainDraft(draftContent);
      setQuestion(draftContent);
    }).catch((error) => {
      if (!disposed) setErrorMessage(error instanceof Error ? error.message : String(error));
    });
    return () => { disposed = true; };
  }, [selectedBrainConversationId]);
  useEffect(() => {
    if (!selectedBrainConversationId || !selectedBrainProjectId || !window.newbrain?.saveBrainDraft) return;
    const timer = window.setTimeout(() => {
      void window.newbrain?.saveBrainDraft({
        projectId: selectedBrainProjectId,
        conversationId: selectedBrainConversationId,
        content: brainDraft
      }).catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [brainDraft, selectedBrainConversationId, selectedBrainProjectId]);
  useEffect(() => {
    let disposed = false;
    if (!selectedBrainProjectId) {
      setBrainFiles([]); setBrainTasks([]); setBrainArtifacts([]); setBrainAnnotations([]); setBrainDocumentAnchors([]); setBrainChangeSets([]); setBrainChangeSetPreview(null);
      setActiveBrainDocumentFileId("");
      return () => { disposed = true; };
    }
    void Promise.all([
      window.newbrain?.listBrainFiles?.({ projectId: selectedBrainProjectId }) ?? Promise.resolve([]),
      window.newbrain?.listBrainTasks?.({ projectId: selectedBrainProjectId }) ?? Promise.resolve([]),
      window.newbrain?.listBrainArtifacts?.({ projectId: selectedBrainProjectId }) ?? Promise.resolve([]),
      window.newbrain?.listBrainAnnotations?.({ projectId: selectedBrainProjectId }) ?? Promise.resolve([]),
      window.newbrain?.listBrainChangeSets?.({ projectId: selectedBrainProjectId }) ?? Promise.resolve([])
    ]).then(([files, tasks, artifacts, annotations, changeSets]) => {
      if (disposed) return;
      const nextFiles = Array.isArray(files) ? files : [];
      setBrainFiles(nextFiles);
      setBrainTasks(Array.isArray(tasks) ? tasks : []);
      setBrainArtifacts(Array.isArray(artifacts) ? artifacts : []);
      setBrainAnnotations(Array.isArray(annotations) ? annotations : []);
      setBrainChangeSets(Array.isArray(changeSets) ? changeSets : []);
      setBrainChangeSetPreview(null);
      const pendingPath = String(pendingArtifactPreviewPathRef.current || "").replace(/\\/g, "/");
      if (pendingPath) {
        const matched = nextFiles.find((file) => {
          const storageKey = String(file.storageKey || "").replace(/\\/g, "/");
          const logicalName = String(file.logicalName || "");
          return storageKey === pendingPath
            || storageKey.endsWith(`/${pendingPath}`)
            || logicalName === pendingPath.split("/").pop();
        });
        if (matched?.id) {
          setActiveBrainDocumentFileId(matched.id);
          if (window.newbrain?.ingestBrainFile && !/\.(?:mp3|wav|flac|m4a|ogg)$/i.test(String(matched.logicalName || matched.storageKey || ""))) {
            void window.newbrain.ingestBrainFile({ projectId: selectedBrainProjectId, fileId: matched.id })
              .then((result) => {
                if (disposed) return;
                setBrainDocumentAnchors(result.anchors || []);
                if (result.warnings?.length) setChatStatus(result.warnings.join(" "));
              })
              .catch((error: unknown) => {
                if (!disposed) setChatStatus(error instanceof Error ? error.message : "文档结构解析失败");
              });
          }
        }
      }
    }).catch((error) => {
      if (!disposed) setErrorMessage(error instanceof Error ? error.message : String(error));
    });
    return () => { disposed = true; };
  }, [selectedBrainProjectId, selectedBrainConversationId, dataWorkspaceRefreshToken]);
  useEffect(() => {
    if (!window.newbrain?.onDataWorkspaceUpdated) return;
    return window.newbrain.onDataWorkspaceUpdated((payload: { projectId?: string; reason?: string }) => {
      const projectId = String(payload?.projectId || "").trim();
      if (projectId && selectedBrainProjectId && projectId !== selectedBrainProjectId) return;
      if (projectId && !selectedBrainProjectId) {
        // Explore/new-chat writes may create the first brain project for the
        // active local folder; select it so 文件/产物/任务 refresh against it.
        setSelectedBrainProjectId(projectId);
      }
      const reason = String(payload?.reason || "");
      if (reason.startsWith("music:")) {
        setBrainResourcePlacement((current) => (current === "hidden" ? "side" : current));
        setBrainResourceTab("scene");
        setBrainSceneTab(reason.includes("render") ? "export" : reason.includes("song.generate") ? "tracks" : "gen");
      }
      const artifactPathMatch = /^(?:artifact\.create|document\.create_[a-z]+|workspace\.write_file):(.+)$/i.exec(reason);
      const artifactPath = String(artifactPathMatch?.[1] || "").trim().replace(/\\/g, "/");
      if (artifactPath && /\.(?:pptx|pdf|docx)$/i.test(artifactPath)) {
        setBrainResourcePlacement((current) => (current === "hidden" ? "side" : current));
        if (/\.pptx$/i.test(artifactPath)) {
          setBrainResourceTab("scene");
          setBrainSceneTab("preview");
        } else {
          setBrainResourceTab((current) => (current === "tasks" ? current : "files"));
        }
        pendingArtifactPreviewPathRef.current = artifactPath;
        openLocalFilePreviewRef.current?.(artifactPath, { forceReload: true });
      }
      setDataWorkspaceRefreshToken((value) => value + 1);
    });
  }, [selectedBrainProjectId]);
  useEffect(() => {
    setDocumentAnnotationCandidate(null);
    setDocumentAnnotationInstruction("");
    setDocumentAnnotationGeometry(null);
    setDocumentAnnotationPendingMark(null);
    setDocumentAnnotationSnapshot(null);
  }, [selectedBrainProjectId, activeBrainDocumentFileId]);
  const visibleBrainWorkspaces = brainWorkspaces.length ? brainWorkspaces : fallbackBrainWorkspaces;
  const selectedBrainWorkspace = visibleBrainWorkspaces.find((item) => item.workspaceKey === selectedBrainWorkspaceKey) || visibleBrainWorkspaces[0];
  useEffect(() => {
    if (!brainWorkspaceMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && brainWorkspaceMenuRef.current?.contains(event.target)) return;
      setBrainWorkspaceMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBrainWorkspaceMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [brainWorkspaceMenuOpen]);
  const [projectContextMenu, setProjectContextMenu] = useState<any>(null);
  const [renameProjectDialog, setRenameProjectDialog] = useState<any>(null);
  const showRenameThreadDialog = Boolean(ctx.showRenameThreadDialog);
  const setShowRenameThreadDialog = ctx.setShowRenameThreadDialog;
  const editingThreadTitle = ctx.editingThreadTitle ?? "";
  const setEditingThreadTitle = ctx.setEditingThreadTitle;
  const renameThread = ctx.renameThread;
  const [pinnedWorkspaceIds, setPinnedWorkspaceIds] = useState<Set<string>>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("newbrain.pinnedWorkspaceIds.v1") || "[]");
      return new Set<string>(Array.isArray(parsed) ? parsed.filter((item: unknown) => typeof item === "string") : []);
    } catch {
      return new Set<string>();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("newbrain.pinnedWorkspaceIds.v1", JSON.stringify([...pinnedWorkspaceIds]));
    } catch {
      // 忽略持久化失败
    }
  }, [pinnedWorkspaceIds]);
  useEffect(() => {
    if (!imagePreview) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImagePreview(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [imagePreview]);
  useEffect(() => {
    if (!hoveredThread) return;
    const clearIfOutsideThreadRow = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) {
        setHoveredThread(null);
        return;
      }
      if (!event.target.closest(".thread-row")) {
        setHoveredThread(null);
      }
    };
    const clearHover = () => setHoveredThread(null);
    window.addEventListener("pointermove", clearIfOutsideThreadRow);
    window.addEventListener("scroll", clearHover, true);
    window.addEventListener("blur", clearHover);
    return () => {
      window.removeEventListener("pointermove", clearIfOutsideThreadRow);
      window.removeEventListener("scroll", clearHover, true);
      window.removeEventListener("blur", clearHover);
    };
  }, [hoveredThread]);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const [chatsCollapsed, setChatsCollapsed] = useState(false);
  const [sidebarOrganizeMode, setSidebarOrganizeMode] = useState<"project" | "list">(() => {
    try { return localStorage.getItem("newbrain.sidebar.organize.v1") === "list" ? "list" : "project"; } catch { return "project"; }
  });
  const [sidebarSortMode, setSidebarSortMode] = useState<CodexSidebarSortMode>(() => {
    try { return localStorage.getItem("newbrain.sidebar.sort.v1") === "updated" ? "updated" : "priority"; } catch { return "priority"; }
  });
  const [sidebarOptionsOpen, setSidebarOptionsOpen] = useState(false);
  const [sidebarTasksExpanded, setSidebarTasksExpanded] = useState(false);
  const [sidebarProjectsExpanded, setSidebarProjectsExpanded] = useState(false);
  useEffect(() => {
    if (!sidebarOptionsOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".sidebar-organize-menu, .sidebar-organize-button")) return;
      setSidebarOptionsOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [sidebarOptionsOpen]);
  useEffect(() => {
    try {
      localStorage.setItem("newbrain.sidebar.organize.v1", sidebarOrganizeMode);
      localStorage.setItem("newbrain.sidebar.sort.v1", sidebarSortMode);
    } catch {
      // View preferences remain usable for the current session.
    }
  }, [sidebarOrganizeMode, sidebarSortMode]);
  const [composerMenu, setComposerMenu] = useState<"add" | "permission" | "context" | "reasoning" | "skill" | null>(null);
  const [composerQueueCollapsed, setComposerQueueCollapsed] = useState(false);
  const [editingUserMessageId, setEditingUserMessageId] = useState("");
  const [editingUserDraft, setEditingUserDraft] = useState("");
  const [copiedUserMessageId, setCopiedUserMessageId] = useState("");
  const copyUserMessage = (messageId: string, content: string) => {
    writeClipboard(content);
    setCopiedUserMessageId(messageId);
    window.setTimeout(() => {
      setCopiedUserMessageId((current) => current === messageId ? "" : current);
    }, 1600);
  };
  const beginEditUserMessage = (messageId: string, content: string) => {
    setEditingUserMessageId(messageId);
    setEditingUserDraft(content);
  };
  const cancelEditUserMessage = () => {
    setEditingUserMessageId("");
    setEditingUserDraft("");
  };
  const submitEditedUserMessage = async (turn: any) => {
    const content = editingUserDraft.trim();
    const messageId = String(turn?.user?.id || "");
    if (!content || !messageId || !selectedThread?.id) return;
    if (isAskingModel || isGlobalModelBusy) {
      await cancelCurrentModelRequest?.();
    }
    const keepBefore = (messages: any[]) => {
      const index = messages.findIndex((message) => message?.id === messageId && message?.role === "user");
      return index < 0 ? messages : messages.slice(0, index);
    };
    try {
      if (typeof api?.rewindThreadToUserMessage === "function" && selectedWorkspace?.id) {
        const nextSnapshot = await api.rewindThreadToUserMessage({
          workspaceId: selectedWorkspace.id,
          threadId: selectedThread.id,
          userMessageId: messageId
        });
        syncSnapshot?.(nextSnapshot, selectedThread.id);
      }
    } catch (error) {
      setChatStatus(error instanceof Error ? error.message : "没能从这条消息重新开始。");
      return;
    }
    updateThreadMessages?.(selectedThread.id, (current: any[]) => keepBefore(current));
    setEditingUserMessageId("");
    setEditingUserDraft("");
    void askModel({
      question: content,
      images: Array.isArray(turn.user.attachments) ? turn.user.attachments : [],
      tools: [],
      skill: null,
      skillContext: "",
      modes: []
    });
  };
  // Windows hosts a multi-item queue; macOS/Ubuntu still pass a single slot,
  // so writes there keep only the newest item.
  const composerQueue: any[] = Array.isArray(ctx.queuedComposerDrafts)
    ? ctx.queuedComposerDrafts
    : (queuedComposerDraft ? [queuedComposerDraft] : []);
  const readComposerQueue = (): any[] => {
    if (Array.isArray(ctx.queuedComposerDraftsRef?.current)) return ctx.queuedComposerDraftsRef.current;
    const single = queuedComposerDraftRef?.current ?? queuedComposerDraft;
    return single ? [single] : [];
  };
  const commitComposerQueue = (next: any[]) => {
    if (typeof ctx.setComposerQueue === "function") {
      ctx.setComposerQueue(next);
      return;
    }
    const head = next[next.length - 1] ?? null;
    if (queuedComposerDraftRef) queuedComposerDraftRef.current = head;
    setQueuedComposerDraft?.(head);
  };
  const enqueueComposerQueueDraft = (draft: any) => {
    commitComposerQueue(enqueueComposerDraft(readComposerQueue(), draft));
  };
  const [reasoningSubmenu, setReasoningSubmenu] = useState<"model" | "speed" | "optimize" | null>(null);
  const emptyCustomModelDraft = { label: "", baseUrl: "", apiKey: "", model: "" };
  const [customModelEndpoints, setCustomModelEndpoints] = useState<Array<{ id: string; label: string; baseUrl: string; model: string; wireApi: "chat.completions" | "responses" }>>([]);
  const [customModelFormOpen, setCustomModelFormOpen] = useState(false);
  const [customModelDraft, setCustomModelDraft] = useState(emptyCustomModelDraft);
  const [customModelError, setCustomModelError] = useState("");
  const [customModelSaving, setCustomModelSaving] = useState(false);
  const customModelsLoadedRef = useRef(false);
  const [reasoningMenuPosition, setReasoningMenuPosition] = useState<ComposerPickerMenuPosition | null>(null);
  const reasoningPickerWrapRef = useRef<HTMLDivElement | null>(null);
  const [composerSpeed, setComposerSpeed] = useState<"standard" | "fast">("standard");
  const [skillsView, setSkillsView] = useState<"list" | "detail" | "new">("list");
  const [skillsTab, setSkillsTab] = useState<"installed" | "recommended">("installed");
  const [skillSearchText, setSkillSearchText] = useState("");
  const [skillStatusFilter, setSkillStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [skillSortMode, setSkillSortMode] = useState<"name" | "status">("name");
  const [pluginCategoryFilter, setPluginCategoryFilter] = useState("全部");
  const [expandedPluginId, setExpandedPluginId] = useState("");
  const [automationStatusFilter, setAutomationStatusFilter] = useState<"all" | "enabled" | "paused" | "completed">("all");
  const [automationSortMode, setAutomationSortMode] = useState<"next" | "name" | "result">("next");
  const [skillCatalogPage, setSkillCatalogPage] = useState(1);
  const [pluginCatalogPage, setPluginCatalogPage] = useState(1);
  const [automationCatalogPage, setAutomationCatalogPage] = useState(1);
  const [pluginSortMode, setPluginSortMode] = useState<"popular" | "name" | "installed">("popular");
  const [pluginVendorFilter, setPluginVendorFilter] = useState("全部来源");
  const [skillMenuId, setSkillMenuId] = useState("");
  const [automationMenuId, setAutomationMenuId] = useState("");
  const [automationRunPendingId, setAutomationRunPendingId] = useState("");
  const [skillDetailModalId, setSkillDetailModalId] = useState("");
  const [automationDetailModalId, setAutomationDetailModalId] = useState("");
  const [pluginDetailModalId, setPluginDetailModalId] = useState("");
  const [summonedExpert, setSummonedExpert] = useState<null | {
    expertId: string;
    profession: string;
    displayName: string;
    preferredWorkspaceKey?: string;
  }>(null);
  const [clawhubResults, setClawhubResults] = useState<any[]>([]);
  const [clawhubBusy, setClawhubBusy] = useState(false);
  const [clawhubInstallingRef, setClawhubInstallingRef] = useState("");
  const [automationView, setAutomationView] = useState<"list" | "detail" | "new">("list");
  const [automationIntent, setAutomationIntent] = useState("");
  const [automationCreateMode, setAutomationCreateMode] = useState<"intent" | "form">("intent");
  const [desktopWindows, setDesktopWindows] = useState<any[]>([]);
  const [selectedDesktopWindowKey, setSelectedDesktopWindowKey] = useState("");
  const [windowControlBusy, setWindowControlBusy] = useState(false);
  const [windowControlMessage, setWindowControlMessage] = useState("");
  const [mcpAdvancedOpen, setMcpAdvancedOpen] = useState(false);
  const windowControlSupported = Boolean(api?.windowControl?.list);
  useEffect(() => {
    if (activeFeature !== "skills" || skillsTab !== "recommended") return;
    if (desktopPreferences?.market?.directClawhubAllowed !== true) return;
    if (!api?.searchOpenClawSkills) {
      setErrorMessage("当前桌面版本尚未启用 ClawHub 搜索。");
      return;
    }
    let cancelled = false;
    const query = skillSearchText.trim() || "*";
    const timer = window.setTimeout(() => {
      setClawhubBusy(true);
      void api
        .searchOpenClawSkills({ query, limit: 20 })
        .then((results: unknown) => {
          if (cancelled) return;
          const list = Array.isArray(results) ? [...results] : [];
          list.sort((a: any, b: any) => Number(b?.score ?? 0) - Number(a?.score ?? 0));
          setClawhubResults(list);
          if (typeof setChatStatus === "function") {
            setChatStatus(query === "*"
              ? `已加载 ${list.length} 个 OpenClaw 高排行技能`
              : `已搜索到 ${list.length} 个匹配技能`);
          }
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setErrorMessage(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (!cancelled) setClawhubBusy(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeFeature, skillsTab, api, desktopPreferences?.market?.directClawhubAllowed, skillSearchText]);
  useEffect(() => {
    let cancelled = false;
    const threadId = String(selectedThread?.id || "").trim();
    if (!threadId || !window.newbrain?.getExpertSummon) {
      setSummonedExpert(null);
      return;
    }
    void window.newbrain.getExpertSummon({ threadId }).then((result) => {
      if (cancelled) return;
      if (!result || typeof result !== "object") {
        setSummonedExpert(null);
        return;
      }
      setSummonedExpert({
        expertId: String((result as any).expertId || ""),
        profession: String((result as any).profession || (result as any).displayName || ""),
        displayName: String((result as any).displayName || ""),
        preferredWorkspaceKey: (result as any).preferredWorkspaceKey
      });
    }).catch(() => {
      if (!cancelled) setSummonedExpert(null);
    });
    return () => { cancelled = true; };
  }, [selectedThread?.id, activeFeature]);
  useEffect(() => {
    if (!selectedBrainConversationId || selectedSidebarRow !== `brain-conversation:${selectedBrainConversationId}`) return;
    const timer = window.setTimeout(() => {
      const next = composerTextareaRef.current?.getValue() ?? composerLayoutDraft ?? question;
      setBrainDraft((current) => (current === next ? current : next));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [composerLayoutDraft, question, selectedBrainConversationId, selectedSidebarRow]);
  useEffect(() => {
    setComposerLayoutDraft(question);
  }, [question, selectedThreadId, selectedBrainConversationId, isComposingNewThread]);
  const [isListening, setIsListening] = useState(false);
  // The Web Speech API constructor exists in Electron but depends on a Google
  // speech backend that is not bundled, so it fails at runtime. Once a recognition
  // attempt reports an environment-level failure we remember it and hide the entry
  // point instead of repeatedly offering a control that cannot work.
  const [voiceBackendUnavailable, setVoiceBackendUnavailable] = useState<boolean>(() => {
    try {
      return localStorage.getItem("newbrain.voiceBackendUnavailable.v1") === "1";
    } catch {
      return false;
    }
  });
  const markVoiceBackendUnavailable = () => {
    setVoiceBackendUnavailable(true);
    try {
      localStorage.setItem("newbrain.voiceBackendUnavailable.v1", "1");
    } catch {
      // Ignore persistence failures; the in-memory flag still hides the entry.
    }
  };
  const voiceInputAvailable = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) && !voiceBackendUnavailable;
  const [mcpSearchQuery, setMcpSearchQuery] = useState("");
  const [automationSearchQuery, setAutomationSearchQuery] = useState("");
  const [pluginSearchQuery, setPluginSearchQuery] = useState("");
  const [pluginMarketTab, setPluginMarketTab] = useState<"all" | "installed">("all");
  const [pluginScopeTab, setPluginScopeTab] = useState<"public" | "private">("public");
  const [repositoryPlugins, setRepositoryPlugins] = useState<any[]>([]);
  const [repositoryPluginError, setRepositoryPluginError] = useState("");
  const [repositoryPluginsLoading, setRepositoryPluginsLoading] = useState(false);

  const loadRepositoryPlugins = useCallback(async () => {
    if (!api?.listRepositoryPlugins) return;
    setRepositoryPluginsLoading(true);
    setRepositoryPluginError("");
    try {
      const snapshot = await api.listRepositoryPlugins({
        scope: pluginScopeTab,
        keyword: pluginSearchQuery.trim(),
        category: pluginCategoryFilter !== "全部" && pluginCategoryFilter !== "自动推荐" ? pluginCategoryFilter : undefined,
        page: 1,
        pageSize: 100
      });
      setRepositoryPlugins((snapshot.items ?? []).map((plugin: any) => ({
        id: "repository:" + plugin.plugin_key,
        pluginKey: plugin.plugin_key,
        name: plugin.display_name,
        summary: plugin.description,
        version: plugin.latest_version,
        source: plugin.publisher,
        capabilities: plugin.skills ?? [],
        category: plugin.category || "其他",
        color: "blue",
        bundled: false,
        repository: true,
        installed: ["installed", "disabled", "update_available", "installed_pending_report"].includes(plugin.install_state),
        installState: plugin.install_state
      })));
    } catch (error) {
      setRepositoryPluginError(error instanceof Error ? error.message : String(error));
      setRepositoryPlugins([]);
    } finally {
      setRepositoryPluginsLoading(false);
    }
  }, [api, pluginScopeTab, pluginSearchQuery, pluginCategoryFilter]);

  useEffect(() => {
    if (activeFeature !== "automation" || !api?.getFeatureConfig) return;
    let cancelled = false;
    const refresh = () => {
      void api.getFeatureConfig().then((next: any) => {
        if (!cancelled && next) setFeatureConfig(next);
      }).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeFeature, api, setFeatureConfig]);
  useEffect(() => {
    if (activeFeature !== "plugins") return;
    const timeout = window.setTimeout(() => { void loadRepositoryPlugins(); }, 180);
    return () => window.clearTimeout(timeout);
  }, [activeFeature, loadRepositoryPlugins]);
  const [newChatProjectMenu, setNewChatProjectMenu] = useState<"workspace" | "local" | "branch" | null>(null);
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [researchWritingSession, setResearchWritingSession] = useState<ResearchWritingSession>(() => defaultResearchWritingSession());
  const [researchIntakeCustomOpen, setResearchIntakeCustomOpen] = useState(false);
  const [researchIntakeCustomText, setResearchIntakeCustomText] = useState("");
  const [researchIntakeQuestion, setResearchIntakeQuestion] = useState<DynamicResearchIntakeQuestion | null>(null);
  const [researchIntakeLoading, setResearchIntakeLoading] = useState(false);
  const [researchIntakeAnalysis, setResearchIntakeAnalysis] = useState("");
  const [researchIntakeError, setResearchIntakeError] = useState("");
  const [goalExecution, setGoalExecution] = useState<any>(null);
  const [governmentSpecification, setGovernmentSpecification] = useState<any>(null);
  const [governmentSpecificationBusy, setGovernmentSpecificationBusy] = useState(false);
  const [goalObjectiveEditing, setGoalObjectiveEditing] = useState(false);
  const [goalPlanExpanded, setGoalPlanExpanded] = useState(false);
  const [previewFileMenu, setPreviewFileMenu] = useState(false);
  const [workspaceFileMenu, setWorkspaceFileMenu] = useState<LocalFileMenuState | null>(null);
  const [goalObjectiveDraft, setGoalObjectiveDraft] = useState("");
  const [answeringGoalQuestion, setAnsweringGoalQuestion] = useState(false);
  const [goalCustomAdjustment, setGoalCustomAdjustment] = useState("");
  const goalQuestionCardRef = useRef<HTMLElement | null>(null);
  const taskScrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const showJumpToLatestRef = useRef(false);
  const wasAskingForScrollRef = useRef(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const synchronizedCompletedGoalRef = useRef("");
  const researchIntakeGenerationRef = useRef(0);
  const researchIntakeDraftRef = useRef<any>(null);
  const skipResearchPersistRef = useRef(false);
  const lastCreatorMaterializeRef = useRef("");
  const NEAR_BOTTOM_PX = 140;
  const scrollTaskToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const scrollContainer = taskScrollRef.current;
    if (!scrollContainer) return;
    const targetTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    if (Math.abs(scrollContainer.scrollTop - targetTop) <= 1) return;
    scrollContainer.scrollTo({ top: targetTop, behavior });
  }, []);
  const syncStickFromScrollPosition = useCallback(() => {
    const scrollContainer = taskScrollRef.current;
    if (!scrollContainer) return;
    const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
    const nearBottom = distanceFromBottom <= NEAR_BOTTOM_PX;
    if (stickToBottomRef.current === nearBottom) return;
    stickToBottomRef.current = nearBottom;
    const nextShowJump = !nearBottom;
    if (showJumpToLatestRef.current === nextShowJump) return;
    showJumpToLatestRef.current = nextShowJump;
    setShowJumpToLatest(nextShowJump);
  }, []);
  const [localModeUsageOpen, setLocalModeUsageOpen] = useState(false);
  const [approvalResponding, setApprovalResponding] = useState(false);
  const [settledApprovalId, setSettledApprovalId] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [newChatBranches, setNewChatBranches] = useState<any>({ current: "", branches: [], changedFiles: 0 });
  const activeReasoningRequestId = resolveActiveReasoningRequestId({
    selectedThreadId: selectedThread?.id,
    activeThreadRequestIds: activeThreadRequestIds || {}
  });
  const activeStreamContent = activeReasoningRequestId ? String(liveModelContent[activeReasoningRequestId] || "") : "";
  const goalOwnerTurnId = goalExecution?.goal?.turnId || conversationTurns.at(-1)?.id || "";
  const showGovernmentSpecification = Boolean(
    RESEARCH_WRITING_PRODUCT_ENABLED
    && governmentSpecification
    && goalExecution?.runtime?.selectedSkillNames?.includes(RESEARCH_WRITING_SKILL)
    && ["active", "paused"].includes(String(goalExecution?.goal?.status || ""))
  );
  const activeReasoningSummary = activeReasoningRequestId ? String(liveReasoningSummaries[activeReasoningRequestId] || "") : "";

  const researchWritingKey = researchWritingStorageKey(selectedWorkspace?.id, selectedThread?.id);
  useEffect(() => {
    let cancelled = false;
    if (!api || isComposingNewThread || !selectedThread?.id) {
      setGoalExecution(null);
      return;
    }
    const refreshGoalExecution = () => void api.getGoalExecution({ threadId: selectedThread.id }).then(async (execution: any) => {
        if (cancelled) return;
        setGoalExecution(execution);
        const completedGoalId = execution?.goal?.status === "complete" ? String(execution.goal.goalId || "") : "";
        if (completedGoalId && !isAskingModel && synchronizedCompletedGoalRef.current !== completedGoalId) {
          synchronizedCompletedGoalRef.current = completedGoalId;
          const nextSnapshot = await api.activateWorkspaceThread({
            workspaceId: selectedWorkspace.id,
            threadId: selectedThread.id
          });
          if (!cancelled && selectedThread.id === execution.goal.threadId) {
            syncSnapshot(nextSnapshot, selectedThread.id);
          }
        }
        if (execution?.goal?.status === "active") {
          setComposerModes((current: Array<"goal" | "plan">) => current.includes("goal") ? current : [...current, "goal"]);
        } else {
          setComposerModes((current: Array<"goal" | "plan">) => current.filter((mode) => mode !== "goal"));
        }
      }).catch(() => {
        if (!cancelled) setGoalExecution(null);
      });
    refreshGoalExecution();
    const timer = window.setInterval(refreshGoalExecution, isAskingModel ? 750 : 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, selectedThread?.id, isAskingModel, isComposingNewThread]);
  useEffect(() => {
    let cancelled = false;
    const goalId = goalExecution?.goal?.goalId;
    const governmentEnabled = RESEARCH_WRITING_PRODUCT_ENABLED
      && goalExecution?.runtime?.selectedSkillNames?.includes(RESEARCH_WRITING_SKILL);
    if (!api || !selectedThread?.id || !goalId || !governmentEnabled) {
      setGovernmentSpecification(null);
      return;
    }
    void api.getGovernmentWritingSpecification({ threadId: selectedThread.id, goalId }).then((snapshot: any) => {
      if (!cancelled) setGovernmentSpecification(snapshot);
    }).catch(() => { if (!cancelled) setGovernmentSpecification(null); });
    return () => { cancelled = true; };
  }, [api, selectedThread?.id, goalExecution?.goal?.goalId, goalExecution?.runtime?.selectedSkillNames]);
  useEffect(() => {
    const goalId = goalExecution?.goal?.goalId;
    const governmentEnabled = RESEARCH_WRITING_PRODUCT_ENABLED
      && goalExecution?.runtime?.selectedSkillNames?.includes(RESEARCH_WRITING_SKILL);
    const latest = conversationTurns.at(-1)?.assistant?.content || "";
    if (!api || !selectedThread?.id || !goalId || !governmentEnabled || !latest.includes("# 写作任务") || !latest.includes("# 结构模板")) return;
    const json = latest.match(/```json\s*([\s\S]*?)```/iu)?.[1];
    if (!json) return;
    let content: any;
    try { content = JSON.parse(json); } catch { return; }
    if (JSON.stringify(content) === JSON.stringify(governmentSpecification?.currentVersion?.content)) return;
    setGovernmentSpecificationBusy(true);
    void api.saveGovernmentWritingSpecification({
      threadId: selectedThread.id,
      goalId,
      currentVersionId: governmentSpecification?.currentVersionId,
      source: "model",
      changeSummary: governmentSpecification ? "大模型修订写作规格" : "大模型生成初始写作规格",
      content
    }).then(setGovernmentSpecification).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }).finally(() => setGovernmentSpecificationBusy(false));
  }, [api, selectedThread?.id, goalExecution?.goal?.goalId, goalExecution?.runtime?.selectedSkillNames, conversationTurns.at(-1)?.assistant?.content, governmentSpecification?.currentVersionId]);
  useEffect(() => {
    const goalId = goalExecution?.goal?.goalId;
    const governmentEnabled = RESEARCH_WRITING_PRODUCT_ENABLED
      && goalExecution?.runtime?.selectedSkillNames?.includes(RESEARCH_WRITING_SKILL);
    const latest = conversationTurns.at(-1)?.assistant?.content || "";
    const json = latest.match(/```json\s*([\s\S]*?)```/iu)?.[1];
    if (!api || !selectedThread?.id || !goalId || !governmentEnabled || !governmentSpecification?.currentVersionId || !json) return;
    let suggestions: any;
    try { suggestions = JSON.parse(json); } catch { return; }
    if (!Array.isArray(suggestions) || !suggestions.length || suggestions.some((item) => !item?.suggestionId || !item?.target?.kind)) return;
    if (JSON.stringify(suggestions) === JSON.stringify(governmentSpecification.suggestions ?? [])) return;
    setGovernmentSpecificationBusy(true);
    void api.saveGovernmentWritingSuggestions({
      threadId: selectedThread.id,
      goalId,
      baseVersionId: governmentSpecification.currentVersionId,
      suggestions
    }).then(setGovernmentSpecification).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }).finally(() => setGovernmentSpecificationBusy(false));
  }, [api, selectedThread?.id, goalExecution?.goal?.goalId, goalExecution?.runtime?.selectedSkillNames, conversationTurns.at(-1)?.assistant?.content, governmentSpecification?.currentVersionId]);
  useEffect(() => {
    synchronizedCompletedGoalRef.current = "";
  }, [selectedThread?.id]);
  useEffect(() => {
    stickToBottomRef.current = true;
    showJumpToLatestRef.current = false;
    setShowJumpToLatest(false);
  }, [selectedThread?.id]);

  const refreshDeliveryPreferenceChip = useCallback(async () => {
    if (!api?.getDeliveryPreferences || isComposingNewThread || !selectedThread?.id) {
      setDeliveryPreferenceChip(EMPTY_DELIVERY_PREFERENCE_CHIP);
      return;
    }
    try {
      setDeliveryPreferenceChip(normalizeDeliveryPreferenceChip(await api.getDeliveryPreferences()));
    } catch {
      setDeliveryPreferenceChip(EMPTY_DELIVERY_PREFERENCE_CHIP);
    }
  }, [api, isComposingNewThread, selectedThread?.id]);

  useEffect(() => {
    void refreshDeliveryPreferenceChip();
  }, [refreshDeliveryPreferenceChip, isAskingModel]);

  const clearDeliveryPreferenceChip = useCallback(async () => {
    if (!api?.clearDeliveryPreferences || deliveryPreferenceBusy) return;
    setDeliveryPreferenceBusy(true);
    try {
      setDeliveryPreferenceChip(normalizeDeliveryPreferenceChip(await api.clearDeliveryPreferences("both")));
    } catch {
      /* keep current chip */
    } finally {
      setDeliveryPreferenceBusy(false);
    }
  }, [api, deliveryPreferenceBusy]);

  const pinDeliveryPreferenceChip = useCallback(async () => {
    if (!api?.pinDeliveryPreferences || deliveryPreferenceBusy) return;
    setDeliveryPreferenceBusy(true);
    try {
      setDeliveryPreferenceChip(normalizeDeliveryPreferenceChip(await api.pinDeliveryPreferences()));
    } catch {
      /* keep current chip */
    } finally {
      setDeliveryPreferenceBusy(false);
    }
  }, [api, deliveryPreferenceBusy]);

  useEffect(() => {
    if (!goalExecution?.pendingQuestion?.questionId || isAskingModel) return;
    if (!stickToBottomRef.current) return;
    window.requestAnimationFrame(() => scrollTaskToBottom("auto"));
  }, [goalExecution?.pendingQuestion?.questionId, isAskingModel, scrollTaskToBottom]);
  useEffect(() => {
    const scrollContainer = taskScrollRef.current;
    if (!scrollContainer) return;
    const onScroll = () => syncStickFromScrollPosition();
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", onScroll);
  }, [selectedThread?.id, syncStickFromScrollPosition, isComposingNewThread]);
  useEffect(() => {
    if (isAskingModel && !wasAskingForScrollRef.current) {
      if (stickToBottomRef.current) {
        window.requestAnimationFrame(() => scrollTaskToBottom("auto"));
      }
    }
    wasAskingForScrollRef.current = isAskingModel;
  }, [isAskingModel, scrollTaskToBottom]);
  useEffect(() => {
    if (!isAskingModel || !stickToBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (!stickToBottomRef.current) return;
      scrollTaskToBottom("auto");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    isAskingModel,
    activeStreamContent.length,
    activeReasoningSummary.length,
    conversationTurns.at(-1)?.assistant?.id,
    conversationTurns.at(-1)?.assistant?.content.length,
    conversationTurns.at(-1)?.assistant?.reasoningSummary?.length,
    assistantActivities?.length,
    scrollTaskToBottom
  ]);
  useEffect(() => {
    // A new-chat draft has no stable thread id yet. Selecting a project or creating
    // its backing thread changes the storage key; do not discard the skill capsule
    // and intake state that belong to the in-flight draft.
    if (isComposingNewThread) return;
    researchIntakeGenerationRef.current += 1;
    researchIntakeDraftRef.current = null;
    skipResearchPersistRef.current = true;
    setResearchIntakeQuestion(null);
    setResearchIntakeLoading(false);
    setResearchIntakeAnalysis("");
    setResearchIntakeError("");
    // Keep the bound skill for this thread; other threads restore their own binding on switch.
    try {
      const stored = localStorage.getItem(researchWritingKey);
      const restored = stored ? { ...defaultResearchWritingSession(), ...JSON.parse(stored) } : defaultResearchWritingSession();
      setResearchWritingSession({ ...restored, enabled: false });
    } catch {
      setResearchWritingSession(defaultResearchWritingSession());
    }
  }, [researchWritingKey, isComposingNewThread]);
  useEffect(() => {
    if (skipResearchPersistRef.current) {
      skipResearchPersistRef.current = false;
      return;
    }
    localStorage.setItem(researchWritingKey, JSON.stringify(researchWritingSession));
  }, [researchWritingKey, researchWritingSession]);
  useEffect(() => {
    setResearchWritingSession((current) => ({
      ...current,
      enabled: RESEARCH_WRITING_PRODUCT_ENABLED && selectedComposerSkill?.name === RESEARCH_WRITING_SKILL
    }));
  }, [selectedComposerSkill?.name]);

  useEffect(() => {
    if (RESEARCH_WRITING_PRODUCT_ENABLED) return;
    if (selectedComposerSkill?.name === RESEARCH_WRITING_SKILL) {
      clearComposerSkill();
    }
  }, [selectedComposerSkill?.name]);

  const availableComposerSkills = [
    ...(featureConfig?.skills ?? []).filter((skill: any) =>
      skill.status === "enabled"
      && (RESEARCH_WRITING_PRODUCT_ENABLED || skill.name !== RESEARCH_WRITING_SKILL)
    ),
    ...(RESEARCH_WRITING_PRODUCT_ENABLED
      ? [{
          id: "central-government-research-writing",
          name: RESEARCH_WRITING_SKILL,
          summary: "由 Spring 中枢执行，支持提纲、分段写作、事实校验和 Word/WPS 导出",
          status: "enabled",
          icon: "政"
        }]
      : [])
  ].filter((skill: any, index: number, skills: any[]) =>
    skills.findIndex((candidate: any) => candidate.name === skill.name) === index
  );

  async function requestNextResearchIntake(
    history: Array<{ question: string; answer: string }>,
    requestedText = researchWritingSession.requestText || question.trim()
  ) {
    if (!api) return;
    const frozenRequestText = requestedText.trim();
    if (!frozenRequestText) {
      setResearchIntakeError("请先输入要完成的政务写作任务。");
      return;
    }
    const generation = researchIntakeGenerationRef.current + 1;
    researchIntakeGenerationRef.current = generation;
    setResearchIntakeLoading(true);
    setResearchIntakeQuestion(null);
    setResearchIntakeAnalysis("");
    setResearchIntakeCustomOpen(false);
    setResearchIntakeError("");
    setResearchWritingSession((current) => ({ ...current, requestText: frozenRequestText, intakeHistory: history }));
    try {
      const conversationContext = isNewChatMode ? "" : conversationTurns.slice(-2).map((turn: any) => [
        turn.user?.content ? `用户：${turn.user.content}` : "",
        turn.assistant?.content ? `助手：${String(turn.assistant.content).slice(0, 600)}` : ""
      ].filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
      const result = await api.generateResearchWritingIntake({
        userRequest: frozenRequestText,
        conversationContext,
        answers: history,
        attachments: (researchIntakeDraftRef.current?.images || composerImages).map((image: any) => ({
          name: image.name,
          path: image.path,
          url: image.url
        }))
      });
      if (generation !== researchIntakeGenerationRef.current) return;
      setResearchIntakeAnalysis(result.analysis || "");
      if (result.status === "ready" && result.targetContext) {
        setResearchWritingSession((current) => ({ ...current, intakeHistory: history, intakeComplete: true }));
        const planContext = (result.plan || []).map((step: DynamicResearchPlanStep, index: number) =>
          `${index + 1}. ${step.title}\n动作：${step.description}\n阶段结果：${step.result || "已完成"}`
        ).join("\n\n");
        const completedContext = [`政务写作执行计划及逐步结果：\n${planContext}`, result.targetContext].filter(Boolean).join("\n\n");
        setComposerSkillContext(completedContext);
        setChatStatus("政务写作需求分析已完成，正在基于已确认选项生成目标成果。");
        const capturedDraft = researchIntakeDraftRef.current;
        const finalDraft = {
          question: capturedDraft?.question || frozenRequestText,
          images: capturedDraft?.images || composerImages.map((image: any) => ({ ...image })),
          tools: capturedDraft?.tools || selectedComposerTools.map((tool: any) => ({ ...tool, fieldValues: { ...(tool.fieldValues ?? {}) } })),
          skill: capturedDraft?.skill || (selectedComposerSkill ? { ...selectedComposerSkill } : null),
          skillContext: completedContext,
          modes: capturedDraft?.modes || [...composerModes],
          createdAt: new Date().toISOString()
        };
        researchIntakeDraftRef.current = null;
        setQuestion("");
        setComposerImages([]);
        setSelectedComposerTools([]);
        setComposerSkillContext("");
        setComposerModes([]);
        const activePrototypeStep = (result.plan || []).find((step: DynamicResearchPlanStep) => step.status === "active")?.id;
        const nextStage = activePrototypeStep === "outline"
          ? "outline"
          : activePrototypeStep === "section-drafting" ? "draft"
            : activePrototypeStep === "style-unification" ? "style"
              : activePrototypeStep === "fact-check" || activePrototypeStep === "export" ? "verify" : "materials";
        setResearchWritingSession((current) => ({
          ...current,
          enabled: true,
          stage: nextStage,
          intakeComplete: false,
          intakeHistory: [],
          requestText: ""
        }));
        setResearchIntakeQuestion(null);
        void askModel(finalDraft);
      } else if (result.question) {
        setResearchIntakeQuestion(result.question);
        setChatStatus("请回答大模型生成的政务写作澄清问题。");
      } else {
        throw new Error("大模型没有返回下一问题或目标约束。");
      }
    } catch (error) {
      if (generation !== researchIntakeGenerationRef.current) return;
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = /timeout|timed out|aborted|aborterror/i.test(rawMessage)
        ? "模型分析超时，请重新分析，或基于已确认的信息直接生成。"
        : /HTTP 5\d\d|模型网关请求失败/i.test(rawMessage)
          ? "模型服务暂时不可用，请稍后重新分析，或基于已确认的信息直接生成。"
          : "需求分析暂未完成，请重新分析，或基于已确认的信息直接生成。";
      setResearchIntakeError(message);
      setErrorMessage(message);
      setChatStatus("政务写作需求分析失败。");
    } finally {
      if (generation === researchIntakeGenerationRef.current) setResearchIntakeLoading(false);
    }
  }

  function finishResearchIntakeWithConfirmedInformation() {
    const requestText = (researchWritingSession.requestText || researchIntakeDraftRef.current?.question || question).trim();
    if (!requestText) return;
    researchIntakeGenerationRef.current += 1;
    setResearchIntakeLoading(false);
    const history = researchWritingSession.intakeHistory || [];
    const targetContext = [
      `用户原始任务：${requestText}`,
      history.length
        ? `用户已确认的信息：\n${history.map((item, index) => `${index + 1}. ${item.question}\n答：${item.answer}`).join("\n")}`
        : "用户尚未确认补充信息。",
      "请直接基于以上信息生成目标成果；缺失信息采用保守、通用表述，不得虚构政策文件、统计数据、时间节点、领导姓名或实际工作成绩，并将必须补充的事实标记为【待核验】。"
    ].join("\n\n");
    setResearchIntakeError("");
    setResearchIntakeQuestion(null);
    setResearchWritingSession((current) => ({ ...current, intakeComplete: true }));
    setComposerSkillContext(targetContext);
    const capturedDraft = researchIntakeDraftRef.current;
    const finalDraft = {
      question: capturedDraft?.question || requestText,
      images: capturedDraft?.images || composerImages.map((image: any) => ({ ...image })),
      tools: capturedDraft?.tools || selectedComposerTools.map((tool: any) => ({ ...tool, fieldValues: { ...(tool.fieldValues ?? {}) } })),
      skill: capturedDraft?.skill || (selectedComposerSkill ? { ...selectedComposerSkill } : null),
      skillContext: targetContext,
      modes: capturedDraft?.modes || [...composerModes],
      createdAt: new Date().toISOString()
    };
    researchIntakeDraftRef.current = null;
    setQuestion("");
    setComposerImages([]);
    setSelectedComposerTools([]);
    setComposerSkillContext("");
    setComposerModes([]);
    setResearchWritingSession((current) => ({ ...current, enabled: true, intakeComplete: false, intakeHistory: [], requestText: "" }));
    setChatStatus("正在基于已确认的信息生成目标成果。未确认事实将标记为待核验。");
    void askModel(finalDraft);
  }

  function selectComposerSkill(skill: any) {
    researchIntakeGenerationRef.current += 1;
    if (typeof bindThreadComposerSkill === "function") {
      bindThreadComposerSkill(selectedThread?.id || null, skill);
    } else {
      setSelectedComposerSkill(skill);
    }
    const researchEnabled = RESEARCH_WRITING_PRODUCT_ENABLED && skill?.name === RESEARCH_WRITING_SKILL;
    setResearchWritingSession((current) => ({
      ...current,
      enabled: researchEnabled,
      stage: researchEnabled ? "materials" : current.stage,
      intakeAnswers: researchEnabled ? {} : current.intakeAnswers,
      intakeHistory: researchEnabled ? [] : current.intakeHistory,
      requestText: researchEnabled ? "" : current.requestText,
      intakeComplete: researchEnabled ? true : current.intakeComplete
    }));
    setComposerSkillContext("");
    setResearchIntakeQuestion(null);
    setResearchIntakeLoading(false);
    setResearchIntakeError("");
    setResearchIntakeAnalysis("");
    researchIntakeDraftRef.current = null;
    setChatStatus(`已启用技能：${skill.name}`);
    setComposerMenu(null);
  }

  // The legacy intake renderer remains parseable for old persisted drafts, but it is
  // deliberately unreachable. Explicit writing skills now use the durable goal UI.
  const researchIntakePending = false;

  function requireResearchIntake(): boolean {
    if (!researchIntakePending) return false;
    if (isGlobalModelBusy) {
      setChatStatus("当前任务运行结束后才能开始政务写作需求分析。");
      return true;
    }
    if (!researchIntakeLoading && !researchIntakeQuestion && !researchIntakeError) {
      researchIntakeDraftRef.current = {
        question: question.trim(),
        images: composerImages.map((image: any) => ({ ...image })),
        tools: selectedComposerTools.map((tool: any) => ({ ...tool, fieldValues: { ...(tool.fieldValues ?? {}) } })),
        skill: selectedComposerSkill ? { ...selectedComposerSkill } : null,
        modes: [...composerModes]
      };
      void requestNextResearchIntake([], question.trim());
    } else {
      setChatStatus(researchIntakeError ? "政务写作需求分析失败，请重试。" : "请先完成政务写作询问。大模型会根据每次选择继续分析。");
    }
    return true;
  }

  async function answerResearchIntake(answer: string) {
    if (!researchIntakeQuestion || !answer.trim() || researchIntakeLoading) return;
    const nextHistory = [...(researchWritingSession.intakeHistory || []), {
      question: researchIntakeQuestion.prompt,
      answer: answer.trim()
    }];
    setResearchWritingSession((current) => ({ ...current, intakeHistory: nextHistory }));
    setResearchIntakeCustomOpen(false);
    setResearchIntakeCustomText("");
    await requestNextResearchIntake(nextHistory, researchWritingSession.requestText);
  }

  function skipResearchIntake() {
    if (!researchIntakeQuestion) return;
    void answerResearchIntake("跳过此问题，请基于现有信息采用保守假设，并在最终结果中明确说明该假设。");
  }

  function clearComposerSkill() {
    researchIntakeGenerationRef.current += 1;
    researchIntakeDraftRef.current = null;
    if (typeof bindThreadComposerSkill === "function") {
      bindThreadComposerSkill(selectedThread?.id || null, null);
    } else {
      setSelectedComposerSkill(null);
    }
    setComposerSkillContext("");
    setResearchWritingSession((current) => ({ ...current, enabled: false }));
    setResearchIntakeQuestion(null);
    setResearchIntakeLoading(false);
    setResearchIntakeAnalysis("");
    setResearchIntakeError("");
    setChatStatus("已关闭显式技能模式");
    setComposerMenu(null);
  }

  function enableComposerMode(mode: "goal" | "plan") {
    setComposerModes([mode]);
    setComposerMenu(null);
  }

  async function enableGoalMode() {
    if (goalExecution?.goal?.status === "paused") {
      const execution = await api.setGoalPaused({ threadId: selectedThread?.id, paused: false });
      setGoalExecution(execution);
    }
    enableComposerMode("goal");
  }

  async function enablePlanMode() {
    if (goalExecution?.goal?.status === "active") {
      const execution = await api.setGoalPaused({ threadId: selectedThread?.id, paused: true });
      setGoalExecution(execution);
    }
    setComposerModes(["plan"]);
    setComposerMenu(null);
  }

  function selectBuiltinPlugin(plugin: (typeof builtinPluginCatalog)[number]) {
    selectComposerSkill({
      id: plugin.id,
      name: plugin.packageName,
      summary: plugin.summary,
      status: "enabled"
    });
  }

  async function pauseGoalMode() {
    if (goalExecution?.goal?.status === "active") {
      const execution = await api.setGoalPaused({ threadId: selectedThread?.id, paused: true });
      setGoalExecution(execution);
    }
    disableComposerMode("goal");
  }

  async function saveGoalObjective() {
    if (!selectedThread?.id || !goalObjectiveDraft.trim()) return;
    const execution = await api.updateGoalObjective({ threadId: selectedThread.id, objective: goalObjectiveDraft.trim() });
    setGoalExecution(execution);
    setGoalObjectiveEditing(false);
  }

  async function deleteCurrentGoal() {
    if (!selectedThread?.id || !window.confirm("确定删除当前目标及其计划状态吗？")) return;
    await api.deleteGoal({ threadId: selectedThread.id });
    setGoalExecution(null);
    setGoalObjectiveEditing(false);
    disableComposerMode("goal");
  }

  async function answerGoalDecision(answer: string) {
    const pendingQuestion = goalExecution?.pendingQuestion;
    if (!pendingQuestion || answeringGoalQuestion) return;
    setAnsweringGoalQuestion(true);
    const continuationDraft = {
      threadId: selectedThread?.id || "",
      question: answer.trim(),
      images: [],
      tools: [],
      skill: null,
      skillContext: "",
      modes: ["goal"],
      createdAt: new Date().toISOString()
    };
    try {
      const execution = await api.answerGoalQuestion({ threadId: selectedThread?.id, questionId: pendingQuestion.questionId, answer });
      setGoalExecution(execution);
      if (isGlobalModelBusy) {
        enqueueComposerQueueDraft(continuationDraft);
        setChatStatus("已记录目标决策；当前轮次收尾后将自动继续执行。");
      } else {
        setChatStatus("已记录目标决策，正在从暂停位置继续执行。");
        void askModel(continuationDraft);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChatStatus(`目标决策提交失败：${message}`);
      setErrorMessage(message);
    } finally {
      setAnsweringGoalQuestion(false);
    }
  }

  function requestGovernmentSpecificationModel(action: "revision" | "guidance", instruction: string) {
    const request = action === "revision"
      ? `请修改当前政务写作规格。修改要求：${instruction || "检查并优化任务、核心要求、官方证据和结构模板"}。必须返回完整四部分及可解析的JSON规格正文，不要起草文章正文。`
      : `请指导我修改当前政务写作规格。要求：${instruction || "检查任务、核心要求、官方证据和结构模板"}。不要直接改写规格。请先逐条说明建议，再返回一个 JSON 代码块，内容必须是建议数组，每项严格使用 {"suggestionId":"s-1","target":{"kind":"task"},"reason":"原因","proposedValue":"建议的新值"}。target.kind 只能是 task、requirement 或 section-points；后两者分别补充 key 或 sectionId。不要起草文章正文。`;
    const draft = { threadId: selectedThread?.id || "", question: request, images: [], tools: [], skill: null, skillContext: "", modes: ["goal"], createdAt: new Date().toISOString() };
    if (isGlobalModelBusy) {
      enqueueComposerQueueDraft(draft);
      setChatStatus("规格修改请求已排队。");
    } else {
      void askModel(draft);
    }
  }

  function disableComposerMode(mode: "goal" | "plan") {
    setComposerModes((current: Array<"goal" | "plan">) => current.filter((item) => item !== mode));
    if (mode === "goal") setSelectedComposerTools([]);
    setComposerMenu(null);
  }

  function currentResearchWritingPayload() {
    const latestBody = [...conversationTurns].reverse().find((turn: any) => turn.assistant?.content)?.assistant?.content || "";
    const sources = buildResearchWritingSources(conversationTurns);
    return { title: researchWritingSession.topic || selectedThread?.title || "地方实践文章", body: latestBody, sources };
  }

  async function reviewCurrentResearchWriting() {
    if (!api) return;
    const payload = currentResearchWritingPayload();
    if (!payload.body) {
      setChatStatus("当前对话还没有可校验的助手稿件");
      setComposerMenu(null);
      return;
    }
    try {
      const review = await api.reviewResearchWriting(payload);
      const details = (review.risks || []).filter((risk: any) => !risk.supported).slice(0, 12)
        .map((risk: any) => `- [${risk.label}/${risk.severity}] ${risk.claim}\n  ${risk.suggestion}`)
        .join("\n");
      setQuestion(`请根据以下确定性事实校验结果修订当前稿件；没有来源支持的内容不得自行补写，只能删除或标注【待核验】。\n\n未找到直接素材依据：${review.unsupported_count} 项\n${details || "- 当前扫描项均找到直接素材依据，仍需人工核对上下文口径。"}`);
      setChatStatus(`事实校验完成：${review.unsupported_count} 项需复核`);
    } catch (error) {
      setChatStatus(error instanceof Error ? error.message : String(error));
    }
    setComposerMenu(null);
  }

  async function exportCurrentResearchWriting(format: "docx" | "txt" | "review-docx" | "review-txt") {
    if (!api) return;
    const payload = currentResearchWritingPayload();
    if (!payload.body) {
      setChatStatus("当前对话还没有可导出的助手稿件");
      setComposerMenu(null);
      return;
    }
    try {
      const result = await api.exportResearchWriting({ payload, format });
      setChatStatus(result.canceled ? "已取消导出" : `已导出到 ${result.path || "所选位置"}`);
    } catch (error) {
      setChatStatus(error instanceof Error ? error.message : String(error));
    }
    setComposerMenu(null);
  }
  const [newChatComposerHost, setNewChatComposerHost] = useState<HTMLElement | null>(null);
  const [brainChatComposerHost, setBrainChatComposerHost] = useState<HTMLElement | null>(null);
  const [quotaWarning, setQuotaWarning] = useState<any>(null);
  const [dailyBalance, setDailyBalance] = useState<{ remaining: number; quota: number; percent: number } | null>(null);
  const [dismissedQuotaWarningKey, setDismissedQuotaWarningKey] = useState("");
  const [expandedAssistantTurns, setExpandedAssistantTurns] = useState<Set<string>>(() => new Set());
  const [expandedActivityGroups, setExpandedActivityGroups] = useState<Set<string>>(() => new Set());
  const [expandedCommandRuns, setExpandedCommandRuns] = useState<Set<string>>(() => new Set());
  const manuallyCollapsedActivityGroupsRef = useRef<Set<string>>(new Set());
  const manuallyCollapsedCommandRunsRef = useRef<Set<string>>(new Set());
  const manuallyCollapsedAssistantTurnsRef = useRef<Set<string>>(new Set());
  const [expandedFileChangeGroups, setExpandedFileChangeGroups] = useState<Set<string>>(() => new Set());
  const [expandedFileDiffs, setExpandedFileDiffs] = useState<Set<string>>(() => new Set());
  const [inlineFileDiffs, setInlineFileDiffs] = useState<Record<string, any>>({});
  const wasAskingModelRef = useRef(isAskingModel);
  const previousActiveReasoningRequestIdRef = useRef(activeReasoningRequestId);
  const [activityClock, setActivityClock] = useState(Date.now());
  const activityScrollRef = useRef<HTMLDivElement | null>(null);
  const voiceRecognitionRef = useRef<any>(null);
  const holdDictationActiveRef = useRef(false);
  const addWorkspaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const addWorkspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const newChatProjectRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (wasAskingModelRef.current && !isAskingModel) {
      setExpandedAssistantTurns(new Set());
      setExpandedActivityGroups(new Set());
      setExpandedCommandRuns(new Set());
      manuallyCollapsedActivityGroupsRef.current.clear();
      manuallyCollapsedCommandRunsRef.current.clear();
      manuallyCollapsedAssistantTurnsRef.current.clear();
    }
    wasAskingModelRef.current = isAskingModel;
  }, [isAskingModel]);
  useEffect(() => {
    if (activeReasoningRequestId && activeReasoningRequestId !== previousActiveReasoningRequestIdRef.current) {
      // Codex scopes reasoning/activity disclosure to a turn. Starting a new
      // turn must collapse details that the user expanded on the previous one.
      setExpandedAssistantTurns(new Set());
      setExpandedActivityGroups(new Set());
      setExpandedCommandRuns(new Set());
      manuallyCollapsedActivityGroupsRef.current.clear();
      manuallyCollapsedCommandRunsRef.current.clear();
      manuallyCollapsedAssistantTurnsRef.current.clear();
    }
    previousActiveReasoningRequestIdRef.current = activeReasoningRequestId;
  }, [activeReasoningRequestId]);
  useEffect(() => {
    if (!isAskingModel) return;
    const liveTurnId = conversationTurns.at(-1)?.id;
    if (!liveTurnId || manuallyCollapsedAssistantTurnsRef.current.has(liveTurnId)) return;
    setExpandedAssistantTurns((current) => (current.has(liveTurnId) ? current : new Set(current).add(liveTurnId)));
  }, [isAskingModel, conversationTurns, activeReasoningRequestId]);
  useEffect(() => {
    // Interrupted/failure turns should open once so the error text is visible, but
    // remain collapsible afterward (excludeFromModelContext must not force-open forever).
    for (const turn of conversationTurns) {
      if (!turn?.assistant?.excludeFromModelContext || !turn.id) continue;
      if (manuallyCollapsedAssistantTurnsRef.current.has(turn.id)) continue;
      setExpandedAssistantTurns((current) => (current.has(turn.id) ? current : new Set(current).add(turn.id)));
    }
  }, [conversationTurns]);
  const historicalPatchActivities = timelineItems
    .filter((item: any) => item.type === "patch" || item.type === "run")
    .filter((item: any) => item.type !== "run")
    .slice(-20)
    .reverse()
    .map((item: any) => ({ type: item.type, title: item.title, detail: item.detail }));
  const historicalRunActivities = (snapshot?.runs ?? []).slice(0, 100).map((run: any) => ({
    type: "run",
    title: run.status === "failed" ? "命令执行失败" : "已执行命令",
    detail: run.command || run.label,
    executionId: run.id,
    callId: run.callId,
    toolName: run.toolName || run.label,
    command: run.command,
    cwd: run.cwd,
    status: run.status,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    stdout: run.stdout,
    stderr: run.stderr,
    failureMessage: run.failureMessage,
    output: run.output,
    outputTruncated: run.outputTruncated,
    originalOutputBytes: run.originalOutputBytes
  }));
  const persistedRunActivities = projectPersistedActivities(snapshot?.events ?? []);
  const persistedActivitiesByUserMessage = groupActivitiesByUserMessage(
    snapshot?.events ?? [],
    persistedRunActivities
  );
  const historicalActivities = [
    ...(persistedRunActivities.length ? persistedRunActivities : historicalRunActivities),
    ...historicalPatchActivities
  ];
  const mergeActivities = (...groups: any[][]) => {
    const merged = new Map<string, any>();
    for (const activity of groups.flat()) {
      const key = String(
        activity.callId
        || activity.executionId
        || `${activity.type}:${activity.title}:${activity.detail || activity.command || ""}`
      );
      merged.set(key, { ...(merged.get(key) ?? {}), ...activity });
    }
    return [...merged.values()];
  };
  // Codex scopes live activities to the active turn/request. Prior turns keep
  // their own persisted reasoningSummary / activities and stay inspectable.
  const visibleAssistantActivities = isAskingModel
    ? (assistantActivities ?? []).filter((activity: any) =>
      !activeReasoningRequestId
      || !activity?.requestId
      || activity.requestId === activeReasoningRequestId
    )
    : [];
  const activityPriority = (title: string) => title === "正在执行命令" ? 0 : title === "等待批准" ? 1 : 2;
  const summarizeRunActivity = (activity: any) => {
    const firstLine = String(activity.detail || "").split("\n")[0].trim();
    if (activity.title === "正在执行命令") return "正在运行命令";
    if (activity.title === "等待批准") return "等待批准命令";
    if (activity.title === "命令执行失败") return "命令执行失败";
    return "已运行命令";
  };
  const activityKey = (activity: any) => {
    if (activity.callId) return `${activity.type}:${activity.callId}`;
    if (activity.type === "run") {
      if (activity.executionId || activity.callId) return `run:${activity.executionId || activity.callId}`;
      const detail = String(activity.detail || "").split("\n")[0].trim();
      if (/workspace\.scan|Get-ChildItem -Force/i.test(detail)) return "run:workspace.scan";
      if (/git\.status|git status --short --branch/i.test(detail)) return "run:git.status";
      return `run:${detail || activity.title}`;
    }
    return `${activity.type}:${activity.title}`;
  };
  useEffect(() => {
    if (!isAskingModel) return;
    const liveGroupKey = `live-activities-${conversationTurns.at(-1)?.id || "active"}`;
    if (!manuallyCollapsedActivityGroupsRef.current.has(liveGroupKey)) {
      setExpandedActivityGroups((current) => current.has(liveGroupKey) ? current : new Set(current).add(liveGroupKey));
    }
    const runKeys = visibleAssistantActivities
      .filter((activity: any) => activity.type === "run")
      .map((activity: any) => String(activity.executionId || activity.callId || activity.command || activityKey(activity)));
    setExpandedCommandRuns((current) => {
      const next = new Set(current);
      let changed = false;
      for (const runKey of runKeys) {
        if (!manuallyCollapsedCommandRunsRef.current.has(runKey) && !next.has(runKey)) {
          next.add(runKey);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [activeReasoningRequestId, conversationTurns, isAskingModel, visibleAssistantActivities]);
  const renderActivityRow = (activity: any, key: string) => {
    const changes = String(activity.detail || "").match(/^\+(\d+)\s+-(\d+)$/);
    const isFailedRun = activity.type === "run" && activity.title === "命令执行失败";
    const runKey = String(activity.executionId || activity.callId || activity.command || activityKey(activity));
    const isRun = activity.type === "run";
    const isCommandRun = isRun && Boolean(activity.executionId || activity.callId || activity.command || ["正在执行命令", "等待批准", "已执行命令", "命令执行失败"].includes(activity.title));
    const expanded = isCommandRun && expandedCommandRuns.has(runKey);
    const command = String(activity.command || activity.detail || activity.toolName || "");
    const stdout = String(activity.stdout || "");
    const stderr = String(activity.stderr || "");
    const legacyOutput = !stdout && !stderr ? String(activity.output || "") : "";
    const combinedOutput = [stdout, stderr, legacyOutput].filter(Boolean).join("\n");
    const toggleRun = () => setExpandedCommandRuns((current) => {
      const next = new Set(current);
      if (next.has(runKey)) {
        next.delete(runKey);
        manuallyCollapsedCommandRunsRef.current.add(runKey);
      } else {
        next.add(runKey);
        manuallyCollapsedCommandRunsRef.current.delete(runKey);
      }
      return next;
    });
    if (isCommandRun) {
      return (
        <div className={`assistant-command-run${expanded ? " expanded" : ""}${isFailedRun ? " failed" : ""}`} key={key}>
          <button type="button" className="assistant-activity-row run" aria-expanded={expanded} onClick={toggleRun}>
            <SidebarIcon name="chevron-right" />
            <span>{summarizeRunActivity(activity)}</span>
            <code>{command}</code>
            {typeof activity.durationMs === "number" ? <time>{activity.durationMs} ms</time> : null}
          </button>
          {expanded ? (
            <div className="assistant-command-details">
              <div className="assistant-command-actions">
                <button type="button" onClick={() => void writeClipboard(command)}>复制命令</button>
                {combinedOutput ? <button type="button" onClick={() => void writeClipboard(combinedOutput)}>复制输出</button> : null}
              </div>
              <dl>
                <div><dt>工具</dt><dd>{activity.toolName || "shell.exec"}</dd></div>
                {activity.cwd ? <div><dt>工作目录</dt><dd>{activity.cwd}</dd></div> : null}
                <div><dt>状态</dt><dd>{activity.status || (isFailedRun ? "failed" : "completed")}</dd></div>
                <div><dt>退出码</dt><dd>{activity.exitCode ?? "未知"}</dd></div>
              </dl>
              <section><h4>命令</h4><pre>{command}</pre></section>
              {stdout ? <section><h4>标准输出</h4><pre>{stdout}</pre></section> : null}
              {stderr ? <section className="stderr"><h4>错误输出</h4><pre>{stderr}</pre></section> : null}
              {legacyOutput ? <section><h4>输出</h4><pre>{legacyOutput}</pre></section> : null}
              {activity.failureMessage && activity.failureMessage !== stderr ? <section className="stderr"><h4>失败原因</h4><pre>{activity.failureMessage}</pre></section> : null}
              {!stdout && !stderr && !legacyOutput && !activity.failureMessage ? <p>命令没有输出。</p> : null}
              {activity.outputTruncated ? <p className="truncated">输出已截断（原始大小 {activity.originalOutputBytes ?? "未知"} 字节）。</p> : null}
            </div>
          ) : null}
        </div>
      );
    }
    const patchTitleMatch = activity.type === "patch" ? String(activity.title || "").match(/^(已编辑|已新建)\s+(.+)$/) : null;
    const patchFile = activity.type === "patch"
      ? { filePath: String(activity.artifactPath || patchTitleMatch?.[2] || "").trim() }
      : null;
    return (
      <div className={`assistant-activity-row ${activity.type}${isFailedRun ? " failed" : ""}`} key={key}
        data-tool-name={activity.toolName ? String(activity.toolName) : undefined}>
        <SidebarIcon name={activity.type === "patch" ? "edit" : "chevron-right"} />
        {patchFile?.filePath ? <a className="assistant-activity-file-link" href={patchFile.filePath} data-local-file-path={patchFile.filePath}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); openLocalFilePreview(patchFile.filePath); }}
          onContextMenu={(event) => showWorkspaceFileMenu(event, patchFile.filePath)}>{patchFile.filePath}</a>
          : <span>{activity.type === "run" ? summarizeRunActivity(activity) : activity.title}</span>}
        {changes ? (
          <em>
            <i>+{changes[1]}</i>
            <b>-{changes[2]}</b>
          </em>
        ) : (
          <code>{activity.detail}</code>
        )}
      </div>
    );
  };
  const toggleActivityGroup = (key: string) => {
    setExpandedActivityGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
        manuallyCollapsedActivityGroupsRef.current.add(key);
      } else {
        next.add(key);
        manuallyCollapsedActivityGroupsRef.current.delete(key);
      }
      return next;
    });
  };
  const renderActivitySummaryRow = (activities: any[], key: string) => {
    const patchCount = activities.filter((activity) => activity.type === "patch").length;
    const runCount = activities.filter((activity) => activity.type === "run" && (activity.executionId || activity.callId || activity.command || ["已执行命令", "命令执行失败"].includes(activity.title))).length;
    const runningCount = activities.filter((activity) => activity.type === "run" && (activity.title === "正在执行命令" || activity.title === "等待批准")).length;
    const failedCount = activities.filter((activity) => activity.title === "命令执行失败").length;
    const processCount = activities.filter((activity) => activity.type === "complete" || (activity.type === "run" && !activity.executionId && !activity.callId && !activity.command && !["正在执行命令", "正在运行命令", "等待批准", "已执行命令", "已运行命令", "命令执行失败"].includes(activity.title))).length;
    const expanded = expandedActivityGroups.has(key);
    const labels = [
      runCount ? `执行了 ${runCount} 条命令` : "",
      runningCount ? `正在处理 ${runningCount} 条命令` : "",
      failedCount ? `失败 ${failedCount} 条命令` : "",
      patchCount ? `编辑了 ${patchCount} 个文件` : "",
      processCount ? `${isAskingModel ? "正在处理" : "已处理"} ${processCount} 个步骤` : ""
    ].filter(Boolean);
    return (
      <div className={`assistant-activity-group${expanded ? " expanded" : ""}`} key={key}>
        <button type="button" className={`assistant-activity-row summary${expanded ? " expanded" : ""}`} aria-expanded={expanded} onClick={() => toggleActivityGroup(key)}>
          <SidebarIcon name={patchCount ? "edit" : "chevron-right"} />
          <span>{labels.join(" · ") || "已处理活动"}</span>
        </button>
        {expanded ? (
          <div className="assistant-activity-group-items">
            {activities.map((activity, index) => renderActivityRow(activity, `${key}-${activity.type}-${activity.title}-${index}`))}
          </div>
        ) : null}
      </div>
    );
  };
  const filePreviewRequestSequence = useRef(0);
  const activeArtifactPathRef = useRef("");
  useEffect(() => {
    activeArtifactPathRef.current = searchFilePreview?.tabPath || searchFilePreview?.path || "";
  }, [searchFilePreview]);
  const reportFilePreviewIssue = useCallback(async (input: {
    filePath: string;
    workspaceId?: string;
    issue: FilePreviewIssue;
    attempt: number;
    artifact: boolean;
    size?: number;
    binary?: boolean;
  }) => {
    const context = buildFilePreviewDiagnosticContext({
      workspaceId: input.workspaceId,
      filePath: input.filePath,
      reason: input.issue.reason,
      attempt: input.attempt,
      artifact: input.artifact,
      size: input.size,
      binary: input.binary,
      errorMessage: input.issue.message
    });
    console.error("[file-preview]", input.issue.reason, context);
    // Expected missing outputs should stay in-panel; do not mint desktop-error diagnostics.
    if (input.issue.reason === "missing_file") {
      setChatStatus(formatFilePreviewStatus(input.issue));
      return "";
    }
    let reportId = "";
    try {
      const result = await api?.reportRendererDiagnostic?.({
        kind: `file_preview_${input.issue.reason}`,
        message: input.issue.message,
        context
      });
      reportId = result?.id || "";
    } catch (error) {
      console.error("[file-preview] diagnostic report failed", error);
    }
    setChatStatus(formatFilePreviewStatus(input.issue, reportId || undefined));
    return reportId;
  }, [api, setChatStatus]);
  const openLocalFilePreview = useCallback((filePath: string, location?: { line?: number; endLine?: number; column?: number; workspaceId?: string; displayName?: string; forceReload?: boolean }) => {
    const workspaceId = location?.workspaceId || selectedWorkspace?.id;
    const displayName = String(location?.displayName || "").trim();
    if (!api || !workspaceId || !filePath) {
      const issue: FilePreviewIssue = {
        ok: false,
        reason: "no_workspace",
        retryable: false,
        message: !filePath ? "缺少文件路径，无法预览。" : "当前工作区不可用，无法预览文件。"
      };
      void reportFilePreviewIssue({ filePath: filePath || "", workspaceId, issue, attempt: 1, artifact: false });
      return;
    }
    if (location?.workspaceId && location.workspaceId !== selectedWorkspace?.id) {
      setSelectedWorkspaceId(location.workspaceId);
    }
    setActiveFeature("new-chat");
    setIsComposingNewThread(false);
    setPreviewMode("workspace");
    // When the BRAIN project panel (文件/产物/任务) is open, put the file preview
    // in that right-hand slot so it replaces the empty project list instead of
    // stealing the chat column (Office used to force center → red preview left of green empty panel).
    // artifact-workbench CSS still gives the side preview a wide surface for Office docs.
    const useProjectPanelSlot = brainResourcePlacement !== "hidden";
    setPreviewPlacement(
      useProjectPanelSlot
        ? "side"
        : (/\.(?:docx|pdf|pptx|xlsx)$/i.test(filePath) ? "center" : "side")
    );
    const existing = findMatchingArtifactTab(artifactTabsRef.current, filePath);
    if (existing && isReusableArtifactPreview(existing) && !location?.line && !location?.forceReload) {
      activeArtifactPathRef.current = existing.tabPath;
      setActiveTreePath(existing.path || existing.tabPath);
      setSearchFilePreview(existing);
      return;
    }
    const existingPath = String(existing?.path || existing?.tabPath || "");
    const requestedHasDir = /[\\/]/.test(filePath) || /^[a-zA-Z]:/.test(filePath);
    const existingHasDir = /[\\/]/.test(existingPath);
    const openPath = requestedHasDir || !existingHasDir ? filePath : existingPath || filePath;
    const previewName = displayName || openPath.split(/[\\/]/).pop() || openPath;
    const tabKey = String(existing?.tabPath || openPath || filePath);
    const loadingTab = {
      tabPath: tabKey,
      path: openPath,
      name: previewName,
      loading: true,
      error: undefined,
      blankReason: undefined,
      workspaceId,
      ...location
    };
    activeArtifactPathRef.current = tabKey;
    setActiveTreePath(openPath);
    setArtifactTabs((tabs) => {
      const matched = findMatchingArtifactTab(tabs, filePath) || findMatchingArtifactTab(tabs, tabKey);
      if (matched) {
        return tabs.map((tab) => (tab === matched || tab.tabPath === matched.tabPath ? { ...tab, ...loadingTab } : tab));
      }
      return [...tabs, loadingTab];
    });
    setSearchFilePreview(loadingTab);
    const requestSequence = ++filePreviewRequestSequence.current;
    const requestPath = openPath;
    const requestTabKey = tabKey;
    const requestWorkspaceId = workspaceId;
    const artifact = isWorkspaceArtifactPreviewPath(requestPath, displayName);
    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const stillActiveForRequest = () => {
      const active = String(activeArtifactPathRef.current || "");
      return artifactPathsReferToSameFile(active, requestPath)
        || artifactPathsReferToSameFile(active, requestTabKey)
        || artifactPathsReferToSameFile(active, filePath);
    };
    const requestTabKeys = () => [requestTabKey, requestPath, filePath];
    const readPreviewPayload = async () => withFilePreviewTimeout(
      artifact
        ? api.previewWorkspaceFile({ workspaceId: requestWorkspaceId, filePath: requestPath })
        : api.readWorkspaceFile({ workspaceId: requestWorkspaceId, filePath: requestPath }),
      FILE_PREVIEW_TIMEOUT_MS
    );
    void (async () => {
      let lastIssue: FilePreviewIssue | null = null;
      let lastFile: any = null;
      for (let attempt = 1; attempt <= FILE_PREVIEW_MAX_ATTEMPTS; attempt += 1) {
        if (isStaleFilePreviewRequest(requestSequence, filePreviewRequestSequence.current)) return;
        try {
          const file = await readPreviewPayload();
          if (file && (file as { ok?: boolean }).ok === false) {
            lastIssue = classifySoftFilePreviewFailure(file as { ok?: boolean; error?: string; message?: string; reason?: string });
            if (!lastIssue.retryable || attempt === FILE_PREVIEW_MAX_ATTEMPTS) break;
            await sleep(filePreviewRetryDelayMs(attempt));
            continue;
          }
          lastFile = file;
          const diagnosis = artifact ? classifyArtifactPreviewPayload(file) : classifyTextPreviewPayload(file);
          if (diagnosis.ok) {
            if (isStaleFilePreviewRequest(requestSequence, filePreviewRequestSequence.current)) return;
            const canonicalPath = String(file.path || requestPath);
            const loadedTab = {
              ...file,
              tabPath: canonicalPath,
              loading: false,
              error: undefined,
              blankReason: undefined,
              diagnosticId: undefined,
              workspaceId: requestWorkspaceId,
              ...location
            };
            const activeForRequest = stillActiveForRequest();
            if (activeForRequest) activeArtifactPathRef.current = canonicalPath;
            setArtifactTabs((tabs) => {
              if (activeForRequest) {
                const next = tabs.filter((tab) =>
                  !artifactPathsReferToSameFile(String(tab.tabPath || ""), canonicalPath)
                  && !artifactPathsReferToSameFile(String(tab.path || ""), canonicalPath)
                  && !artifactPathsReferToSameFile(String(tab.tabPath || ""), requestTabKey)
                  && !artifactPathsReferToSameFile(String(tab.tabPath || ""), requestPath)
                  && !artifactPathsReferToSameFile(String(tab.tabPath || ""), filePath)
                );
                return [...next, loadedTab];
              }
              return patchArtifactTabsForRequest(tabs, requestTabKeys(), loadedTab);
            });
            if (activeForRequest) {
              setActiveTreePath(canonicalPath);
              setSearchFilePreview(loadedTab);
              if (location?.line) window.requestAnimationFrame(() => document.querySelector(`[data-preview-line="${location.line}"]`)?.scrollIntoView({ block: "center" }));
            }
            return;
          }
          lastIssue = diagnosis;
          if (!diagnosis.retryable || attempt === FILE_PREVIEW_MAX_ATTEMPTS) break;
          await sleep(filePreviewRetryDelayMs(attempt));
          continue;
        } catch (error) {
          lastIssue = classifyFilePreviewError(error);
          if (!lastIssue.retryable || attempt === FILE_PREVIEW_MAX_ATTEMPTS) break;
          await sleep(filePreviewRetryDelayMs(attempt));
        }
      }
      if (isStaleFilePreviewRequest(requestSequence, filePreviewRequestSequence.current)) return;
      const issue = lastIssue || {
        ok: false as const,
        reason: "read_failed" as const,
        retryable: false,
        message: "文件预览失败。"
      };
      const reportId = await reportFilePreviewIssue({
        filePath: requestPath,
        workspaceId: requestWorkspaceId,
        issue,
        attempt: FILE_PREVIEW_MAX_ATTEMPTS,
        artifact,
        size: lastFile?.size,
        binary: lastFile?.binary
      });
      const failedTab = {
        ...(lastFile || {}),
        tabPath: requestTabKey,
        path: lastFile?.path || requestPath,
        name: lastFile?.name || requestPath.split(/[\\/]/).pop() || requestPath,
        loading: false,
        error: issue.message,
        blankReason: issue.reason,
        diagnosticId: reportId,
        content: lastFile?.content ?? "",
        binary: lastFile?.binary,
        size: lastFile?.size,
        workspaceId: requestWorkspaceId,
        ...location
      };
      const activeForRequest = stillActiveForRequest();
      setArtifactTabs((tabs) => {
        if (activeForRequest) {
          const matched = findMatchingArtifactTab(tabs, requestTabKey)
            || findMatchingArtifactTab(tabs, requestPath)
            || findMatchingArtifactTab(tabs, filePath);
          if (!matched) return [...tabs, failedTab];
          return tabs.map((tab) => (tab === matched || tab.tabPath === matched.tabPath ? failedTab : tab));
        }
        return patchArtifactTabsForRequest(tabs, requestTabKeys(), failedTab);
      });
      if (activeForRequest) setSearchFilePreview(failedTab);
      if (issue.reason === "preview_unsupported" || issue.reason === "binary_file" || issue.reason === "read_failed") {
        void api.openWorkspaceFile({ workspaceId: requestWorkspaceId, filePath: requestPath }).catch(() => undefined);
      }
    })();
  }, [api, brainResourcePlacement, reportFilePreviewIssue, selectedWorkspace?.id, setActiveFeature, setActiveTreePath, setIsComposingNewThread, setPreviewMode, setPreviewPlacement, setSearchFilePreview, setSelectedWorkspaceId]);
  openLocalFilePreviewRef.current = openLocalFilePreview;

  useEffect(() => {
    if (!api?.onOpenWorkspaceFilePreview) return;
    return api.onOpenWorkspaceFilePreview((event) => {
      if (!event?.filePath) return;
      if (event.workspaceId && selectedWorkspace?.id && event.workspaceId !== selectedWorkspace.id) {
        setSelectedWorkspaceId(event.workspaceId);
      }
      openLocalFilePreview(event.filePath);
    });
  }, [api, openLocalFilePreview, selectedWorkspace?.id, setSelectedWorkspaceId]);
  const showWorkspaceFileMenu = (event: any, filePath: string) => {
    event.preventDefault();
    event.stopPropagation();
    setWorkspaceFileMenu(positionLocalFileMenu(event.currentTarget, { filePath }, { x: event.clientX, y: event.clientY }));
  };
  const selectArtifactTab = (tab: any) => {
    if (tab.loading) {
      openLocalFilePreview(tab.tabPath || tab.path, {
        ...(tab.workspaceId ? { workspaceId: tab.workspaceId } : {}),
        ...(tab.line ? { line: tab.line, endLine: tab.endLine } : {})
      });
      return;
    }
    activeArtifactPathRef.current = tab.tabPath;
    setActiveTreePath(tab.path || tab.tabPath);
    setSearchFilePreview(tab);
  };
  const closeArtifactTab = (tabPath: string) => {
    setArtifactTabs((tabs) => {
      const index = tabs.findIndex((tab) => tab.tabPath === tabPath);
      const nextTabs = tabs.filter((tab) => tab.tabPath !== tabPath);
      if (activeArtifactPathRef.current === tabPath) {
        const replacement = nextTabs[Math.min(index, nextTabs.length - 1)];
        activeArtifactPathRef.current = replacement?.tabPath || "";
        setSearchFilePreview(replacement || null);
        if (!replacement) {
          // BRAIN project panel is the home surface for explore/scene files — restore it
          // instead of falling back to the generic NewBrain files side browser.
          if (brainResourcePlacement !== "hidden") {
            setPreviewMode("empty");
            setPreviewPlacement("hidden");
            setSearchFilePreview(null);
          } else {
            setPreviewMode("files");
            setPreviewPlacement("side");
            void api?.queueWorkspaceScan();
          }
        }
      }
      return nextTabs;
    });
  };
  useEffect(() => {
    const interceptArtifactLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const filePath = resolveLocalArtifactHref(anchor.href, window.location.href);
      if (!filePath) return;
      event.preventDefault();
      event.stopPropagation();
      openLocalFilePreview(filePath);
    };
    document.addEventListener("click", interceptArtifactLink, true);
    return () => document.removeEventListener("click", interceptArtifactLink, true);
  }, [openLocalFilePreview]);
  const openE2EFilePreview = () => {
    const testWorkspace = normalizeWorkspaceCatalog(workspaceCatalog).find((workspace: any) =>
      String(workspace.path || "").replace(/\\/g, "/").endsWith("/.newbrain/projects/test")
    );
    if (!api || !testWorkspace) return;
    setSelectedWorkspaceId(testWorkspace.id);
    setPreviewMode("workspace");
    setPreviewPlacement("side");
    setSearchFilePreview({ path: "final-artifact.txt", name: "final-artifact.txt", loading: true });
    void api.readWorkspaceFile({ workspaceId: testWorkspace.id, filePath: "final-artifact.txt" })
      .then((file: any) => setSearchFilePreview({ ...file, loading: false }))
      .catch((error: unknown) => setSearchFilePreview({
        path: "final-artifact.txt",
        name: "final-artifact.txt",
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      }));
  };
  const countOrderedItems = (text: string) => (text.match(/^\s*\d+\.\s+/gm) ?? []).length;
  const renderStreamingTimeline = (content: string) => {
    const activities = dedupedAssistantActivities
      .filter((activity: any) => activity.type !== "complete")
      .sort((a: any, b: any) => Number(a.contentOffset ?? content.length) - Number(b.contentOffset ?? content.length));
    if (!activities.length) return <MarkdownMessage content={content} workspaceId={selectedWorkspace?.id} onOpenLocalFile={openLocalFilePreview} />;
    const nodes: any[] = [];
    let cursor = 0;
    let orderedSoFar = 0;
    const grouped: Array<{ offset: number; activities: any[] }> = [];
    activities.forEach((activity: any) => {
      const rawOffset = Number(activity.contentOffset ?? content.length);
      const firstSentenceEnd = content.search(/[。！？.!?]\s/);
      const preferredOffset = rawOffset <= 0 && firstSentenceEnd > 0 ? firstSentenceEnd + 1 : rawOffset;
      const offset = Math.max(cursor, Math.min(content.length, preferredOffset));
      const last = grouped.at(-1);
      if (last && Math.abs(last.offset - offset) <= 24) last.activities.push(activity);
      else grouped.push({ offset, activities: [activity] });
    });
    grouped.forEach((group, index) => {
      const offset = Math.max(cursor, group.offset);
      const slice = content.slice(cursor, offset);
      if (slice.trim()) {
        nodes.push(
          <MarkdownMessage
            key={`chunk-${index}`}
            content={slice}
            priorOrderedItemCount={orderedSoFar}
            workspaceId={selectedWorkspace?.id}
            onOpenLocalFile={openLocalFilePreview}
          />
        );
        orderedSoFar += countOrderedItems(slice);
      }
      nodes.push(group.activities.length === 1
        ? renderActivityRow(group.activities[0], `activity-inline-${index}-${group.activities[0].title}-${group.activities[0].detail}`)
        : renderActivitySummaryRow(group.activities, `activity-summary-${index}`));
      cursor = offset;
    });
    const tail = content.slice(cursor);
    if (tail.trim()) {
      nodes.push(
        <MarkdownMessage key="chunk-tail" content={tail} priorOrderedItemCount={orderedSoFar} workspaceId={selectedWorkspace?.id} onOpenLocalFile={openLocalFilePreview} />
      );
    }
    return <div className="assistant-stream-timeline">{nodes}</div>;
  };
  const dedupeActivities = (activities: any[]) => Array.from(activities.reduce((items: Map<string, any>, activity: any) => {
    const key = activityKey(activity);
    const current = items.get(key);
    if (!current || activityPriority(activity.title) >= activityPriority(current.title)) items.set(key, activity);
    return items;
  }, new Map<string, any>()).values());
  const dedupedAssistantActivities = dedupeActivities(visibleAssistantActivities);
  const detailPanelActivities = dedupedAssistantActivities.filter(
    (activity: any) => typeof activity.contentOffset !== "number"
  );
  const formatElapsed = (seconds: number) => seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const liveElapsedSeconds = assistantStartedAt ? Math.max(0, Math.floor((activityClock - assistantStartedAt) / 1000)) : 0;
  const isThreadSidebarSelection =
    selectedSidebarRow?.startsWith("project-thread:") || selectedSidebarRow?.startsWith("chat:");
  const reasoningOptions = [
    { id: "low", label: "低" },
    { id: "medium", label: "中" },
    { id: "high", label: "高" },
    { id: "xhigh", label: "超高" }
  ];
  const optimizeForOptions = [
    { id: "cost", label: "省钱" },
    { id: "balanced", label: "均衡" },
    { id: "intelligence", label: "效果优先" }
  ] as const;
  const composerModelOptions = [
    { id: "auto", label: "Auto" },
    ...(Array.isArray(modelConfig.availableModels)
      ? modelConfig.availableModels.map((item: any) => ({ id: item.model, label: item.label || item.model }))
      : [])
  ];
  const isComposerAuto = String(modelConfig.model || "").toLowerCase() === "auto";
  const optimizeForValue = (modelConfig.optimizeFor === "cost" || modelConfig.optimizeFor === "intelligence")
    ? modelConfig.optimizeFor
    : "balanced";
  const optimizeForLabel = optimizeForOptions.find((option) => option.id === optimizeForValue)?.label || "均衡";
  const reasoningLabel = reasoningOptions.find((option) => option.id === modelConfig.reasoningEffort)?.label || "中";
  const modelLabel = isComposerAuto
    ? "Auto"
    : composerModelOptions.find((option) => option.id.toLowerCase() === modelConfig.model.toLowerCase())?.label
      || customModelEndpoints.find((item) => item.id.toLowerCase() === String(modelConfig.model || "").toLowerCase())?.label
      || (composerModelOptions.length <= 1 && customModelEndpoints.length === 0 ? "无可用模型" : modelConfig.model);
  const applyCustomModelEndpoint = (endpoint: { id: string; label: string; baseUrl: string; wireApi?: string }) => {
    setModelConfig((current: any) => ({
      ...current,
      model: endpoint.id,
      provider: endpoint.label,
      baseUrl: endpoint.baseUrl,
      wireApi: endpoint.wireApi || "chat.completions",
      apiKey: ""
    }));
    void api?.selectCustomModelEndpoint?.({ id: endpoint.id }).then((snapshot: any) => {
      if (Array.isArray(snapshot?.endpoints)) setCustomModelEndpoints(snapshot.endpoints);
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    });
  };
  const selectOfficialComposerModel = (modelId: string) => {
    if (isCustomModelSelection(String(modelConfig.model || ""))) {
      void api?.selectCustomModelEndpoint?.({ id: "" }).catch(() => undefined);
    }
    setModelConfig((current: any) => ({ ...current, model: modelId }));
    setReasoningSubmenu(null);
    setComposerMenu(null);
  };
  const saveCustomModelEndpoint = async () => {
    if (!api?.saveCustomModelEndpoint) {
      setCustomModelError("当前环境无法保存自备模型。");
      return;
    }
    setCustomModelSaving(true);
    setCustomModelError("");
    try {
      const snapshot = await api.saveCustomModelEndpoint(customModelDraft);
      const endpoints = Array.isArray(snapshot?.endpoints) ? snapshot.endpoints : [];
      setCustomModelEndpoints(endpoints);
      const created = endpoints.find((item: any) => item.id === snapshot?.selectedId) ?? endpoints.at(-1);
      if (created) {
        setModelConfig((current: any) => ({
          ...current,
          model: created.id,
          provider: created.label,
          baseUrl: created.baseUrl,
          wireApi: created.wireApi || "chat.completions",
          apiKey: ""
        }));
      }
      setCustomModelDraft(emptyCustomModelDraft);
      setCustomModelFormOpen(false);
    } catch (error) {
      setCustomModelError(error instanceof Error ? error.message : String(error));
    } finally {
      setCustomModelSaving(false);
    }
  };
  const deleteCustomModelEndpoint = async (id: string) => {
    if (!api?.deleteCustomModelEndpoint) return;
    try {
      const snapshot = await api.deleteCustomModelEndpoint({ id });
      const endpoints = Array.isArray(snapshot?.endpoints) ? snapshot.endpoints : [];
      setCustomModelEndpoints(endpoints);
      if (String(modelConfig.model || "").toLowerCase() === id.toLowerCase()) {
        setModelConfig((current: any) => ({ ...current, model: "auto", provider: current.provider }));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const renderCustomModelMenu = (showForm: boolean) => (
    <CustomModelEndpointMenu
      endpoints={customModelEndpoints}
      selectedModelId={String(modelConfig.model || "")}
      formOpen={customModelFormOpen}
      showForm={showForm}
      draft={customModelDraft}
      error={customModelError}
      saving={customModelSaving}
      onDraftChange={setCustomModelDraft}
      onOpenForm={() => {
        setCustomModelError("");
        setCustomModelFormOpen(true);
      }}
      onCancel={() => {
        setCustomModelFormOpen(false);
        setCustomModelError("");
      }}
      onSave={() => { void saveCustomModelEndpoint(); }}
      onSelect={(endpoint) => {
        applyCustomModelEndpoint(endpoint);
        setReasoningSubmenu(null);
        setComposerMenu(null);
      }}
      onDelete={(id) => { void deleteCustomModelEndpoint(id); }}
    />
  );
  const compactModelLabel = isComposerAuto
    ? `Auto·${optimizeForLabel}`
    : modelLabel.replace(/^GPT-/i, "");
  const openModelMenu = async () => {
    setReasoningSubmenu(null);
    if (composerMenu === "reasoning") {
      setComposerMenu(null);
      return;
    }
    try {
      const refreshed = await api.getModelConfig();
      setModelConfig((current: any) => mergeRefreshedModelConfig(current, refreshed));
      setComposerMenu("reasoning");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const contextMeter = estimateContextMeter({
    modelConfig,
    conversationTurns,
    activities: [
      ...persistedRunActivities,
      ...historicalRunActivities,
      ...visibleAssistantActivities
    ],
    events: snapshot?.events,
    draftText: question,
    composerTools: selectedComposerTools,
    imageCount: composerImages.length,
    selectedSkill: selectedComposerSkill,
    skillContext: composerSkillContext,
    mcpTools: mcpDiscoveredTools,
    liveAssistantContent: activeStreamContent,
    liveReasoningSummary: activeReasoningSummary,
    serverEstimatedTokens: readServerEstimatedTokens(snapshot?.events)
  });
  const contextWindowTokens = contextMeter.windowTokens;
  const contextUsedTokens = contextMeter.usedTokens;
  const contextUsedPercent = contextMeter.usedPercent;
  const contextRemainingPercent = contextMeter.remainingPercent;
  const contextMeterBreakdownLines = formatContextMeterBreakdown(contextMeter.breakdown);
  const formatQuotaMoney = (value: unknown) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return "$0.00";
    return `$${amount.toLocaleString(undefined, {
      minimumFractionDigits: amount > 0 && amount < 1 ? 6 : 2,
      maximumFractionDigits: amount > 0 && amount < 1 ? 6 : 2
    })}`;
  };
  const selectedThreadQueue: any[] = composerQueueForThread(composerQueue, selectedThread?.id);
  const selectedThreadRunning = Boolean(selectedThread?.id && activeThreadRequestIds?.[selectedThread.id]);
  const removeQueuedComposerItem = (item: any) => {
    commitComposerQueue(removeComposerQueueItem(readComposerQueue(), item?.id));
  };
  const focusComposerInputWithContent = (content: string) => {
    composerTextareaRef.current?.setValue(content);
    setComposerLayoutDraft(content);
    setQuestion(content);
    window.requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
    });
  };
  const editQueuedComposerItem = (item: any) => {
    if (!item) return;
    const typedText = String(questionRef?.current ?? question ?? "").trim();
    // Append onto whatever the user already typed; never wipe the newer input.
    const combined = combineComposerQuote(typedText, String(item.question || ""));
    if (questionRef) questionRef.current = combined;
    if (Array.isArray(item.images) && item.images.length) {
      setComposerImages((current: any[]) => {
        const seen = new Set((current || []).map((image: any) => image.path));
        return [...(current || []), ...item.images.filter((image: any) => image?.path && !seen.has(image.path))];
      });
    }
    if (Array.isArray(item.tools) && item.tools.length) {
      setSelectedComposerTools((current: any[]) => {
        const seen = new Set((current || []).map((tool: any) => tool.id));
        return [...(current || []), ...item.tools.filter((tool: any) => tool?.id && !seen.has(tool.id))];
      });
    }
    if (item.skill) setSelectedComposerSkill(item.skill);
    if (item.skillContext) setComposerSkillContext(item.skillContext);
    if (Array.isArray(item.modes) && item.modes.length) {
      setComposerModes((current: Array<"goal" | "plan">) => [...new Set([...(current || []), ...item.modes])]);
    }
    removeQueuedComposerItem(item);
    focusComposerInputWithContent(combined);
  };
  const sendQueuedComposerItemNow = async (item: any) => {
    if (!item || !selectedThread?.id) return;
    const threadId = selectedThread.id;
    const message = String(item.question || "").trim() || "请查看附件";
    // Leave the queue only after a successful dispatch; a failed send goes back to the front.
    removeQueuedComposerItem(item);
    const requeue = (detail: string) => {
      commitComposerQueue(requeueComposerItemFirst(readComposerQueue(), item));
      setChatStatus(detail);
    };
    const requestId = activeThreadRequestIds[threadId] || "";
    if (!requestId) {
      setChatStatus("排队消息正在发送…");
      window.setTimeout(() => void askModel(item), 0);
      return;
    }
    if (!api?.guideModelRequest) {
      requeue("当前运行不支持插入消息，已保持排队；本轮结束后会自动发送。");
      return;
    }
    const attachments = (Array.isArray(item.images) ? item.images : [])
      .filter((image: any) => image?.path)
      .slice(0, 8)
      .map((image: any) => ({
        name: String(image.name || image.path.split(/[\\/]/).pop() || "attachment"),
        path: String(image.path),
        url: typeof image.url === "string" ? image.url : undefined
      }));
    try {
      const result = await api.guideModelRequest({ requestId, message, attachments, delivery: "steer" });
      if (result?.ok === false && result.code === "request_not_active") {
        releaseInactiveModelRequest?.(requestId, threadId);
        setChatStatus("当前运行已结束，排队消息正在作为下一轮发送…");
        window.setTimeout(() => void askModel(item), 0);
        return;
      }
      if (result?.ok === false) {
        requeue(result.detail || "未能插入当前运行，已保持排队。");
        return;
      }
      setChatStatus(result?.detail || "已插入当前运行。");
    } catch (error) {
      // Direct-draft / no-loop turns cannot be steered; keep the item so finish auto-sends.
      requeue(
        error instanceof Error
          ? `当前运行暂不可插入消息（${error.message}），已保持排队；本轮结束后会自动发送。`
          : "当前运行暂不可插入消息，已保持排队；本轮结束后会自动发送。"
      );
    }
  };
  const resumeComposerQueue = () => {
    const [next] = selectedThreadQueue;
    if (!next || selectedThreadRunning) return;
    removeQueuedComposerItem(next);
    window.setTimeout(() => void askModel(next), 0);
  };

  const parseDiffPreviewRows = (diff: string) => {
    const rows: Array<{ type: "add" | "del" | "ctx" | "hunk"; text: string; oldLine?: number; newLine?: number }> = [];
    let oldLine = 0;
    let newLine = 0;
    for (const line of String(diff || "").split("\n")) {
      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
        rows.push({ type: "hunk", text: line });
        continue;
      }
      if (!rows.length || line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) continue;
      if (line.startsWith("+")) {
        rows.push({ type: "add", text: line.slice(1), newLine });
        newLine += 1;
        continue;
      }
      if (line.startsWith("-")) {
        rows.push({ type: "del", text: line.slice(1), oldLine });
        oldLine += 1;
        continue;
      }
      rows.push({ type: "ctx", text: line.startsWith(" ") ? line.slice(1) : line, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
    const changedIndexes = new Set<number>();
    rows.forEach((row, index) => {
      if (row.type === "add" || row.type === "del" || row.type === "hunk") {
        for (let offset = -3; offset <= 3; offset += 1) changedIndexes.add(index + offset);
      }
    });
    return rows.filter((row, index) => row.type !== "ctx" || changedIndexes.has(index)).slice(0, 28);
  };

  const fileChangeFromActivity = (activity: any) => {
    if (activity?.type !== "patch") return null;
    const title = String(activity.title || "").trim();
    const titleMatch = title.match(/^(已编辑|已新建)\s+(.+)$/);
    const filePath = String(activity.artifactPath || titleMatch?.[2] || "").trim();
    if (!filePath) return null;
    const detailMatch = String(activity.detail || "").match(/^\+(\d+)\s+-(\d+)$/);
    return {
      filePath,
      deliverable: DELIVERABLE_FILE_PATTERN.test(filePath),
      additions: detailMatch ? Number(detailMatch[1]) : undefined,
      deletions: detailMatch ? Number(detailMatch[2]) : undefined,
      artifactVerified: Boolean(activity.artifactVerified)
    };
  };

  const toggleInlineFileDiff = async (groupKey: string, file: any) => {
    const diffKey = `${groupKey}:${file.filePath}`;
    if (expandedFileDiffs.has(diffKey)) {
      setExpandedFileDiffs((current) => {
        const next = new Set(current);
        next.delete(diffKey);
        return next;
      });
      return;
    }
    setExpandedFileDiffs((current) => new Set(current).add(diffKey));
    if (inlineFileDiffs[diffKey]) return;
    setInlineFileDiffs((current) => ({ ...current, [diffKey]: { loading: true } }));
    try {
      if (!api?.getReviewChanges || !selectedWorkspace?.id) throw new Error("当前工作区无法读取文件变更。");
      const result = await api.getReviewChanges({ workspaceId: selectedWorkspace.id, threadId: selectedThread?.id });
      const reviewFile = result.files?.find((item: any) => item.filePath === file.filePath || item.filePath.endsWith(file.filePath) || file.filePath.endsWith(item.filePath));
      setInlineFileDiffs((current) => ({
        ...current,
        [diffKey]: {
          loading: false,
          rows: parseDiffPreviewRows(reviewFile?.diff || ""),
          additions: Number(reviewFile?.additions ?? file.additions ?? 0),
          deletions: Number(reviewFile?.deletions ?? file.deletions ?? 0)
        }
      }));
    } catch (error) {
      setInlineFileDiffs((current) => ({ ...current, [diffKey]: { loading: false, error: error instanceof Error ? error.message : String(error) } }));
    }
  };

  const renderFileChangeContext = (turnId: string, activities: any[]) => {
    const files = activities.map(fileChangeFromActivity).filter(Boolean);
    if (!files.length) return null;
    const groupKey = `${selectedThread?.id || "thread"}:${turnId}`;
    const expanded = expandedFileChangeGroups.has(groupKey);
    return (
      <section className={`assistant-file-context${expanded ? " expanded" : ""}`} data-testid="assistant-file-context">
        <button type="button" className="assistant-file-context-summary" aria-expanded={expanded} onClick={() => setExpandedFileChangeGroups((current) => {
          const next = new Set(current);
          next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
          return next;
        })}>
          <SidebarIcon name="edit" />
          <span>编辑了 {files.length} 个文件</span>
          <SidebarIcon name="chevron-right" />
        </button>
        {expanded ? <div className="assistant-file-context-list">{files.map((file: any) => {
          const diffKey = `${groupKey}:${file.filePath}`;
          const diffExpanded = expandedFileDiffs.has(diffKey);
          const diff = inlineFileDiffs[diffKey];
          return <div className={`assistant-file-context-item${diffExpanded ? " expanded" : ""}`} key={file.filePath}>
            <div className="assistant-file-context-row">
              <button type="button" className="assistant-file-diff-toggle" aria-expanded={diffExpanded} onClick={() => void toggleInlineFileDiff(groupKey, file)}><SidebarIcon name="chevron-right" /></button>
              <a
                className="assistant-file-link"
                href={file.filePath}
                title={file.filePath}
                data-local-file-path={file.filePath}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openLocalFilePreview(file.filePath);
                }}
                onContextMenu={(event) => {
                  showWorkspaceFileMenu(event, file.filePath);
                }}
              >{file.filePath}</a>
              <span className="assistant-file-stats">
                {typeof file.additions === "number" ? <i>+{file.additions}</i> : null}
                {typeof file.deletions === "number" ? <b>-{file.deletions}</b> : null}
                {file.artifactVerified ? <em>已验证</em> : null}
              </span>
              <button type="button" className="assistant-file-review" onClick={openReviewPanel}>审核</button>
            </div>
            {diffExpanded ? <div className="assistant-inline-diff" data-testid="assistant-inline-diff">
              {diff?.loading ? <div className="assistant-inline-diff-state">正在读取变更…</div>
                : diff?.error ? <div className="assistant-inline-diff-state error">{diff.error}</div>
                : diff?.rows?.length ? <div className="assistant-inline-diff-code">{diff.rows.map((row: any, index: number) => <div key={`${row.type}-${index}`} className={`assistant-inline-diff-row ${row.type}`}>
                  <span>{row.type === "add" ? row.newLine : row.oldLine || row.newLine || ""}</span>
                  <code>{row.type === "add" ? "+" : row.type === "del" ? "-" : " "}{row.text}</code>
                </div>)}</div>
                : <div className="assistant-inline-diff-state">该文件没有可显示的文本 Diff，可点击文件名在右侧查看。</div>}
            </div> : null}
          </div>;
        })}</div> : null}
      </section>
    );
  };

  const openReviewPanel = () => {
    setReviewDrawerOpen(true);
    setPreviewMode("review");
    setPreviewPlacement("side");
  };

  useEffect(() => {
    if (!isAskingModel || !assistantStartedAt) return;
    setActivityClock(Date.now());
    const timer = window.setInterval(() => setActivityClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isAskingModel, assistantStartedAt]);

  // 仅在侧栏选中项真正切换到线程时才回到聊天视图；
  // 不能依赖 activeFeature 触发，否则打开设置等功能页会被立刻切回 new-chat（设置页闪退的根因）。
  useEffect(() => {
    if (!isThreadSidebarSelection) return;
    setActiveFeature("new-chat");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSidebarRow]);

  const recordAssistantFeedback = async (messageId: string, rating: "helpful" | "unhelpful") => {
    if (!api || !selectedWorkspace || !selectedThread || !messageId) return;
    await api.recordMessageFeedback({
      workspaceId: selectedWorkspace.id,
      threadId: selectedThread.id,
      messageId,
      rating
    });
    setSnapshot(await api.getSnapshot());
  };

  const [messageFeedback, setMessageFeedback] = useState<Record<string, "helpful" | "unhelpful">>({});
  const submitAssistantFeedback = async (messageId: string, rating: "helpful" | "unhelpful") => {
    setMessageFeedback((current) => ({ ...current, [messageId]: rating }));
    try {
      await recordAssistantFeedback(messageId, rating);
      // 目前仅记录反馈；接入评测系统后此处改为弹出原因填写（参考 codex 的反馈流程）。
      setChatStatus(rating === "helpful" ? "感谢您的支持" : "您的反馈已收到，NewBrain会再接再历");
    } catch (error) {
      setChatStatus(`反馈提交失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const toggleAssistantTurnDetails = (turnId: string) => {
    const scrollContainer = taskScrollRef.current;
    const previousScrollTop = scrollContainer?.scrollTop ?? null;
    setExpandedAssistantTurns((current) => {
      const next = new Set(current);
      if (next.has(turnId)) {
        next.delete(turnId);
        manuallyCollapsedAssistantTurnsRef.current.add(turnId);
      } else {
        next.add(turnId);
        manuallyCollapsedAssistantTurnsRef.current.delete(turnId);
      }
      return next;
    });
    if (scrollContainer && previousScrollTop !== null && (!isAskingModel || !stickToBottomRef.current)) {
      window.requestAnimationFrame(() => {
        if (taskScrollRef.current === scrollContainer) scrollContainer.scrollTop = previousScrollTop;
      });
    }
  };

  const selectComposerFiles = async () => {
    if (!api) return;
    try {
      const result = await api.selectComposerImages();
      const files = result?.attachments ?? [];
      const added = attachComposerAttachmentsAtCursor(files, COMPOSER_FOCUS_ATTACHMENT_LIMIT);
      if (result?.detail) {
        if (added > 0) setChatStatus(result.detail);
        else setErrorMessage(result.detail);
      } else if (added > 0) {
        setChatStatus(`已在光标处添加 ${added} 个资料`);
      }
    } catch (error) {
      setErrorMessage(normalizeComposerAttachmentError(error));
    }
    setComposerMenu(null);
  };
  const addComposerFiles = async (files: File[]) => {
    if (!api || files.length === 0) return;
    try {
      const attachments = await Promise.all(
        files.slice(0, 8).map(async (file) => api.saveComposerClipboardFile({
          name: file.name || `attachment-${Date.now()}`,
          mimeType: file.type || "application/octet-stream",
          data: await file.arrayBuffer()
        }))
      );
      const added = attachComposerAttachmentsAtCursor(attachments, COMPOSER_FOCUS_ATTACHMENT_LIMIT);
      if (added > 0) setChatStatus(`已在光标处添加 ${added} 个资料`);
    } catch (error) {
      setErrorMessage(normalizeComposerAttachmentError(error));
    }
  };
  const attachComposerAttachmentsAtCursor = (files: any[], limit = COMPOSER_FOCUS_ATTACHMENT_LIMIT) => {
    const incoming = Array.isArray(files) ? files.filter((file) => file && typeof file.path === "string" && file.path.trim()) : [];
    if (!incoming.length) return 0;
    const current = Array.isArray(composerImages) ? composerImages : [];
    const next = [...current];
    const added: any[] = [];
    for (const file of incoming) {
      if (next.length >= limit) break;
      if (next.some((item) => item.path === file.path)) continue;
      next.push(file);
      added.push(file);
    }
    if (!added.length) return 0;
    setComposerImages(next);
    const draftText = composerTextareaRef.current?.getValue() ?? question;
    const caret = composerTextareaRef.current?.getSelectionStart() ?? draftText.length;
    const inserted = insertComposerAttachmentTokens(
      draftText,
      caret,
      added.map((file) => String(file.name || file.path.split(/[\\/]/).pop() || "附件"))
    );
    composerTextareaRef.current?.setValue(inserted.next, inserted.cursor);
    setQuestion(inserted.next);
    setComposerLayoutDraft(inserted.next);
    window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
    return added.length;
  };
  const removeComposerAttachment = (image: any) => {
    const path = String(image?.path || "");
    const name = String(image?.name || path.split(/[\\/]/).pop() || "附件");
    setComposerImages((current: any[]) => current.filter((item) => item.path !== path));
    const draftText = composerTextareaRef.current?.getValue() ?? question;
    const next = removeComposerAttachmentToken(draftText, name);
    if (next !== draftText) {
      const caret = Math.min(composerTextareaRef.current?.getSelectionStart() ?? next.length, next.length);
      composerTextareaRef.current?.setValue(next, caret);
      setQuestion(next);
      setComposerLayoutDraft(next);
    }
  };
  const getAttachmentKind = (file: any) => {
    const name = String(file?.name || "");
    const mimeType = String(file?.mimeType || file?.type || "").toLowerCase();
    const extension = (name.match(/\.([^.]+)$/)?.[1] || "").toLowerCase();
    if (/^(png|jpe?g|webp|gif|bmp|svg)$/i.test(extension) || mimeType.startsWith("image/")) return { label: "IMG", icon: "▧", tone: "image" };
    if (extension === "pdf" || mimeType.includes("pdf")) return { label: "PDF", icon: "PDF", tone: "pdf" };
    if (/^(ppt|pptx|key)$/i.test(extension) || mimeType.includes("presentation")) return { label: "PPT", icon: "PPT", tone: "slides" };
    if (/^(doc|docx|rtf)$/i.test(extension) || mimeType.includes("word")) return { label: "DOC", icon: "DOC", tone: "document" };
    if (/^(xls|xlsx|csv|tsv)$/i.test(extension) || mimeType.includes("spreadsheet") || mimeType.includes("csv")) return { label: extension === "csv" ? "CSV" : "XLS", icon: "XLS", tone: "sheet" };
    if (extension === "json" || mimeType.includes("json")) return { label: "JSON", icon: "{}", tone: "code" };
    if (/^(js|jsx|ts|tsx|mjs|cjs|css|html|xml|yaml|yml|toml|md|py|java|go|rs|cpp|c|h|cs|php|rb|sh|ps1)$/i.test(extension)) return { label: extension.toUpperCase(), icon: "</>", tone: "code" };
    if (/^(log|txt)$/i.test(extension) || mimeType.startsWith("text/")) return { label: extension === "log" ? "LOG" : "TXT", icon: "▤", tone: "text" };
    if (/^(zip|rar|7z|tar|gz)$/i.test(extension)) return { label: extension.toUpperCase(), icon: "ZIP", tone: "archive" };
    return { label: extension ? extension.toUpperCase().slice(0, 4) : "FILE", icon: "□", tone: "file" };
  };

  useEffect(() => {
    const preventFileDropNavigation = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
      event.preventDefault();
    };
    window.addEventListener("dragover", preventFileDropNavigation);
    window.addEventListener("drop", preventFileDropNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileDropNavigation);
      window.removeEventListener("drop", preventFileDropNavigation);
    };
  }, []);

  const normalizeShortcutKey = (key: string) => {
    const normalized = key.trim().toLowerCase();
    if (normalized === " ") return "space";
    if (normalized === "esc") return "escape";
    if (normalized === "arrowleft" || normalized === "left") return "arrowleft";
    if (normalized === "arrowright" || normalized === "right") return "arrowright";
    if (normalized === "arrowup" || normalized === "up") return "arrowup";
    if (normalized === "arrowdown" || normalized === "down") return "arrowdown";
    return normalized;
  };

  const shortcutMatchesEvent = (shortcut: string, event: KeyboardEvent) => {
    const parts = shortcut.split("+").map((part) => normalizeShortcutKey(part)).filter(Boolean);
    if (!parts.length) return false;
    const keyPart = parts.find((part) => !["ctrl", "control", "alt", "shift", "meta", "cmd", "command"].includes(part));
    if (!keyPart) return false;
    const eventKey = normalizeShortcutKey(event.key);
    const eventCode = normalizeShortcutKey(event.code.replace(/^Key/i, "").replace(/^Digit/i, ""));
    const keyMatches = keyPart === eventKey || keyPart === eventCode || (keyPart === "space" && event.code === "Space");
    if (!keyMatches) return false;
    const wantsCtrl = parts.includes("ctrl") || parts.includes("control");
    const wantsAlt = parts.includes("alt");
    const wantsShift = parts.includes("shift");
    const wantsMeta = parts.includes("meta") || parts.includes("cmd") || parts.includes("command");
    return event.ctrlKey === wantsCtrl && event.altKey === wantsAlt && event.shiftKey === wantsShift && event.metaKey === wantsMeta;
  };

  const ensureMicrophonePermission = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return true;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch {
      setChatStatus("无法访问麦克风，请在系统或浏览器权限中允许 NewBrain 使用麦克风。");
      return false;
    }
  };

  const stopVoiceInput = () => {
    const recognition = voiceRecognitionRef.current;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      setIsListening(false);
      voiceRecognitionRef.current = null;
    }
  };

  const startVoiceInput = async () => {
    if (voiceRecognitionRef.current || isListening) {
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setChatStatus("当前运行环境不支持系统语音识别。");
      return;
    }
    const microphoneAllowed = await ensureMicrophonePermission();
    if (!microphoneAllowed) return;
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = false;
    const initialText = question.trim();
    voiceRecognitionRef.current = recognition;
    recognition.onstart = () => {
      setIsListening(true);
      setChatStatus("正在听写...");
    };
    recognition.onend = () => {
      setIsListening(false);
      voiceRecognitionRef.current = null;
    };
    recognition.onerror = (event: any) => {
      setIsListening(false);
      voiceRecognitionRef.current = null;
      const reason = String(event?.error || "");
      if (reason === "network" || reason === "service-not-allowed" || reason === "language-not-supported") {
        markVoiceBackendUnavailable();
        setChatStatus("当前运行环境不提供语音识别服务，已隐藏听写入口。");
        return;
      }
      setChatStatus("听写已停止，未能获取语音输入。");
    };
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results).map((result: any) => result[0]?.transcript || "").join("");
      setQuestion(`${initialText}${initialText && transcript ? " " : ""}${transcript}`);
    };
    try {
      recognition.start();
    } catch {
      voiceRecognitionRef.current = null;
      setIsListening(false);
      markVoiceBackendUnavailable();
      setChatStatus("当前运行环境不提供语音识别服务，已隐藏听写入口。");
    }
  };

  const toggleVoiceInput = () => {
    if (voiceRecognitionRef.current || isListening) {
      stopVoiceInput();
      return;
    }
    void startVoiceInput();
  };

  useEffect(() => {
    const element = activityScrollRef.current;
    if (!element) return;
    // Activity updates must never take control away from a user who is
    // inspecting an earlier part of the conversation. Follow the live tail
    // only while this thread is actively generating and the main conversation
    // scroller is still pinned to the bottom.
    if (!isAskingModel || !stickToBottomRef.current) return;
    const targetTop = Math.max(0, element.scrollHeight - element.clientHeight);
    if (Math.abs(element.scrollTop - targetTop) <= 1) return;
    element.scrollTo({ top: targetTop, behavior: "auto" });
  }, [visibleAssistantActivities.length, isAskingModel]);

  useEffect(() => {
    if (!voiceInputAvailable || !api?.onDictationCommand) return;
    return api.onDictationCommand((command: { action: "start" | "toggle"; source: "hold" | "toggle" }) => {
      if (command.action === "toggle") {
        toggleVoiceInput();
        return;
      }
      holdDictationActiveRef.current = command.source === "hold";
      void startVoiceInput();
    });
  }, [api, isListening, question]);

  useEffect(() => {
    if (!voiceInputAvailable) return;
    const holdShortcut = desktopPreferences?.dictation?.holdShortcut || "";
    if (!holdShortcut) return;
    const onKeyUp = (event: KeyboardEvent) => {
      if (!holdDictationActiveRef.current) return;
      if (!shortcutMatchesEvent(holdShortcut, event)) return;
      holdDictationActiveRef.current = false;
      stopVoiceInput();
    };
    const onBlur = () => {
      if (!holdDictationActiveRef.current) return;
      holdDictationActiveRef.current = false;
      stopVoiceInput();
    };
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [desktopPreferences?.dictation?.holdShortcut]);

  useEffect(() => {
    if (!api?.getBillingSubscription) return;
    let disposed = false;
    const refreshUsageWarning = async () => {
      try {
        const billing = await api.getBillingSubscription();
        const subscriptions = Array.isArray(billing?.subscriptions) ? billing.subscriptions : [];
        const activeSubscription =
          subscriptions.find((item: any) => String(item.status || "").toLowerCase() === "active") ||
          subscriptions[0];
        const dailyQuota = Number(activeSubscription?.daily_quota || 0);
        const dailyUsed = Number(activeSubscription?.daily_used || 0);
        const dailyRemaining = Math.max(0, dailyQuota - dailyUsed);
        setDailyBalance(dailyQuota > 0 ? {
          remaining: dailyRemaining,
          quota: dailyQuota,
          percent: Math.min(100, Math.max(0, dailyRemaining / dailyQuota * 100))
        } : null);
        const candidates = subscriptions.flatMap((item: any) => [
          { scope: "每日", used: Number(item.daily_used || 0), quota: Number(item.daily_quota || 0), reset: item.daily_reset_in_text || item.daily_reset_text || "下个额度周期" },
          { scope: "月度", used: Number(item.monthly_used || 0), quota: Number(item.monthly_quota || 0), reset: item.monthly_reset_in_text || item.monthly_reset_text || "下个额度周期" }
        ])
          .filter((item: any) => {
            if (!Number.isFinite(item.used) || !Number.isFinite(item.quota) || item.quota <= 0) return false;
            const ratio = item.used / item.quota;
            // Money quota warnings must be based on money amounts only. If the used value
            // is orders of magnitude larger than the money quota, it is almost certainly
            // a token count leaking into the money field; do not show it as dollars.
            return ratio >= 0.9 && ratio <= 2;
          })
          .map((item: any) => {
            const usedPercent = Math.max(0, item.used / item.quota * 100);
            return {
              ...item,
              usedPercent,
              remaining: Math.max(0, Math.round(100 - usedPercent)),
              overLimit: usedPercent > 100
            };
          })
          .sort((left: any, right: any) => right.usedPercent - left.usedPercent);
        if (disposed) return;
        const urgent = candidates[0];
        if (!urgent) {
          setQuotaWarning(null);
          return;
        }
        setQuotaWarning({ ...urgent, key: `${urgent.scope}:${urgent.reset}:${urgent.quota}:${urgent.used}` });
      } catch {
        if (!disposed) {
          setQuotaWarning(null);
          setDailyBalance(null);
        }
      }
    };
    void refreshUsageWarning();
    const timer = window.setInterval(() => void refreshUsageWarning(), 300000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [api]);

  useEffect(() => {
    if (!showAddWorkspacePanel) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (addWorkspaceButtonRef.current?.contains(target)) return;
      if (addWorkspaceMenuRef.current?.contains(target)) return;
      setShowAddWorkspacePanel(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowAddWorkspacePanel(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showAddWorkspacePanel, setShowAddWorkspacePanel]);
  const [mobilePairing, setMobilePairing] = useState<any>({
    status: "stopped",
    url: "",
    code: "",
    deviceName: "",
    expiresAt: ""
  });

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchQuery("");
        setSelectedSearchIndex(0);
        setShowSearchDialog(true);
      }
    };
    window.addEventListener("keydown", handleGlobalSearchShortcut);
    return () => window.removeEventListener("keydown", handleGlobalSearchShortcut);
  }, [setSearchQuery, setShowSearchDialog]);

  useEffect(() => {
    if (activeFeature !== "mobile") return;
    // NewBrain 移动版入口已隐藏：旧状态或深链落到 mobile 时回到新对话。
    setActiveFeature("new-chat");
    setSelectedSidebarRow("feature:new-chat");
  }, [activeFeature, setActiveFeature, setSelectedSidebarRow]);

  useEffect(() => {
    if (activeFeature !== "mobile" || !api) return;
    void api.closeBrowserPreview();
    let canceled = false;
    const refresh = () => {
      api.getMobilePairingStatus().then((state: any) => {
        if (!canceled) setMobilePairing(state);
      }).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [activeFeature, api]);
  const defaultExtensions = [
    {
      id: "github",
      name: "GitHub 集成",
      version: "1.2.0",
      enabled: true,
      summary: "连接代码仓库、Issue 和 Pull Request。",
      permissions: ["repo:read", "issues:write"],
      token: "",
      baseUrl: "https://api.github.com",
      project: "NewBrain"
    },
    {
      id: "jira",
      name: "Jira 集成",
      version: "0.9.3",
      enabled: false,
      summary: "读取项目、创建任务并同步处理状态。",
      permissions: ["project:read", "issues:write"],
      token: "",
      baseUrl: "https://your-company.atlassian.net",
      project: "NEWBRAIN"
    },
    {
      id: "slack",
      name: "Slack 通知",
      version: "1.0.1",
      enabled: true,
      summary: "将任务结果和审批提醒发送到团队频道。",
      permissions: ["channels:read", "chat:write"],
      token: "",
      baseUrl: "https://slack.com/api",
      project: "#newbrain"
    }
  ];
  const [extensions, setExtensions] = useState(() =>
    defaultExtensions.map((extension) => ({ ...extension, enabled: false }))
  );
  const [selectedExtensionId, setSelectedExtensionId] = useState("github");
  const [extensionNotice, setExtensionNotice] = useState("");
  const selectedExtension = extensions.find((extension: any) => extension.id === selectedExtensionId) ?? extensions[0];

  function persistExtensions(nextExtensions: any[], notice: string) {
    setExtensions(nextExtensions);
    setExtensionNotice(`${notice}（仅当前预览会话；尚未连接真实集成服务）`);
  }

  function updateSelectedExtension(patch: Record<string, unknown>, persist = false) {
    if (!selectedExtension) return;
    const nextExtensions = extensions.map((extension: any) =>
      extension.id === selectedExtension.id ? { ...extension, ...patch } : extension
    );
    if (persist) {
      persistExtensions(nextExtensions, "扩展配置已保存");
    } else {
      setExtensions(nextExtensions);
      setExtensionNotice("");
    }
  }

  function installExtension() {
    setExtensionNotice("扩展连接目前仅供界面预览，尚未接入安全凭据存储与服务端 API，未执行安装。");
  }
  const recentProjectThreads = visibleWorkspaceCatalog
    .flatMap((workspace: any) =>
      sortThreadsForMenu((workspace.threads ?? []).filter((thread: any) => thread.scope !== "chat" && isUserVisibleThread(thread)))
        .map((thread: any) => ({ workspace, thread }))
    )
    .slice(0, 9);
  const sceneVisibleWorkspaceCatalog = filterWorkspaceCatalogByScene(visibleWorkspaceCatalog, selectedBrainWorkspaceKey);
  const sceneWorkspaceCatalog = filterWorkspaceCatalogByScene(normalizeWorkspaceCatalog(workspaceCatalog), selectedBrainWorkspaceKey);
  // 「聊天」= scene-bound conversation threads (INTERNAL_CHAT + chat-scope on scene projects).
  // Distinct from 「项目」 threads; do not list via scene-filtered catalog alone (INTERNAL_CHAT has no scene key).
  const standaloneChats = sceneChatWorkspaces(normalizeWorkspaceCatalog(workspaceCatalog), selectedBrainWorkspaceKey)
    .flatMap((workspace: any) =>
      sortThreadsForMenu(workspace.threads ?? [])
        .map((thread: any) => ({ workspace, thread }))
    );
  const allSidebarTasks = sceneWorkspaceCatalog.flatMap((workspace: any) =>
    sortThreadsForMenu((workspace.threads ?? []).filter((thread: any) => isUserVisibleThread(thread))).map((thread: any) => ({ workspace, thread }))
  );
  const sortSidebarEntries = (entries: any[]) => {
    const sortedThreads = sortCodexSidebarThreads(entries.map((entry) => entry.thread), sidebarSortMode, pinnedThreadIds, unreadThreadIds);
    const entryByThread = new Map(entries.map((entry) => [entry.thread, entry]));
    return sortedThreads.flatMap((thread) => entryByThread.get(thread) ? [entryByThread.get(thread)] : []);
  };
  const sidebarTaskEntries = sortSidebarEntries(sidebarOrganizeMode === "list" ? allSidebarTasks : standaloneChats);
  const visibleSidebarTaskEntries = sidebarTasksExpanded ? sidebarTaskEntries : sidebarTaskEntries.slice(0, 8);
  const orderedSidebarProjects = orderSidebarProjects(sceneVisibleWorkspaceCatalog, pinnedWorkspaceIds);
  const visibleSidebarProjects = sidebarProjectsExpanded ? orderedSidebarProjects : orderedSidebarProjects.slice(0, 5);
  const selectedProjectWorkspace = sceneVisibleWorkspaceCatalog.find((workspace: any) => workspace.id === selectedWorkspace?.id)
    || visibleWorkspaceCatalog.find((workspace: any) => workspace.id === selectedWorkspace?.id);
  const isNewChatMode = activeFeature === "new-chat" && isComposingNewThread;
  const isStandaloneChatDraft = newThreadScope === "chat";
  const newChatTitle = isStandaloneChatDraft
    ? "我们该聊什么？"
    : `我们该在 ${selectedProjectWorkspace?.name ?? "workspace"} 中做什么？`;
  const selectedThreadKey = selectedWorkspace && selectedThread ? `${selectedWorkspace.id}:${selectedThread.id}` : "";
  const activeSessionStatus = snapshot?.session?.status ?? "idle";
  const selectedThreadAwaitingApproval = selectedThread?.status === "awaiting-approval";
  // Snapshot approval is process-global; only the owning thread may claim it.
  const selectedThreadOwnsLiveApproval = resolveSelectedThreadOwnsLiveApproval({
    selectedThreadId: selectedThread?.id,
    activeThreadRequestIds: activeThreadRequestIds || {},
    selectedThreadAwaitingApproval
  });
  const pendingApprovalThreadKey = resolvePendingApprovalThreadKey({
    workspaceId: selectedWorkspace?.id,
    threadId: selectedThread?.id,
    snapshotHasApproval: Boolean(snapshot?.approval),
    selectedThreadOwnsLiveApproval
  });
  const [delegatedAgents, setDelegatedAgents] = useState<any[]>([]);
  const [delegatedAgentAction, setDelegatedAgentAction] = useState("");
  const [delegatedAgentDetailsOpen, setDelegatedAgentDetailsOpen] = useState(false);
  const refreshDelegatedAgents = async () => {
    if (!api?.listDelegatedAgents || !selectedWorkspace?.id || !selectedThread?.id) {
      setDelegatedAgents([]);
      return;
    }
    try {
      setDelegatedAgents(await api.listDelegatedAgents({
        workspaceId: selectedWorkspace.id,
        parentThreadId: selectedThread.id
      }));
    } catch {
      setDelegatedAgents([]);
    }
  };
  useEffect(() => {
    void refreshDelegatedAgents();
    if (!selectedWorkspace?.id || !selectedThread?.id) return;
    const timer = window.setInterval(() => void refreshDelegatedAgents(), 2000);
    return () => window.clearInterval(timer);
  }, [selectedWorkspace?.id, selectedThread?.id]);
  useEffect(() => setDelegatedAgentDetailsOpen(false), [selectedThreadKey]);
  useEffect(() => setSettledApprovalId(""), [selectedThread?.id]);
  const delegatedAgentSummary = summarizeDelegatedAgents(delegatedAgents);
  const completedDelegatedAgentCount = delegatedAgentSummary.completed;
  const awaitingDelegatedAgentCount = delegatedAgentSummary.awaiting;
  const failedDelegatedAgentCount = delegatedAgentSummary.failed;
  const showDelegatedAgentStrip = delegatedAgentSummary.visible;
  useEffect(() => {
    if (!showDelegatedAgentStrip) setDelegatedAgentDetailsOpen(false);
  }, [showDelegatedAgentStrip]);
  const handleDelegatedAgentApproval = async (childThreadId: string, approved: boolean) => {
    if (!api?.respondDelegatedAgentApproval || !selectedWorkspace?.id) return;
    setDelegatedAgentAction(childThreadId);
    try {
      const result = await respondToDelegatedAgentApproval({
        respond: () => api.respondDelegatedAgentApproval({
          workspaceId: selectedWorkspace.id,
          childThreadId,
          approved
        }),
        refresh: refreshDelegatedAgents
      });
      if (result.error) setErrorMessage(result.error instanceof Error ? result.error.message : String(result.error));
      else if (!result.ok && result.stale) setErrorMessage("子 Agent 已不再等待审批，界面已刷新。");
    } finally {
      setDelegatedAgentAction("");
    }
  };
  const selectedThreadHasLiveRequest = Boolean(
    selectedThread?.id && (activeThreadRequestIds || {})[selectedThread.id]
  );
  const effectiveApproval = resolveEffectiveApproval({
    snapshotApproval: selectedThreadOwnsLiveApproval ? (snapshot?.approval || null) : null,
    selectedThreadOwnsLiveApproval,
    selectedThreadHasLiveRequest,
    // While respondApproval is in flight we already cleared the card; ignore sticky
    // catalog/live "等待批准" rows until the IPC call finishes — unless the returned
    // snapshot already carries the next approval (handled after respond resolves).
    selectedThreadAwaitingApproval: approvalResponding
      ? Boolean(selectedThreadOwnsLiveApproval && snapshot?.approval)
      : selectedThreadAwaitingApproval,
    selectedThreadMessage: selectedThread?.lastEventSummary || selectedThread?.statusLabel || "",
    liveActivities: approvalResponding && !snapshot?.approval ? [] : visibleAssistantActivities,
    approvalDecisionPending: approvalResponding && !snapshot?.approval,
    settledApprovalId
  });
  const approvalTool = (selectedThreadOwnsLiveApproval ? snapshot?.pendingTool : null) || (() => {
    const liveApproval = findLivePendingApprovalActivity(visibleAssistantActivities);
    if (!liveApproval) return null;
    return {
      kind: liveApproval.toolName || "command",
      reason: liveApproval.detail || "需要确认后继续执行",
      risk: "medium",
      command: liveApproval.command || liveApproval.detail || "",
      ruleId: "",
      policySource: ""
    };
  })();
  const approvalCommand = approvalTool?.command || "";
  const [approvalCommandExpanded, setApprovalCommandExpanded] = useState(false);
  useEffect(() => setApprovalCommandExpanded(false), [snapshot?.approval?.id, approvalCommand]);
  const approvalUx = buildApprovalUx({
    toolName: approvalTool?.name || approvalTool?.kind,
    command: approvalCommand,
    risk: approvalTool?.risk,
    reason: approvalTool?.reason || effectiveApproval?.message,
    ruleId: approvalTool?.ruleId,
    policySource: approvalTool?.policySource,
    permissionMode: composerPermission
  });
  const approvalRiskLabel = approvalUx.riskLabel;
  const approvalScopeLabel = approvalUx.scopeLabel;
  const handleApprovalResponse = async (approved: boolean) => {
    if (!api) return;
    setApprovalResponding(true);
    setApprovalError("");
    const decidedApprovalId = snapshot?.approval?.id || "pending";
    setSettledApprovalId(decidedApprovalId);
    const requestId = selectedThread?.id ? activeThreadRequestIds[selectedThread.id] || "" : "";
    // Clear the approval card immediately on click. respondApproval waits for the
    // resumed tool/agent loop, which previously left the Approve/Reject banner stuck.
    if (selectedThread?.id && typeof syncSnapshot === "function" && snapshot) {
      syncSnapshot({ ...snapshot, approval: null, pendingTool: null }, selectedThread.id);
    } else if (snapshot) {
      setSnapshot({ ...snapshot, approval: null, pendingTool: null });
    }
    if (typeof settleLiveApprovalActivities === "function") {
      settleLiveApprovalActivities(requestId, approved);
    }
    if (selectedWorkspace?.id && selectedThread?.id) {
      setWorkspaceCatalog((current: any) => markThreadApprovalSettlingInCatalog(
        current,
        selectedWorkspace.id,
        selectedThread.id,
        approved
      ));
    }
    try {
      const approvalId = decidedApprovalId === "pending" ? "" : decidedApprovalId;
      const nextSnapshot = await api.respondApproval({
        approved,
        ...(composerPermission === "full" ? { permissionMode: "full" as const } : {}),
        ...(requestId ? { requestId } : {}),
        ...(approvalId ? { approvalId } : {})
      });
      if (selectedThread?.id && typeof syncSnapshot === "function") {
        syncSnapshot(nextSnapshot, selectedThread.id);
      } else {
        setSnapshot(nextSnapshot);
      }
      const returnedApprovalId = nextSnapshot?.approval?.id || "";
      if (returnedApprovalId && returnedApprovalId === decidedApprovalId) {
        setSettledApprovalId("");
      } else if (returnedApprovalId && returnedApprovalId !== decidedApprovalId) {
        setSettledApprovalId("");
      }
      if (typeof settleApprovalRequest === "function") {
        settleApprovalRequest(requestId, selectedThread?.id || "", nextSnapshot);
      }
      const nextCatalog = normalizeWorkspaceCatalog(await api.listWorkspaces());
      setWorkspaceCatalog(nextCatalog);
      if (selectedWorkspace?.id && selectedThread?.id) {
        setIsComposingNewThread(false);
        // Avoid setSelectedThreadId(same id): that re-activates and used to hard-replace
        // chat messages, wiping the in-flight assistant turn after approve/error.
        if (selectedWorkspaceId !== selectedWorkspace.id) setSelectedWorkspaceId(selectedWorkspace.id);
        if (selectedThreadId !== selectedThread.id) setSelectedThreadId(selectedThread.id);
        // Approval persistence and task cleanup happen in the main process before
        // respondApproval resolves. Re-activate the thread so stale
        // `awaiting-approval` metadata cannot overwrite the canonical snapshot.
        const settledSnapshot = await api.activateWorkspaceThread({
          workspaceId: selectedWorkspace.id,
          threadId: selectedThread.id
        });
        if (typeof syncSnapshot === "function") syncSnapshot(settledSnapshot, selectedThread.id);
        // activateWorkspaceThread can return a snapshot whose session.status is still
        // dirty; settle again from the authoritative post-activate snapshot.
        if (typeof settleApprovalRequest === "function") {
          settleApprovalRequest(requestId, selectedThread.id, settledSnapshot);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSettledApprovalId("");
      setApprovalError(message);
      setErrorMessage(message);
      // Terminal resume failures must clear the live request, or the composer stays
      // stuck on「处理中」even after the agent loop has already ended.
      if (typeof settleApprovalRequest === "function") {
        settleApprovalRequest(requestId, selectedThread?.id || "", { approval: null, pendingTool: null } as any);
      }
      // Keep a visible failure bubble when resume throws after the card was cleared.
      if (selectedThread?.id) {
        const failureText = `本轮执行失败：${message}`;
        updateThreadMessages?.(selectedThread.id, (current: any[]) => {
          const messages = Array.isArray(current) ? [...current] : [];
          const assistantIndex = [...messages].reverse().findIndex((item) => item?.role === "assistant");
          if (assistantIndex >= 0) {
            const index = messages.length - 1 - assistantIndex;
            const existing = messages[index];
            const existingAnswer = stripApprovalWaitNotice(existing.content);
            messages[index] = {
              ...existing,
              content: existingAnswer || failureText,
              reasoningSummary: existing.reasoningSummary?.trim()
                ? `${existing.reasoningSummary.trim()}\n\n本轮在完成前发生异常：${message}`
                : `本轮在完成前发生异常：${message}`,
              excludeFromModelContext: true
            };
            return messages;
          }
          return [...messages, {
            id: `local-assistant-approval-failure-${Date.now()}`,
            role: "assistant",
            content: failureText,
            reasoningSummary: `本轮在完成前发生异常：${message}`,
            excludeFromModelContext: true,
            createdAt: new Date().toISOString()
          }];
        });
      }
      try {
        const nextCatalog = await api.listWorkspaces();
        setWorkspaceCatalog(nextCatalog);
      } catch {
        // Keep the visible approval error if catalog refresh fails too.
      }
    } finally {
      setApprovalResponding(false);
    }
  };
  const previousComposerPermissionRef = useRef(composerPermission);
  useEffect(() => {
    const previous = previousComposerPermissionRef.current;
    previousComposerPermissionRef.current = composerPermission;
    if (composerPermission !== "full" || previous === "full") return;
    const requestId = selectedThread?.id ? activeThreadRequestIds?.[selectedThread.id] || "" : "";
    if (!requestId || typeof api?.applyLivePermissionMode !== "function") return;
    void api.applyLivePermissionMode({ requestId, permissionMode: "full" }).catch(() => undefined);
  }, [composerPermission, selectedThread?.id, activeThreadRequestIds, api]);
  useEffect(() => {
    if (composerPermission !== "full" || approvalResponding || !effectiveApproval) return;
    if (!selectedThreadOwnsLiveApproval && !selectedThreadHasLiveRequest) return;
    const approvalId = String((selectedThreadOwnsLiveApproval && snapshot?.approval?.id) || "");
    const key = `${selectedThread?.id || ""}:${approvalId || approvalCommand || "live"}`;
    if (releasedFullAccessApprovalIds.has(key)) return;
    releasedFullAccessApprovalIds.add(key);
    void handleApprovalResponse(true);
  }, [composerPermission, approvalResponding, effectiveApproval, selectedThreadOwnsLiveApproval, selectedThreadHasLiveRequest, snapshot?.approval?.id, approvalCommand, selectedThread?.id]);
  const runningThreadKey =
    isAskingModel || activeSessionStatus === "running" || snapshot?.runs?.some((run: any) => run.status === "running")
      ? selectedThreadKey
      : "";
  const runningTaskKeys = new Set<string>();
  const activeThreadIdSet = new Set(activeThreadIds);
  for (const workspace of visibleWorkspaceCatalog) {
    for (const thread of workspace.threads) {
      if (!isUserVisibleThread(thread)) continue;
      if (thread.status === "running" || activeThreadIdSet.has(thread.id)) runningTaskKeys.add(`${workspace.id}:${thread.id}`);
    }
  }
  if (runningThreadKey) runningTaskKeys.add(runningThreadKey);
  for (const automation of featureConfig.automations ?? []) {
    if (automation.status !== "running") continue;
    const automationThreadKey =
      automation.workspaceId && automation.threadId
        ? `${automation.workspaceId}:${automation.threadId}`
        : "";
    if (!automationThreadKey || !runningTaskKeys.has(automationThreadKey)) {
      runningTaskKeys.add(`automation:${automation.id}`);
    }
  }
  const runningTaskCount = runningTaskKeys.size;
  const runningAutomationCount = (featureConfig.automations ?? []).filter(
    (automation: any) => automation.status === "running"
  ).length;
  const threadStateCountsByWorkspace = new Map<string, number>();

  const openNewChatProjectMenu = (menu: "workspace" | "local" | "branch") => {
    setNewChatProjectMenu((current) => current === menu ? null : menu);
  };

  const openIntegrationSettings = () => {
    setActiveSettingsSection("mcp");
    setActiveFeature("settings");
  };

  useEffect(() => {
    if (!newChatProjectMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && newChatProjectRowRef.current?.contains(target)) return;
      setNewChatProjectMenu(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [newChatProjectMenu]);

  useEffect(() => {
    if (customModelsLoadedRef.current || !api?.listCustomModelEndpoints) return;
    customModelsLoadedRef.current = true;
    let cancelled = false;
    void api.listCustomModelEndpoints().then((snapshot: any) => {
      if (cancelled || !snapshot) return;
      setCustomModelEndpoints(Array.isArray(snapshot.endpoints) ? snapshot.endpoints : []);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => {
    if (!composerMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".composer-picker-menu, .composer-custom-model-card")) return;
      if (target instanceof Node && reasoningPickerWrapRef.current?.contains(target)) return;
      setComposerMenu(null);
      setReasoningSubmenu(null);
      setCustomModelFormOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setComposerMenu(null);
      setReasoningSubmenu(null);
      setCustomModelFormOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [composerMenu]);

  useEffect(() => {
    if (composerMenu !== "reasoning") {
      setReasoningMenuPosition(null);
      return;
    }
    const syncPosition = () => {
      const anchor = reasoningPickerWrapRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const modelRows = reasoningSubmenu === "model" ? composerModelOptions.length + customModelEndpoints.length + 1 : 0;
      const estimatedHeight = Math.min(
        640,
        200
          + Math.min(modelRows, 12) * 28
          + (reasoningSubmenu === "speed" ? 96 : 0)
          + (reasoningSubmenu === "optimize" ? 120 : 0)
          + (reasoningSubmenu === "model" ? 48 : 0)
          + (customModelFormOpen ? 230 : 0)
      );
      setReasoningMenuPosition(positionComposerPickerMenu(anchor, {
        preferBelow: isNewChatMode,
        estimatedHeight,
        menuWidth: customModelFormOpen ? 280 : 214,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      }));
    };
    syncPosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [composerMenu, composerModelOptions.length, customModelEndpoints.length, customModelFormOpen, isNewChatMode, reasoningSubmenu]);

  for (const workspace of visibleWorkspaceCatalog) {
    const count = workspace.threads.filter((thread: any) => {
      if (!isUserVisibleThread(thread)) return false;
      const key = `${workspace.id}:${thread.id}`;
      return thread.status === "running" || key === runningThreadKey || activeThreadIdSet.has(thread.id);
    }).length;
    if (count > 0) {
      threadStateCountsByWorkspace.set(workspace.id, count);
    }
  }
  const taskTitle = isNewChatMode ? (newThreadScope === "project" ? "新建项目对话" : "新建聊天") : title;

function startNewChat() {
    setSelectedSidebarRow("feature:new-chat");
    setErrorMessage?.("");
    resetFeatureDraft?.("skills");
    resetFeatureDraft?.("plugins");
    resetFeatureDraft?.("automations");
    setSearchFilePreview(null);
    setActiveFeature("new-chat");
    // Match NewBrain: sidebar chat "+" / 新对话 = standalone chat (INTERNAL_CHAT).
    // Project-scoped drafts use the per-project "新建线程" control instead.
    setNewThreadScope("chat");
    setChatUsesProject?.(false);
    setIsComposingNewThread(true);
    setSelectedThreadId("");
    setQuestion("");
    setSelectedComposerSkill(null);
    setComposerSkillContext("");
    setSelectedComposerTools([]);
    setComposerModes([]);
    setPreviewMode("empty");
    setPreviewPlacement("hidden");
  }

  function renderSidebarTaskEntry({ workspace, thread }: any) {
    const threadKey = `${workspace.id}:${thread.id}`;
    const active = selectedWorkspace?.id === workspace.id && selectedThread?.id === thread.id && !isComposingNewThread;
    const needsApproval = threadStillNeedsApproval({
      threadStatus: thread.status,
      threadKey,
      pendingApprovalThreadKey,
      threadId: thread.id,
      settledApprovalId,
      settledThreadId: selectedThread?.id,
      snapshotApprovalId: snapshot?.approval?.id
    });
    const running = (thread.status === "running" || threadKey === runningThreadKey || activeThreadIdSet.has(thread.id)) && !needsApproval;
    const failed = thread.status === "failed" && !needsApproval && !running;
    return (
      <button
        key={threadKey}
        type="button"
        data-testid="sidebar-task-row"
        data-thread-key={threadKey}
        className={`thread-row sidebar-chat-row${active ? " active" : ""}${pinnedThreadIds.has(thread.id) ? " pinned" : ""}${unreadThreadIds.has(thread.id) ? " unread" : ""}`}
        onClick={() => {
          setSelectedSidebarRow(`chat:${workspace.id}:${thread.id}`);
          setSearchFilePreview(null);
          setIsComposingNewThread(false);
          if (selectWorkspaceThread) {
            selectWorkspaceThread(workspace.id, thread.id, { force: true });
          } else {
            setSelectedWorkspaceId(workspace.id);
            setSelectedThreadId(thread.id);
          }
          setUnreadThreadIds((current) => {
            const next = new Set(current);
            next.delete(thread.id);
            return next;
          });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setSelectedWorkspaceId(workspace.id);
          setSelectedThreadId(thread.id);
          setThreadContextMenu({ x: event.clientX, y: event.clientY, workspace, thread });
        }}
      >
        <span className="thread-pin">{pinnedThreadIds.has(thread.id) ? <SidebarIcon name="pin" /> : ""}</span>
        <span className="thread-title">
          {thread.title}
          {sidebarOrganizeMode === "list" ? <small>{thread.scope === "chat" ? "无项目" : workspace.name}</small> : null}
        </span>
        <span className="thread-status-slot">
          {needsApproval ? <em className="thread-approval-badge">{thread.statusLabel || "等待批准"}</em> : null}
          {running ? <i className="thread-running-dot" aria-label="运行中" /> : null}
          {failed ? <em className="thread-failed-badge">{thread.statusLabel || "失败"}</em> : null}
        </span>
        <time>{formatRelativeTimeLabel(thread.updatedAt)}</time>
        <span className="thread-hover-actions">
          <span role="button" tabIndex={0} title={pinnedThreadIds.has(thread.id) ? "取消置顶任务" : "置顶任务"} onClick={(event) => { event.stopPropagation(); void handleThreadMenuAction("pin", workspace, thread); }}><SidebarIcon name="pin" /></span>
          <span role="button" tabIndex={0} title="归档任务" onClick={(event) => { event.stopPropagation(); void handleThreadMenuAction("archive", workspace, thread); }}><SidebarIcon name="archive" /></span>
        </span>
      </button>
    );
  }

function renderSidebarModule() {
    return (
      <aside className="codex-sidebar">
        <div className="sidebar-scroll">
          <div className="sidebar-top-zone">
            <div className="brain-workspace-switcher" ref={brainWorkspaceMenuRef}>
              <button
                className="brain-workspace-trigger"
                type="button"
                aria-haspopup="menu"
                aria-expanded={brainWorkspaceMenuOpen}
                onClick={() => setBrainWorkspaceMenuOpen((current) => !current)}
              >
                <span className="brain-workspace-trigger-icon"><SidebarIcon name={brainWorkspaceIcon(selectedBrainWorkspace?.workspaceKey)} /></span>
                <strong>{selectedBrainWorkspace?.displayName || "软件与自动化"}</strong>
                <span className="brain-workspace-chevron"><SidebarIcon name="chevron-down" /></span>
              </button>
              {brainWorkspaceMenuOpen ? (
                <div className="brain-workspace-menu" role="menu" aria-label="切换工作台">
                  <div className="brain-workspace-menu-title">工作台</div>
                  {visibleBrainWorkspaces.map((workspace) => (
                    <button
                      key={workspace.workspaceKey}
                      type="button"
                      role="menuitemradio"
                      aria-checked={workspace.workspaceKey === selectedBrainWorkspaceKey}
                      className={workspace.workspaceKey === selectedBrainWorkspaceKey ? "active" : ""}
                      onClick={() => {
                        switchBrainWorkspace(workspace.workspaceKey);
                        setBrainWorkspaceMenuOpen(false);
                      }}
                    >
                      <span><SidebarIcon name={brainWorkspaceIcon(workspace.workspaceKey)} /></span>
                      <span className="brain-workspace-menu-copy"><strong>{workspace.displayName}</strong></span>
                      <em>{workspace.workspaceKey === selectedBrainWorkspaceKey ? "✓" : ""}</em>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <nav className="feature-nav">
              {featureItems.filter((item: any) => item.id === "new-chat").map((item: any) => (
                <button
                  key={item.id}
                  className={`feature-nav-item secondary${selectedSidebarRow === `feature:${item.id}` ? " active" : ""}`}
                  type="button"
                  data-testid="new-chat-button"
                  onClick={startNewChat}
                >
                  <span><SidebarIcon name="new-chat" /></span>
                  <strong>新对话</strong>
                </button>
              ))}
              <button
                className="feature-nav-item secondary global-search-entry"
                type="button"
                onClick={() => {
                  setSelectedSidebarRow("feature:search");
                  setSearchQuery("");
                  setSelectedSearchIndex(0);
                  setShowSearchDialog(true);
                }}
              >
                <span><SidebarIcon name="search" /></span>
                <strong>搜索</strong>
              </button>
              <div className="feature-nav-secondary">
                {featureItems.filter((item: any) => item.id !== "new-chat" && item.id !== "extensions" && item.id !== "mobile").map((item: any) => (
                  <button
                    key={item.id}
                    className={`feature-nav-item secondary${selectedSidebarRow === `feature:${item.id}` ? " active" : ""}`}
                    type="button"
                    onClick={() => {
                      setSelectedSidebarRow(`feature:${item.id}`);
                      setActiveFeature(item.id);
                    }}
                  >
                    <span><SidebarIcon name={item.id} /></span>
                    <strong>{item.label}</strong>
                    {item.id === "automation" && runningAutomationCount > 0 ? (
                      <em className="feature-nav-count" aria-label={`当前有 ${runningTaskCount} 个任务正在运行`}>
                        {runningAutomationCount}
                      </em>
                    ) : null}
                  </button>
                ))}
              </div>
            </nav>
            {showsFeaturePanel ? (
              <section className="left-section feature-mode-panel">
                <div className="section-title">{activeFeatureItem.label}</div>
                <p>{activeFeatureItem.description}</p>
                {renderFeaturePanel()}
              </section>
            ) : null}
          </div>
          <div className="project-chat-scroll">
          <section className={`left-section projects-section organize-${sidebarOrganizeMode}${projectsCollapsed || !sceneVisibleWorkspaceCatalog.length ? " compact-project-chat" : ""}`}>
            <div className="project-subsection-head">
              <button
                className="project-subsection-toggle"
                type="button"
                aria-expanded={!projectsCollapsed}
                onClick={() => {
                  setProjectsCollapsed((current: boolean) => !current);
                  setShowAddWorkspacePanel(false);
                }}
              >
                <span className="project-subsection-label">项目</span>
                <span className={`subsection-chevron${projectsCollapsed ? "" : " expanded"}`}>
                  <SidebarIcon name="chevron-right" />
                </span>
              </button>
              <button
                ref={addWorkspaceButtonRef}
                title="添加项目"
                aria-label="添加项目"
                type="button"
                className={showAddWorkspacePanel ? "active" : ""}
                onClick={() => {
                  setProjectsCollapsed(false);
                  setShowAddWorkspacePanel((current) => !current);
                }}
              >
                +
              </button>
            </div>
            {!projectsCollapsed && showAddWorkspacePanel ? (
              <div ref={addWorkspaceMenuRef} className="project-create-menu">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddWorkspacePanel(false);
                    setBlankProjectName("New project");
                    setBlankProjectDialogOpen(true);
                  }}
                >
                  <SidebarIcon name="folder-plus" />
                  <span>新建空白项目</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddWorkspacePanel(false);
                    void (async () => {
                      const workspaceId = await addExistingProject({ brainWorkspaceKey: selectedBrainWorkspaceKey });
                      if (!workspaceId) return;
                      const projects = await refreshBrainProjects(selectedBrainWorkspaceKey);
                      setSelectedSidebarRow(`project:${workspaceId}`);
                      bindBrainProjectToWorkspace(workspaceId, {
                        composingNewThread: true,
                        projects
                      });
                      setActiveFeature("new-chat");
                      setNewThreadScope("project");
                      setChatUsesProject?.(true);
                      setExpandedWorkspaceIds((current) => new Set([...current, workspaceId]));
                    })();
                  }}
                >
                  <SidebarIcon name="folder-open" />
                  <span>使用现有文件夹</span>
                </button>
              </div>
            ) : null}
            {blankProjectDialogOpen && typeof document !== "undefined"
              ? createPortal(
                  <div
                    className="project-name-dialog-backdrop"
                    role="presentation"
                    onMouseDown={(event) => {
                      if (event.target === event.currentTarget) {
                        setBlankProjectDialogOpen(false);
                      }
                    }}
                  >
                    <form
                      className="project-name-dialog"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const name = blankProjectName.trim();
                        const workspaceId = await createBlankProject(name, {
                          brainWorkspaceKey: selectedBrainWorkspaceKey
                        });
                        if (workspaceId) {
                          setBlankProjectDialogOpen(false);
                          const projects = await refreshBrainProjects(selectedBrainWorkspaceKey);
                          setSelectedSidebarRow(`project:${workspaceId}`);
                          bindBrainProjectToWorkspace(workspaceId, {
                            composingNewThread: true,
                            projects
                          });
                          setActiveFeature("new-chat");
                          setNewThreadScope("project");
                          setChatUsesProject?.(true);
                          setExpandedWorkspaceIds((current) => new Set([...current, workspaceId]));
                        }
                      }}
                    >
                      <div className="project-name-dialog-head">
                        <div>
                          <strong>为项目命名</strong>
                          <span>保持简短且易识别</span>
                        </div>
                        <button type="button" aria-label="关闭" onClick={() => setBlankProjectDialogOpen(false)}>×</button>
                      </div>
                      <input
                        autoFocus
                        value={blankProjectName}
                        onFocus={(event) => {
                          const input = event.currentTarget;
                          window.setTimeout(() => input.select(), 0);
                        }}
                        onChange={(event) => setBlankProjectName(event.target.value)}
                      />
                      <div className="project-name-dialog-actions">
                        <button type="button" onClick={() => setBlankProjectDialogOpen(false)}>取消</button>
                        <button className="primary" type="submit" disabled={!blankProjectName.trim()}>保存</button>
                      </div>
                    </form>
                  </div>,
                  document.body
                )
              : null}
            {!projectsCollapsed ? (
              <div className="project-list">
                {visibleSidebarProjects.map((workspace) => {
                  const expanded = expandedWorkspaceIds.has(workspace.id);
                  const active = selectedWorkspace?.id === workspace.id;
                  const threadListExpanded = expandedThreadListWorkspaceIds.has(workspace.id);
                  const projectThreads = (workspace.threads ?? []).filter((thread: any) => thread.scope !== "chat" && isUserVisibleThread(thread));
                  const menuSortedThreads = sortCodexSidebarThreads(
                    sortThreadsForMenu(projectThreads),
                    sidebarSortMode,
                    pinnedThreadIds,
                    unreadThreadIds
                  );
                  const visibleThreads = threadListExpanded ? menuSortedThreads : menuSortedThreads.slice(0, 5);
                  const projectStateCount = threadStateCountsByWorkspace.get(workspace.id) ?? 0;

                  return (
                    <article key={workspace.id} className={`project-group${active ? " active" : ""}${pinnedWorkspaceIds.has(workspace.id) ? " pinned" : ""}`}>
                      <div
                        className={`project-header${selectedSidebarRow === `project:${workspace.id}` ? " active" : ""}`}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setProjectContextMenu({
                            x: event.clientX,
                            y: event.clientY,
                            workspace
                          });
                        }}
                      >
                        <button
                          className="project-header-main"
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => {
                            setSelectedSidebarRow(`project:${workspace.id}`);
                            setHoveredThread(null);
                            setSelectedWorkspaceId(workspace.id);
                            bindBrainProjectToWorkspace(workspace.id, { composingNewThread: true });
                            setActiveFeature("new-chat");
                            setNewThreadScope("project");
                            setChatUsesProject?.(true);
                            setExpandedWorkspaceIds((current) => {
                              const next = new Set(current);
                              if (next.has(workspace.id)) {
                                next.delete(workspace.id);
                              } else {
                                next.add(workspace.id);
                              }
                              return next;
                            });
                          }}
                        >
                          <span className="folder-icon"><SidebarIcon name="folder" /></span>
                          <strong>{workspace.name}</strong>
                          <span className={`project-chevron${expanded ? " expanded" : ""}`}><SidebarIcon name="chevron-right" /></span>
                        </button>
                        {projectStateCount > 0 ? <em className="project-state-count">{projectStateCount}</em> : null}
                        <span className="project-hover-actions">
                          <button
                            type="button"
                            title="项目操作"
                            aria-label={`${workspace.name} 项目操作`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const rect = event.currentTarget.getBoundingClientRect();
                              setSelectedWorkspaceId(workspace.id);
                              setProjectContextMenu({
                                x: rect.left,
                                y: rect.bottom + 4,
                                workspace
                              });
                            }}
                          >
                            <SidebarIcon name="more" />
                          </button>
                          <button
                            type="button"
                            data-testid="project-new-thread-button"
                            data-workspace-id={workspace.id}
                            data-workspace-name={workspace.name}
                            title="新建线程"
                            aria-label={`在 ${workspace.name} 中新建线程`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setSelectedWorkspaceId(workspace.id);
                              setActiveFeature("new-chat");
                              setNewThreadScope("project");
                              setChatUsesProject?.(true);
                              setIsComposingNewThread(true);
                            }}
                          >
                            <SidebarIcon name="edit" />
                          </button>
                        </span>
                      </div>

                      {expanded ? (
                        <div className="project-threads">
                          {visibleThreads.map((thread) => {
                            const activeThread =
                              selectedWorkspace?.id === workspace.id && selectedThread?.id === thread.id && !isComposingNewThread;
                            const threadKey = `${workspace.id}:${thread.id}`;
                            const isPendingApproval = threadStillNeedsApproval({
                              threadStatus: thread.status,
                              threadKey,
                              pendingApprovalThreadKey,
                              threadId: thread.id,
                              settledApprovalId,
                              settledThreadId: selectedThread?.id,
                              snapshotApprovalId: snapshot?.approval?.id
                            });
                            const isRunningThread =
                              (thread.status === "running" || threadKey === runningThreadKey || activeThreadIdSet.has(thread.id)) &&
                              !isPendingApproval;
                            const isFailedThread = thread.status === "failed" && !isPendingApproval && !isRunningThread;
                            const threadStateClass = isPendingApproval
                              ? " pending-approval"
                              : isRunningThread
                                ? " running"
                                : isFailedThread
                                  ? " failed"
                                  : "";

                            return (
                              <button
                                key={thread.id}
                                data-testid="sidebar-project-task-row"
                                data-thread-key={threadKey}
                                className={`thread-row${activeThread ? " active" : ""}${pinnedThreadIds.has(thread.id) ? " pinned" : ""}${unreadThreadIds.has(thread.id) ? " unread" : ""}${threadStateClass}`}
                                type="button"
                                onMouseEnter={(event) => {
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  setHoveredThread({
                                    workspace,
                                    thread,
                                    top: Math.max(10, Math.min(window.innerHeight - 150, rect.top + rect.height / 2 - 58)),
                                    left: rect.right + 10
                                  });
                                }}
                                onMouseLeave={() => setHoveredThread(null)}
                                onClick={() => {
                                  const legacyConversationId = resolveLegacyConversationIdForThread(thread.id);
                                  setSelectedSidebarRow(`project-thread:${workspace.id}:${thread.id}`);
                                  setSearchFilePreview(null);
                                  setIsComposingNewThread(false);
                                  setNewThreadScope("project");
                                  setChatUsesProject?.(true);
                                  bindBrainProjectToWorkspace(workspace.id, {
                                    conversationId: brainConversations.some((conversation) => conversation.id === legacyConversationId)
                                      ? legacyConversationId
                                      : ""
                                  });
                                  if (selectWorkspaceThread) {
                                    selectWorkspaceThread(workspace.id, thread.id, { force: true });
                                  } else {
                                    setSelectedWorkspaceId(workspace.id);
                                    setSelectedThreadId(thread.id);
                                  }
                                  setUnreadThreadIds((current) => {
                                    const next = new Set(current);
                                    next.delete(thread.id);
                                    return next;
                                  });
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  setSelectedWorkspaceId(workspace.id);
                                  setSelectedThreadId(thread.id);
                                  setThreadContextMenu({
                                    x: event.clientX,
                                    y: event.clientY,
                                    workspace,
                                    thread
                                  });
                                }}
                              >
                                <span className="thread-pin">{pinnedThreadIds.has(thread.id) ? <SidebarIcon name="pin" /> : ""}</span>
                                <span className="thread-title">{thread.title}</span>
                                <span className="thread-status-slot">
                                  {isPendingApproval ? <em className="thread-approval-badge">{thread.statusLabel || "等待批准"}</em> : null}
                                  {isRunningThread ? <i className="thread-running-dot" aria-label="运行中" /> : null}
                                  {isFailedThread ? <em className="thread-failed-badge">{thread.statusLabel || "失败"}</em> : null}
                                </span>
                                <time>{formatRelativeTimeLabel(thread.updatedAt)}</time>
                                {/* 侧栏 hover 仅显示置顶、归档；其余操作通过右键菜单 */}
                                <span className="thread-hover-actions">
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    title={pinnedThreadIds.has(thread.id) ? "取消置顶对话" : "置顶对话"}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleThreadMenuAction("pin", workspace, thread);
                                    }}
                                  >
                                    <SidebarIcon name="pin" />
                                  </span>
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    title="归档对话"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleThreadMenuAction("archive", workspace, thread);
                                    }}
                                  >
                                    <SidebarIcon name="archive" />
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                          {menuSortedThreads.length > 5 ? (
                            <button
                              className="thread-row muted"
                              type="button"
                              onClick={() => {
                                setExpandedThreadListWorkspaceIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(workspace.id)) next.delete(workspace.id);
                                  else next.add(workspace.id);
                                  return next;
                                });
                              }}
                            >
                              <span>{threadListExpanded ? "折叠显示" : "展开显示"}</span>
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                {orderedSidebarProjects.length > 5 ? (
                  <button className="sidebar-show-more" type="button" onClick={() => setSidebarProjectsExpanded((current) => !current)}>
                    {sidebarProjectsExpanded ? "显示更少" : "显示更多"}
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="sidebar-subsection-divider" />
            <div className="project-subsection-head chat-subsection-head">
              <button
                className="project-subsection-toggle"
                type="button"
                aria-expanded={!chatsCollapsed}
                onClick={() => setChatsCollapsed((current) => !current)}
              >
                <span className="project-subsection-label">聊天</span>
                <span className={`subsection-chevron${chatsCollapsed ? "" : " expanded"}`}>
                  <SidebarIcon name="chevron-right" />
                </span>
              </button>
              <span className="sidebar-task-actions">
                <button className="sidebar-organize-button" title="整理侧边栏" aria-label="整理侧边栏" type="button" onClick={() => setSidebarOptionsOpen((current) => !current)}><SidebarIcon name="more" /></button>
                <button className="chat-add-button" title="新建聊天" aria-label="新建聊天" type="button" onClick={startNewChat}>+</button>
              </span>
            </div>
            {sidebarOptionsOpen ? (
              <div className="sidebar-organize-menu" role="menu" aria-label="整理侧边栏">
                <strong>组织方式</strong>
                <button type="button" className={sidebarOrganizeMode === "project" ? "active" : ""} onClick={() => { setSidebarOrganizeMode("project"); setSidebarOptionsOpen(false); }}>按项目</button>
                <button type="button" className={sidebarOrganizeMode === "list" ? "active" : ""} onClick={() => { setSidebarOrganizeMode("list"); setSidebarOptionsOpen(false); }}>单列表</button>
                <strong>排序方式</strong>
                <button type="button" className={sidebarSortMode === "priority" ? "active" : ""} onClick={() => { setSidebarSortMode("priority"); setSidebarOptionsOpen(false); }}>优先级</button>
                <button type="button" className={sidebarSortMode === "updated" ? "active" : ""} onClick={() => { setSidebarSortMode("updated"); setSidebarOptionsOpen(false); }}>最近更新</button>
              </div>
            ) : null}
            {!chatsCollapsed ? (
              <div className="sidebar-chat-list">
                {visibleSidebarTaskEntries.length ? visibleSidebarTaskEntries.map(renderSidebarTaskEntry) : <div className="sidebar-empty-note">暂无聊天</div>}
                {sidebarTaskEntries.length > 8 ? (
                  <button className="sidebar-show-more" type="button" onClick={() => setSidebarTasksExpanded((current) => !current)}>
                    {sidebarTasksExpanded ? "显示更少" : "显示更多"}
                  </button>
                ) : null}
              </div>
            ) : null}
            {projectContextMenu && typeof document !== "undefined"
              ? createPortal(
                  <div className="project-context-layer" onMouseDown={() => setProjectContextMenu(null)}>
                    <div
                      className="project-context-menu"
                      style={{
                        left: Math.min(projectContextMenu.x, window.innerWidth - 190),
                        top: Math.min(projectContextMenu.y, window.innerHeight - 220)
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          const workspaceId = projectContextMenu.workspace.id;
                          setPinnedWorkspaceIds((current) => {
                            const next = new Set(current);
                            if (next.has(workspaceId)) next.delete(workspaceId);
                            else next.add(workspaceId);
                            return next;
                          });
                          setProjectContextMenu(null);
                        }}
                      >
                        <SidebarIcon name="pin" />
                        {pinnedWorkspaceIds.has(projectContextMenu.workspace.id) ? "取消置顶" : "置顶项目"}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const workspaceId = projectContextMenu.workspace.id;
                          setProjectContextMenu(null);
                          const result = await api.openWorkspaceLocation({ workspaceId, target: "explorer" });
                          setChatStatus(result.detail);
                        }}
                      >
                        <SidebarIcon name="folder-open" />
                        在资源管理器中打开
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const workspaceId = projectContextMenu.workspace.id;
                          setProjectContextMenu(null);
                          try {
                            const result = await api.createWorkspaceWorktree({ workspaceId });
                            setChatStatus(result.detail);
                            if (!result.ok) setErrorMessage(result.detail);
                          } catch (error) {
                            setErrorMessage(error instanceof Error ? error.message : String(error));
                          }
                        }}
                      >
                        <SidebarIcon name="git-worktree" />
                        创建永久工作树
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenameProjectDialog({
                            workspace: projectContextMenu.workspace,
                            name: projectContextMenu.workspace.name
                          });
                          setProjectContextMenu(null);
                        }}
                      >
                        <SidebarIcon name="edit" />
                        重命名项目
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const workspace = projectContextMenu.workspace;
                          const threadIds = workspace.threads
                            .filter((thread: any) => thread.scope !== "chat" && isUserVisibleThread(thread))
                            .map((thread: any) => thread.id);
                          setArchivedThreadIds((current) => new Set([...current, ...threadIds]));
                          setProjectContextMenu(null);
                          if (api) {
                            let nextCatalog = workspaceCatalog;
                            for (const threadId of threadIds) {
                              nextCatalog = await api.archiveWorkspaceThread({ workspaceId: workspace.id, threadId, archived: true });
                            }
                            setWorkspaceCatalog(nextCatalog);
                          }
                          setChatStatus(`已归档 ${threadIds.length} 个对话`);
                        }}
                      >
                        <SidebarIcon name="archive" />
                        归档对话
                      </button>
                      <button
                        className="danger"
                        type="button"
                        onClick={async () => {
                          const workspace = projectContextMenu.workspace;
                          setProjectContextMenu(null);
                          if (!globalThis.window.confirm(`从项目列表中移除“${workspace.name}”？磁盘文件不会被删除。`)) return;
                          try {
                            const nextCatalog = await api.removeWorkspace({ workspaceId: workspace.id });
                            setWorkspaceCatalog(nextCatalog);
                            const fallback = orderSidebarProjects(
                              filterWorkspaceCatalogByScene(normalizeWorkspaceCatalog(nextCatalog), selectedBrainWorkspaceKey)
                            )[0];
                            if (selectedWorkspace?.id === workspace.id) {
                              const fallbackThreadId = resolveUserVisibleThreadSelection(fallback?.threads ?? [], null)?.id ?? "";
                              setSelectedWorkspaceId(fallback?.id ?? "");
                              setSelectedThreadId(fallbackThreadId);
                              setIsComposingNewThread(!fallbackThreadId);
                            }
                          } catch (error) {
                            setErrorMessage(error instanceof Error ? error.message : String(error));
                          }
                        }}
                      >
                        <SidebarIcon name="remove" />
                        移除
                      </button>
                    </div>
                  </div>,
                  document.body
                )
              : null}
            {renameProjectDialog && typeof document !== "undefined"
              ? createPortal(
                  <div className="project-name-dialog-backdrop" role="presentation">
                    <form
                      className="project-name-dialog"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        try {
                          const nextCatalog = await api.renameWorkspace({
                            workspaceId: renameProjectDialog.workspace.id,
                            name: renameProjectDialog.name
                          });
                          setWorkspaceCatalog(nextCatalog);
                          setRenameProjectDialog(null);
                        } catch (error) {
                          setErrorMessage(error instanceof Error ? error.message : String(error));
                        }
                      }}
                    >
                      <div className="project-name-dialog-head">
                        <div><strong>重命名项目</strong><span>保持简短且易识别</span></div>
                        <button type="button" aria-label="关闭" onClick={() => setRenameProjectDialog(null)}>×</button>
                      </div>
                      <input
                        autoFocus
                        value={renameProjectDialog.name}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) => setRenameProjectDialog({ ...renameProjectDialog, name: event.target.value })}
                      />
                      <div className="project-name-dialog-actions">
                        <button type="button" onClick={() => setRenameProjectDialog(null)}>取消</button>
                        <button className="primary" type="submit" disabled={!renameProjectDialog.name.trim()}>保存</button>
                      </div>
                    </form>
                  </div>,
                  document.body
                )
              : null}
            {showRenameThreadDialog && typeof document !== "undefined"
              ? createPortal(
                  <div className="project-name-dialog-backdrop" role="presentation">
                    <form
                      className="project-name-dialog"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (!editingThreadTitle.trim() || typeof renameThread !== "function") {
                          return;
                        }
                        await renameThread();
                      }}
                    >
                      <div className="project-name-dialog-head">
                        <div><strong>重命名对话</strong><span>修改当前对话线程名称</span></div>
                        <button type="button" aria-label="关闭" onClick={() => setShowRenameThreadDialog?.(false)}>×</button>
                      </div>
                      <input
                        autoFocus
                        value={editingThreadTitle}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) => setEditingThreadTitle?.(event.target.value)}
                      />
                      <div className="project-name-dialog-actions">
                        <button type="button" onClick={() => setShowRenameThreadDialog?.(false)}>取消</button>
                        <button className="primary" type="submit" disabled={!editingThreadTitle.trim()}>保存</button>
                      </div>
                    </form>
                  </div>,
                  document.body
                )
              : null}
            {hoveredThread && typeof document !== "undefined"
              ? createPortal(
                  <div
                    className="thread-hover-card"
                    role="tooltip"
                    style={{ top: hoveredThread.top, left: hoveredThread.left }}
                  >
                    <strong>{hoveredThread.thread.title}</strong>
                    <small><SidebarIcon name="folder" />{hoveredThread.workspace.name}</small>
                    <small><SidebarIcon name="branch" />{hoveredThread.thread.branch || "main"}</small>
                    {hoveredThread.thread.lastEventSummary ? <small>{hoveredThread.thread.lastEventSummary}</small> : null}
                  </div>,
                  document.body
                )
              : null}
          </section>
          </div>
        </div>
        <section className="left-section thread-tools">
          {quotaWarning && quotaWarning.key !== dismissedQuotaWarningKey ? (
            <div className="sidebar-token-warning" role="status">
              <button type="button" className="sidebar-token-warning-close" aria-label="关闭额度预警" onClick={() => setDismissedQuotaWarningKey(quotaWarning.key)}>×</button>
              <strong>
                {quotaWarning.overLimit
                    ? `已超出费用额度 ${Math.round(quotaWarning.usedPercent - 100)}%`
                    : `剩余 ${quotaWarning.remaining}% 费用额度`}
              </strong>
              <span>{quotaWarning.scope}已用 {formatQuotaMoney(quotaWarning.used)} / {formatQuotaMoney(quotaWarning.quota)}，将在 {quotaWarning.reset} 重置</span>
              <div className="sidebar-token-warning-bar"><i style={{ width: `${Math.min(100, Math.max(0, quotaWarning.usedPercent))}%` }} /></div>
              <div className="sidebar-token-warning-actions">
                <button type="button" onClick={() => { setActiveFeature("settings"); setActiveSettingsSection("billing"); }}>添加额度</button>
                <button type="button" className="primary" onClick={() => { setActiveFeature("settings"); setActiveSettingsSection("billing"); }}>升级</button>
              </div>
            </div>
          ) : null}
          <div className="sidebar-account-card">
            <div className="sidebar-account-avatar">
              {String(displayUserAvatar).startsWith("data:image/")
                ? <img src={displayUserAvatar} alt="账户头像" />
                : displayUserAvatar}
            </div>
            <div className="sidebar-account-meta">
              <strong>{displayUserName}</strong>
              <span>{displayUserPlan}</span>
              <em>切换到设置中心</em>
            </div>
            <div className="sidebar-account-actions">
              {appUpdateStatus?.available ? (
                <button
                  className="sidebar-account-update"
                  type="button"
                  title={appUpdateStatus.latestVersion
                    ? `下载更新 ${appUpdateStatus.latestVersion}`
                    : "下载更新"}
                  aria-label={appUpdateStatus.latestVersion
                    ? `下载更新到 ${appUpdateStatus.latestVersion}`
                    : "下载更新"}
                  disabled={Boolean(appUpdateBusy)}
                  onClick={(event) => {
                    event.stopPropagation();
                    void startDesktopAppUpdate?.();
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 3v10.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M8.2 10.2 12 14l3.8-3.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M5 18h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <i className="sidebar-account-update-badge" aria-hidden="true" />
                </button>
              ) : null}
              <button
                className={`sidebar-account-settings${appUpdateStatus?.available ? " has-update" : ""}`}
                type="button"
                aria-label={appUpdateStatus?.available
                  ? `打开账号菜单，有可用更新 ${appUpdateStatus.latestVersion || ""}`.trim()
                  : "打开账号菜单"}
                aria-expanded={showAccountMenu}
                onClick={(event) => {
                  event.stopPropagation();
                  setShowAccountMenu((current) => !current);
                }}
              >
                ⚙
                {appUpdateStatus?.available ? (
                  <i className="sidebar-account-update-badge" aria-hidden="true" />
                ) : null}
              </button>
            </div>
            {showAccountMenu ? (
              <div className="sidebar-account-menu" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => {
                    setShowAccountMenu(false);
                    setActiveFeature("settings");
                    setActiveSettingsSection("account");
                  }}
                >
                  <span aria-hidden="true">⚙</span>
                  <strong>设置</strong>
                </button>
                {appUpdateStatus?.available ? (
                  <button
                    type="button"
                    disabled={Boolean(appUpdateBusy)}
                    onClick={() => {
                      setShowAccountMenu(false);
                      void startDesktopAppUpdate?.();
                    }}
                  >
                    <span aria-hidden="true">↓</span>
                    <strong>
                      {appUpdateBusy
                        ? "正在更新…"
                        : `更新到 ${appUpdateStatus.latestVersion || "新版本"}`}
                    </strong>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setShowAccountMenu(false);
                    void handleLogout();
                  }}
                >
                  <span aria-hidden="true">↪</span>
                  <strong>退出登录</strong>
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </aside>
    );
  }

  const selectedBuiltinPlugin = builtinPluginCatalog.find((plugin) => plugin.packageName === selectedComposerSkill?.name);

  const selectedBrainProject = brainProjects.find((project) => project.id === selectedBrainProjectId);
  const resourceBrainProject = brainProjects.find((project) => project.localWorkspaceId && project.localWorkspaceId === selectedWorkspace?.id)
    ?? selectedBrainProject;
  const selectedBrainConversation = brainConversations.find((conversation) => conversation.id === selectedBrainConversationId);
  const isLegacySidebarSelection = Boolean(
    selectedSidebarRow?.startsWith("feature:")
    || selectedSidebarRow?.startsWith("project-thread:")
    || selectedSidebarRow?.startsWith("chat:")
    || (selectedSidebarRow?.startsWith("project:") && !selectedSidebarRow.startsWith("brain-project:"))
  );
  const isBrainConversationSelection = Boolean(
    selectedBrainConversationId
    && selectedBrainProjectId
    && !isLegacySidebarSelection
    && selectedSidebarRow === `brain-conversation:${selectedBrainConversationId}`
  );

  const renderComposerPortal = (children: any) => {
    if (isNewChatMode && newChatComposerHost) return createPortal(children, newChatComposerHost);
    if (isBrainConversationSelection && brainChatComposerHost) return createPortal(children, brainChatComposerHost);
    return children;
  };

  function readComposerQuestion(draft?: Parameters<typeof askModel>[0]) {
    const fromDraft = String(draft?.question ?? "").trim();
    if (fromDraft) return fromDraft;
    return String(composerTextareaRef.current?.getValue() ?? question ?? "").trim();
  }

  function buildComposerSendDraft(draft?: Parameters<typeof askModel>[0] & { keepComposer?: boolean }) {
    const keepComposer = Boolean(draft?.keepComposer);
    const text = readComposerQuestion(draft);
    const withRefs = keepComposer ? text : injectConversationRefsIntoQuestion(text, composerConversationRefs);
    return {
      question: withRefs,
      images: draft?.images ?? (keepComposer ? [] : composerImages),
      tools: keepComposer ? [] : (draft?.tools ?? selectedComposerTools),
      skill: keepComposer ? null : (draft?.skill ?? selectedComposerSkill),
      skillContext: keepComposer ? "" : (draft?.skillContext ?? composerSkillContext),
      modes: keepComposer ? [] : (draft?.modes ?? composerModes),
      conversationRefs: keepComposer ? [] : composerConversationRefs,
      ...(keepComposer ? { keepComposer: true as const } : {})
    };
  }

  const handleComposerDraftChange = (value: string) => {
    if (composerLayoutDraftTimerRef.current) window.clearTimeout(composerLayoutDraftTimerRef.current);
    composerLayoutDraftTimerRef.current = window.setTimeout(() => {
      setComposerLayoutDraft(value);
    }, 120);
  };

  const composerMentionCandidates = (() => {
    if (!composerMentionQuery) return [] as ConversationRefCandidate[];
    const catalog = normalizeWorkspaceCatalog(workspaceCatalog);
    const threadCandidates: ConversationRefCandidate[] = catalog.flatMap((workspace: any) =>
      (workspace.threads || []).filter((thread: any) => isUserVisibleThread(thread)).map((thread: any) => ({
        id: `thread-${workspace.id}-${thread.id}`,
        kind: "thread" as const,
        title: String(thread.title || "未命名线程"),
        detail: String(thread.summary || workspace.name || ""),
        workspaceId: workspace.id,
        threadId: thread.id,
        archived: thread.status === "archived",
        updatedAt: thread.updatedAt
      }))
    );
    const brainCandidates: ConversationRefCandidate[] = (brainConversations || []).map((conversation: any) => ({
      id: `brain-${conversation.id}`,
      kind: "brain_conversation" as const,
      title: String(conversation.title || "未命名会话"),
      detail: String(conversation.workspaceSnapshot || selectedBrainWorkspaceKey || "BRAIN"),
      conversationId: conversation.id,
      archived: String(conversation.status || "").toUpperCase() === "ARCHIVED",
      updatedAt: conversation.updatedAt || conversation.lastMessageAt
    }));
    const currentThreadId = selectedThread?.id || "";
    const currentBrainId = selectedBrainConversationId || "";
    const combined = [...threadCandidates, ...brainCandidates].filter((item) => {
      if (item.kind === "thread" && item.threadId && item.threadId === currentThreadId) return false;
      if (item.kind === "brain_conversation" && item.conversationId && item.conversationId === currentBrainId) return false;
      return true;
    });
    return filterConversationRefCandidates(combined, composerMentionQuery.query, 12);
  })();

  useEffect(() => {
    setComposerMentionIndex(0);
  }, [composerMentionQuery?.query, composerMentionCandidates.length]);

  const hydrateConversationRefCandidate = async (candidate: ConversationRefCandidate): Promise<ConversationRef> => {
    if (api?.previewConversationRef) {
      const preview = await api.previewConversationRef({
        kind: candidate.kind,
        workspaceId: candidate.workspaceId,
        threadId: candidate.threadId,
        conversationId: candidate.conversationId,
        turnLimit: 5
      });
      return {
        id: preview.id,
        kind: preview.kind,
        title: preview.title || candidate.title,
        summary: preview.summary || candidate.detail,
        workspaceId: preview.workspaceId || candidate.workspaceId,
        threadId: preview.threadId || candidate.threadId,
        conversationId: preview.conversationId || candidate.conversationId,
        archived: preview.archived ?? candidate.archived,
        turns: preview.turns,
        truncated: preview.truncated
      };
    }
    if (candidate.kind === "brain_conversation" && candidate.conversationId && window.newbrain?.listBrainMessages) {
      const messages = await window.newbrain.listBrainMessages({ conversationId: candidate.conversationId });
      const { turns, truncated } = selectRecentConversationTurns(messages, 5);
      return {
        id: candidate.id,
        kind: "brain_conversation",
        title: candidate.title,
        summary: candidate.detail,
        conversationId: candidate.conversationId,
        archived: candidate.archived,
        turns,
        truncated
      };
    }
    return {
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      summary: candidate.detail,
      workspaceId: candidate.workspaceId,
      threadId: candidate.threadId,
      conversationId: candidate.conversationId,
      archived: candidate.archived,
      turns: [],
      truncated: false
    };
  };

  const selectComposerMentionCandidate = async (candidate: ConversationRefCandidate) => {
    if (!composerMentionQuery || composerMentionBusy) return;
    setComposerMentionBusy(true);
    try {
      const hydrated = await hydrateConversationRefCandidate(candidate);
      setComposerConversationRefs((current) => mergeConversationRef(current, hydrated));
      const draftText = composerTextareaRef.current?.getValue() ?? "";
      const { next, cursor } = replaceComposerMentionRange(
        draftText,
        composerMentionQuery.start,
        composerMentionQuery.cursor,
        ""
      );
      composerTextareaRef.current?.setValue(next);
      setQuestion(next);
      setComposerLayoutDraft(next);
      setComposerMentionQuery(null);
      window.requestAnimationFrame(() => {
        const input = document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
        if (!input) return;
        input.focus();
        input.selectionStart = cursor;
        input.selectionEnd = cursor;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "引用对话失败");
    } finally {
      setComposerMentionBusy(false);
    }
  };

  const handleComposerMentionNavigate = (direction: "up" | "down" | "enter" | "escape") => {
    if (!composerMentionQuery || !composerMentionCandidates.length) {
      if (direction === "escape" && composerMentionQuery) {
        setComposerMentionQuery(null);
        return true;
      }
      return false;
    }
    if (direction === "escape") {
      setComposerMentionQuery(null);
      return true;
    }
    if (direction === "up") {
      setComposerMentionIndex((current) => (current - 1 + composerMentionCandidates.length) % composerMentionCandidates.length);
      return true;
    }
    if (direction === "down") {
      setComposerMentionIndex((current) => (current + 1) % composerMentionCandidates.length);
      return true;
    }
    const candidate = composerMentionCandidates[composerMentionIndex] || composerMentionCandidates[0];
    if (candidate) void selectComposerMentionCandidate(candidate);
    return true;
  };

  const handleComposerEnter = () => {
    const draftText = readComposerQuestion();
    if ((isGlobalModelBusy || brainMessageBusy) && !draftText && composerImages.length === 0) {
      void cancelCurrentModelRequest?.();
      return;
    }
    if (!api || (!draftText && composerImages.length === 0)) return;
    void submitComposerRequest();
  };

  async function sendBrainMessage(draft?: {
    question?: string;
    images?: any[];
    skill?: { name?: string } | null;
    modes?: string[];
  }) {
    const content = String(draft?.question ?? question).trim();
    const hasAttachments = (draft?.images?.length ?? composerImages.length) > 0;
    if ((!content && !hasAttachments) || brainMessageBusy || !selectedBrainConversationId || !selectedBrainProjectId) return;
    if (!window.newbrain?.appendBrainMessage) return;
    const catalog = normalizeWorkspaceCatalog(workspaceCatalog);
    const executionWorkspace = resolveSceneExecutionWorkspace(
      catalog,
      selectedBrainWorkspaceKey,
      selectedBrainProject?.localWorkspaceId,
      selectedWorkspace?.id
    ) ?? catalog.find((item: any) => item.id === INTERNAL_CHAT_WORKSPACE_ID);
    // No same-scene project: use standalone chat. Never borrow another scene's project.
    const executionWorkspaceId = executionWorkspace?.id || INTERNAL_CHAT_WORKSPACE_ID;
    if (!api?.chatWithModel) {
      setErrorMessage("当前环境无法发送模型请求。");
      setChatStatus("当前环境无法发送模型请求。");
      return;
    }
    setBrainMessageBusy(true);
    setErrorMessage("");
    try {
      const attachmentNote = hasAttachments
        ? `\n\n[附件：${(draft?.images ?? composerImages).map((item: any) => item.name).join("、")}]`
        : "";
      const contentWithRefs = injectConversationRefsIntoQuestion(content, composerConversationRefs);
      const sourceRefsJson = JSON.stringify(composerConversationRefs.map((ref) => ({
        type: ref.kind,
        id: ref.id,
        title: ref.title,
        workspaceId: ref.workspaceId,
        threadId: ref.threadId,
        conversationId: ref.conversationId
      })));
      // The native NewBrain Thread is the execution source of truth.  Do not
      // persist the user turn into the separate BRAIN conversation before
      // sending it, otherwise one turn is written to two message stores.
      // Keep an optimistic projection for the BRAIN panel only; the durable
      // assistant projection is appended after the native turn completes.
      const userMessage = {
        id: `brain-local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        conversationId: selectedBrainConversationId,
        role: "user" as const,
        content: contentWithRefs + attachmentNote,
        createdAt: new Date().toISOString(),
        sourceRefsJson,
        requestId: ""
      };
      const history = [...brainMessages, userMessage];
      setBrainMessages(history);
      setBrainDraft("");
      setQuestion("");
      setComposerConversationRefs([]);
      setComposerMentionQuery(null);
      setComposerImages([]);
      await window.newbrain.saveBrainDraft?.({
        projectId: selectedBrainProjectId,
        conversationId: selectedBrainConversationId,
        content: ""
      });

      if (executionWorkspaceId !== selectedWorkspace?.id) {
        setSelectedWorkspaceId(executionWorkspaceId);
      }
      let executionThreadId = String(selectedThread?.id || "").trim();
      if (!executionThreadId || !executionWorkspace?.threads?.some((item: any) => item.id === executionThreadId)) {
        const previousIds = new Set((executionWorkspace?.threads ?? []).map((item: any) => item.id));
        const nextCatalog = await api.addWorkspaceThread({
          workspaceId: executionWorkspaceId,
          title: content.slice(0, 36) || "BRAIN 对话",
          summary: "从 BRAIN 工作台对话自动创建的模型线程。",
          scope: executionWorkspaceId === INTERNAL_CHAT_WORKSPACE_ID ? "chat" : "project",
          ...(executionWorkspaceId === INTERNAL_CHAT_WORKSPACE_ID
            ? { brainWorkspaceKey: selectedBrainWorkspaceKey }
            : {})
        });
        const nextWorkspace = nextCatalog.find((item: any) => item.id === executionWorkspaceId);
        const createdThread = nextWorkspace?.threads?.find((item: any) => !previousIds.has(item.id));
        executionThreadId = String(createdThread?.id || "").trim();
        if (!executionThreadId) throw new Error("无法为当前 BRAIN 对话创建模型线程。");
        setWorkspaceCatalog(nextCatalog);
        setSelectedThreadId(executionThreadId);
        const threadSnapshot = await api.activateWorkspaceThread({
          workspaceId: executionWorkspaceId,
          threadId: executionThreadId
        });
        syncSnapshot(threadSnapshot, executionThreadId);
      }
      setChatStatus("BRAIN 正在处理…");
      const requestId = `brain-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const rustConversation = (window.newbrain as any)?.rustConversation as undefined | ((input: any) => Promise<any>);
      if (rustConversation) {
        const rustBase = { projectId: executionWorkspaceId, workspaceType: "chat" };
        const rustThread = await rustConversation({ ...rustBase, operation: "conversation.thread.get", payload: { thread_id: executionThreadId } }).catch(() => null);
        if (!rustThread || rustThread.status !== "completed") {
          await rustConversation({ ...rustBase, operation: "conversation.thread.create", payload: { thread_id: executionThreadId, title: content.slice(0, 36) || "BRAIN 对话" } }).catch(() => undefined);
        }
        await rustConversation({ ...rustBase, operation: "conversation.thread.activate", payload: { thread_id: executionThreadId } }).catch(() => undefined);
        await rustConversation({ ...rustBase, operation: "conversation.turn.begin", payload: { thread_id: executionThreadId, turn_id: requestId } }).catch(() => undefined);
        await rustConversation({ ...rustBase, operation: "conversation.turn.append_message", payload: { thread_id: executionThreadId, role: "user", content: userMessage.content } }).catch(() => undefined);
      }
      const result = await api.chatWithModel({
        requestId,
        workspaceId: executionWorkspaceId,
        threadId: executionThreadId,
        ...modelConfig,
        apiKey: "",
        disableResponseStorage: !desktopPreferences.configuration.saveResponses,
        permissionMode: composerPermission,
        systemPrompt: [
          modelConfig.systemPrompt,
          `当前 BRAIN 工作台：${selectedBrainWorkspace?.displayName || selectedBrainWorkspaceKey}`,
          `当前本地项目：${selectedBrainProject?.name || "未命名项目"}`,
          "回答应服务于当前工作台与项目；不得声称执行了尚未执行的工具或文件操作。"
        ].filter(Boolean).join("\n\n"),
        selectedSkillNames: draft?.skill?.name
          ? [draft.skill.name]
          : selectedComposerSkill?.name
            ? [selectedComposerSkill.name]
            : [],
        composerModes: draft?.modes ?? [...composerModes],
        // The active NewBrain Thread already owns prior turns. Send only the
        // new turn here; replaying BRAIN history caused duplicate messages.
        messages: [{
          id: userMessage.id,
          role: "user",
          content: userMessage.content,
          createdAt: userMessage.createdAt
        }]
      });
      const finalContent = String(result?.content || "").trim() || "本轮没有生成可见回复。";
      if (rustConversation) {
        await rustConversation({ projectId: executionWorkspaceId, workspaceType: "chat", operation: "conversation.turn.append_message", payload: { thread_id: executionThreadId, role: "assistant", content: finalContent } }).catch(() => undefined);
        await rustConversation({ projectId: executionWorkspaceId, workspaceType: "chat", operation: "conversation.turn.finish", payload: { thread_id: executionThreadId } }).catch(() => undefined);
      }
      const assistantMessage = await window.newbrain.appendBrainMessage({
        conversationId: selectedBrainConversationId,
        role: "assistant",
        content: finalContent,
        sourceRefsJson: JSON.stringify(Array.isArray(result?.citations) ? result.citations : []),
        requestId
      });
      setBrainMessages((current) => [...current, assistantMessage]);
      await refreshBrainConversations(selectedBrainProjectId);
      setChatStatus("BRAIN 回复成功。");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setErrorMessage(detail);
      if (window.newbrain?.appendBrainMessage && selectedBrainConversationId) {
        const failureMessage = await window.newbrain.appendBrainMessage({
          conversationId: selectedBrainConversationId,
          role: "assistant",
          content: `请求未能完成：${detail}`
        }).catch(() => null);
        if (failureMessage) setBrainMessages((current) => [...current, failureMessage]);
      }
      setChatStatus("BRAIN 请求失败；已发送的用户消息仍保存在本地。");
    } finally {
      setBrainMessageBusy(false);
    }
  }

  function clearComposerAfterSend() {
    // askModel is often called with a draft override from this path, which skips
    // its own !draftOverride clear. Always drop sent text + attachment chips here.
    composerTextareaRef.current?.setValue("");
    setQuestion("");
    if (questionRef) questionRef.current = "";
    setComposerLayoutDraft("");
    setComposerImages([]);
    setComposerConversationRefs([]);
    setComposerMentionQuery(null);
  }

  async function materializeCreatorFromChat(rawText: string, creatorLabel: string) {
    const text = String(rawText || "").trim();
    if (!text || !api?.addFeatureItem) return null;
    const dedupeKey = `${creatorLabel}::${text}`;
    if (lastCreatorMaterializeRef.current === dedupeKey) return null;
    lastCreatorMaterializeRef.current = dedupeKey;
    try {
      if (creatorLabel === "Automation Creator") {
        if (/请帮我修改自动化任务/.test(text)) {
          if (typeof setChatStatus === "function") setChatStatus("已进入自动化修改对话，发送后请确认计划细节");
          return null;
        }
        const parsed = parseAutomationIntent(text);
        const item = {
          title: parsed.title || "新自动化任务",
          trigger: parsed.trigger || text,
          prompt: parsed.prompt || text,
          schedule: parsed.schedule,
          intervalMinutes: parsed.intervalMinutes,
          dailyTime: parsed.dailyTime || "",
          rrule: parsed.rrule || "",
          action: parsed.action === "thread_follow_up" ? "workspace_scan" : parsed.action,
          status: "scheduled",
          workspaceId: selectedWorkspace?.id || "",
          threadId: selectedThread?.id || "",
          model: modelConfig?.model || "",
          reasoning: modelConfig?.reasoningEffort || "low",
          runtime: "worktree",
          permissionMode: composerPermission === "full" ? "full" : "agent"
        };
        const nextConfig = await api.addFeatureItem({
          kind: "automations",
          item
        });
        setFeatureConfig(nextConfig);
        if (typeof setChatStatus === "function") setChatStatus(`已创建自动化「${parsed.title || "新自动化任务"}」，并继续在对话中确认细节`);
        return parsed;
      }
      if (creatorLabel === "Skill Creator") {
        const name = text.replace(/^帮我创建[^：:]*[：:]\s*/, "").slice(0, 40) || "新技能";
        const nextConfig = await api.addFeatureItem({
          kind: "skills",
          item: {
            name,
            summary: text,
            status: "enabled",
            source: "conversation",
            scope: "global",
            path: ""
          }
        });
        setFeatureConfig(nextConfig);
        if (typeof setChatStatus === "function") setChatStatus(`已登记技能「${name}」，可在技能页继续完善`);
        return { name };
      }
      if (creatorLabel === "Plugin Creator") {
        if (typeof setChatStatus === "function") {
          setChatStatus("Plugin Creator：请在对话中说明插件能力；完成后可到插件页安装仓库插件或登记本地 manifest。");
        }
        return { ok: true };
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
    return null;
  }

  function submitComposerRequest(draft?: Parameters<typeof askModel>[0]) {
    const outbound = buildComposerSendDraft(draft);
    const question = String(outbound.question || "");
    const creatorLabel = String(outbound.skillContext || composerSkillContext || "").trim();
    const previousUserMessages = (conversationTurns || [])
      .map((turn: { user?: { content?: string } }) => String(turn?.user?.content || "").trim())
      .filter(Boolean);
    const automationText = creatorLabel === "Automation Creator"
      ? (resolveAutomationCreationText(question, previousUserMessages) || question.trim())
      : resolveAutomationCreationText(question, previousUserMessages);
    if (automationText && (creatorLabel === "Automation Creator" || isAutomationCreationRequest(question))) {
      void materializeCreatorFromChat(automationText, "Automation Creator");
    } else if (creatorLabel === "Skill Creator" || creatorLabel === "Plugin Creator") {
      void materializeCreatorFromChat(question, creatorLabel);
    }
    const sidebarRow = String(selectedSidebarRow || "");
    const inProjectConversationContext = isBrainConversationSelection
      || sidebarRow.startsWith("project-thread:");
    // An open INTERNAL_CHAT thread keeps receiving follow-ups in place; it is
    // not scene-bound, so the project routing below must not claim it.
    if (
      !inProjectConversationContext
      && !isComposingNewThread
      && selectedWorkspace?.id === INTERNAL_CHAT_WORKSPACE_ID
      && selectedThread?.id
    ) {
      setErrorMessage("");
      void askModel(outbound);
      if (!outbound.keepComposer) clearComposerAfterSend();
      return;
    }
    // Match NewBrain: sidebar "新对话 / 聊天 +" stays on INTERNAL_CHAT and must
    // never be redirected into the scene's project thread on send.
    const wantsStandaloneChat = !inProjectConversationContext
      && newThreadScope === "chat"
      && !chatUsesProject
      && (sidebarRow === "feature:new-chat" || isComposingNewThread);
    if (wantsStandaloneChat) {
      setErrorMessage("");
      void askModel({ ...outbound, forceStandaloneChat: true, brainWorkspaceKey: selectedBrainWorkspaceKey });
      if (!outbound.keepComposer) clearComposerAfterSend();
      return;
    }
    const executionBrainProject = resolveBrainProjectForWorkspace(brainProjects, selectedWorkspace?.id)
      ?? selectedBrainProject;
    const sceneWorkspace = resolveSceneExecutionWorkspace(
      normalizeWorkspaceCatalog(workspaceCatalog),
      selectedBrainWorkspaceKey,
      executionBrainProject?.localWorkspaceId,
      selectedWorkspace?.id
    );
    if (!sceneWorkspace) {
      // Project-scoped intent but this scene has no project: allow standalone
      // chat. Never borrow another scene's project (防串场).
      // askModel owns the new-thread decision; flipping compose mode here
      // strands the UI on the new-chat page when it reuses the current thread.
      setChatUsesProject?.(false);
      setNewThreadScope("chat");
      setErrorMessage("");
      setChatStatus("当前场景暂无项目，已使用独立聊天发送。");
      void askModel({ ...outbound, forceStandaloneChat: true, brainWorkspaceKey: selectedBrainWorkspaceKey });
      if (!outbound.keepComposer) clearComposerAfterSend();
      return;
    }
    if (sceneWorkspace.id !== selectedWorkspace?.id) {
      bindBrainProjectToWorkspace(sceneWorkspace.id);
      setSelectedWorkspaceId(sceneWorkspace.id);
      const threadId = resolveUserVisibleThreadSelection(sceneWorkspace.threads, null)?.id || "";
      setSelectedThreadId(threadId);
      setIsComposingNewThread(!threadId);
      if (outbound.keepComposer) {
        void askModel({ ...outbound, forceProjectThread: true, targetWorkspaceId: sceneWorkspace.id });
        setChatStatus(`已切换到“${selectedBrainWorkspace?.displayName || selectedBrainWorkspaceKey}”场景项目，修改要求已发送到对话。`);
        return;
      }
      setChatStatus(`已切换到“${selectedBrainWorkspace?.displayName || selectedBrainWorkspaceKey}”场景项目，请再次发送。`);
      return;
    }
    if (executionBrainProject && executionBrainProject.id !== selectedBrainProjectId) {
      setSelectedBrainProjectId(executionBrainProject.id);
    }
    if (inProjectConversationContext) {
      setNewThreadScope("project");
      setChatUsesProject?.(true);
    }
    void askModel(inProjectConversationContext ? { ...outbound, forceProjectThread: true } : outbound);
    if (!outbound.keepComposer) clearComposerAfterSend();
  }

  /** Video pipeline prompt fields → normal BRAIN composer / Auto / tools (not raw Kokoro). */
  const handoffVideoPipelineAi = (request: { question: string; kind?: string }) => {
    const question = String(request?.question || "").trim();
    if (!question) return;
    setChatStatus("已交给对话 Auto 处理…");
    setErrorMessage("");
    if (selectedBrainConversationId) {
      setSelectedSidebarRow(`brain-conversation:${selectedBrainConversationId}`);
    }
    const workspace = resolveSceneExecutionWorkspace(normalizeWorkspaceCatalog(workspaceCatalog), "video",
      selectedBrainProject?.localWorkspaceId, selectedWorkspace?.id);
    if (!workspace || workspace.brainWorkspaceKey !== "video") {
      setErrorMessage("视频工程尚未绑定，生成请求未发送到其他工程。");
      return;
    }
    void askModel({ question, forceProjectThread: true, targetWorkspaceId: workspace.id, brainWorkspaceKey: "video" });
  };

  function renderBrainChatModule() {
    return (
      <main className="brain-chat-module">
        <header className="brain-chat-header">
          <div>
            <span>{selectedBrainWorkspace?.displayName || "BRAIN 工作台"}</span>
            <strong>{selectedBrainConversation?.title || "新对话"}</strong>
          </div>
          <small>{selectedBrainProject?.name || "本地项目"} · 本地保存</small>
          <div className="brain-chat-header-actions">
            <button type="button" onClick={() => {
              setActiveFeature("new-chat");
              setNewThreadScope("chat");
              setIsComposingNewThread(true);
              setQuestion("");
            }}>新建对话</button>
            <button type="button" onClick={() => setProjectsCollapsed(false)}>项目管理</button>
            {selectedThread && selectedWorkspace ? <>
              <button type="button" onClick={() => void handleThreadMenuAction("pin", selectedWorkspace, selectedThread)}>
                {pinnedThreadIds.has(selectedThread.id) ? "取消置顶" : "置顶"}
              </button>
              <button type="button" onClick={() => void handleThreadMenuAction("archive", selectedWorkspace, selectedThread)}>归档</button>
            </> : null}
          </div>
        </header>
        <div className="brain-chat-message-scroll">
          {!brainMessages.length ? (
            <div className="brain-chat-welcome">
              <SidebarIcon name={brainWorkspaceIcon(selectedBrainWorkspaceKey)} />
              <h2>把问题交给 BRAIN</h2>
              <p>这段对话只保存在本机，并自动归入“{selectedBrainProject?.name || "当前项目"}”。</p>
            </div>
          ) : null}
          {brainMessages.map((message) => {
            let sources: any[] = [];
            try { sources = JSON.parse(message.sourceRefsJson || "[]"); } catch { sources = []; }
            return (
              <article key={message.id} className={`brain-chat-message ${message.role}`}>
                <span>{message.role === "user" ? "你" : message.role === "assistant" ? "BRAIN" : message.role}</span>
                <div>{message.content}</div>
                {sources.length ? (
                  <footer>
                    {sources.slice(0, 5).map((source, index) => (
                      <a key={`${message.id}:source:${index}`} href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>
                    ))}
                  </footer>
                ) : null}
              </article>
            );
          })}
          {brainMessageBusy ? <div className="brain-chat-working"><i />BRAIN 正在处理</div> : null}
        </div>
        <div className="brain-chat-composer-slot" ref={setBrainChatComposerHost} />
      </main>
    );
  }

  function renderBrainResourcePanel(placement: "side" | "center" = "side") {
    const taskStatusLabel: Record<string, string> = {
      QUEUED: "等待中", RUNNING: "运行中", SUCCEEDED: "已完成", FAILED: "失败", CANCELLED: "已取消"
    };
    const capabilityTabs = brainWorkspaceCapabilityTabs[selectedBrainWorkspaceKey] || [];
    const showCapability = (tabKey: string) => {
      setBrainResourcePlacement((current) => current === "hidden" ? "side" : current);
      setBrainSceneTab(tabKey);
      if (tabKey === "files") {
        setBrainResourceTab("files");
        return;
      }
      setBrainResourceTab("scene");
    };
    const isCenter = placement === "center";
    // Toggle: center = focus Tools (hide left nav via CSS, keep chat); side = restore full layout.
    const toggleBrainExpanded = () => {
      setBrainResourcePlacement((current) => {
        if (current === "center") {
          // Second click: restore nav + chat + side Tools. Force left nav visible even if
          // Ctrl+B had collapsed it before/during expand (CSS hide does not sync that flag).
          window.dispatchEvent(new CustomEvent("newbrain:app-command", { detail: { command: "expand-sidebar" } }));
          return "side";
        }
        return "center";
      });
    };
    const collapseBrainPanel = () => {
      setBrainResourcePlacement("hidden");
      if (isCenter) {
        setPreviewMode("empty");
        setPreviewPlacement("hidden");
      }
    };
    const isBrainAudioFile = (file: { logicalName?: string; storageKey?: string }) =>
      isAudioPreviewFileName(file.logicalName, file.storageKey);
    const selectBrainDocumentFile = (file: any, openPreview = true, options?: { keepMarkingActive?: boolean }) => {
      setActiveBrainDocumentFileId(file.id);
      if (!options?.keepMarkingActive) {
        setDocumentAnnotationActive(false);
        setDocumentAnnotationCandidate(null);
        setDocumentAnnotationInstruction("");
        setDocumentAnnotationGeometry(null);
        setDocumentAnnotationPendingMark(null);
      } else {
        setDocumentAnnotationCandidate(null);
        setDocumentAnnotationInstruction("");
        setDocumentAnnotationGeometry(null);
        setDocumentAnnotationPendingMark(null);
      }
      if (openPreview) {
        const workspaceId = selectedBrainProject?.localWorkspaceId
          || resourceBrainProject?.localWorkspaceId
          || selectedWorkspace?.id;
        openLocalFilePreview(file.storageKey, {
          ...(workspaceId ? { workspaceId } : {}),
          ...(file.logicalName ? { displayName: file.logicalName } : {})
        });
      }
      setBrainDocumentAnchors([]);
      if (selectedBrainProjectId && window.newbrain?.ingestBrainFile && !isBrainAudioFile(file)) {
        void window.newbrain.ingestBrainFile({ projectId: selectedBrainProjectId, fileId: file.id })
          .then((result) => { setBrainDocumentAnchors(result.anchors || []); if (result.warnings?.length) setChatStatus(result.warnings.join(" ")); })
          .catch((error: unknown) => setChatStatus(error instanceof Error ? error.message : "文档结构解析失败"));
      }
    };
    const deactivateDocumentMarking = () => {
      setDocumentAnnotationActive(false);
      setDocumentAnnotationCandidate(null);
      setDocumentAnnotationInstruction("");
      setDocumentAnnotationGeometry(null);
      setDocumentAnnotationPendingMark(null);
    };
    const activateDocumentMarkingInPreview = () => {
      const targetFile = brainFiles.find((file) => file.id === activeBrainDocumentFileId) || brainFiles[0];
      if (!targetFile) {
        setChatStatus("请先在「文件」中添加文档，再进行标注。");
        setBrainResourceTab("files");
        return;
      }
      selectBrainDocumentFile(targetFile, true, { keepMarkingActive: true });
      setDocumentAnnotationActive(true);
      setDocumentAnnotationCandidate(null);
      setDocumentAnnotationInstruction("");
      setDocumentAnnotationGeometry(null);
      setDocumentAnnotationPendingMark(null);
      setPreviewPlacement("center");
      window.setTimeout(() => {
        document.querySelector(".search-file-preview")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 120);
    };
    const toggleDocumentMarking = () => {
      if (documentAnnotationActive) deactivateDocumentMarking();
      else activateDocumentMarkingInPreview();
    };
    const renderPendingCapability = (label: string) => (
      <div className="brain-workspace-plugin-empty" data-testid="brain-capability-pending">
        <strong>{label}</strong>
        <span>该功能入口已按产品原型归位，正在接入对应的真实编辑与执行能力。</span>
      </div>
    );
    const renderSceneCapability = () => {
      if (selectedBrainWorkspaceKey === "quant") {
        return <QuantWorkspace projectId={resourceBrainProject?.id} workspaceId={resourceBrainProject?.localWorkspaceId || selectedWorkspace?.id} compact activeView={brainSceneTab as "market" | "portfolio" | "strategy" | "radar" | "research"} />;
      }
      // 场景学习探索无业务专属 Tools 页；右侧仅展示 NewBrain 原生文件/产物/任务。
      if (selectedBrainWorkspaceKey === "explore") {
        return null;
      }
      if (selectedBrainWorkspaceKey === "game") {
        if (brainSceneTab === "level") return <GameLevelEditor projectId={selectedBrainProject?.id} />;
        if (["project", "assets"].includes(brainSceneTab)) return <GameWorkspace projectId={selectedBrainProject?.id} conversationId={selectedBrainConversationId || undefined} />;
        if (brainSceneTab === "design") {
          return <WorkspaceSectionEditor projectId={selectedBrainProject?.id} workspaceKey="game" sectionKey="design" title="游戏策划" description="定义核心体验、循环、规则与版本范围" prompts={["核心体验", "核心循环", "玩家目标", "版本范围"]} />;
        }
        const gameSections: Record<string, { title: string; description: string; sectionKey: string }> = {
          world: { title: "角色与世界观", description: "维护世界规则、角色关系、势力与剧情线", sectionKey: "world" },
          combat: { title: "战斗设计", description: "管理玩家操作、敌人机制、数值目标与验证标准", sectionKey: "combat" }
        };
        const section = gameSections[brainSceneTab];
        return section
          ? <GameDesignPanel projectId={selectedBrainProject?.id} workspaceKey="game" sectionKey={section.sectionKey} title={section.title} description={section.description} />
          : renderPendingCapability(capabilityTabs.find((item) => item.key === brainSceneTab)?.label || "游戏制作");
      }
      if (selectedBrainWorkspaceKey === "video") {
        if (["script", "storyboard", "generate", "tracks", "mux", "export"].includes(brainSceneTab)) {
          const step = (brainSceneTab === "mux" || brainSceneTab === "export") ? "tracks" : brainSceneTab;
          return (
            <VideoPipelineShell
              projectId={selectedBrainProject?.id}
              files={brainFiles}
              activeStep={step as "script" | "storyboard" | "generate" | "tracks"}
              onFilesChanged={() => setDataWorkspaceRefreshToken((value) => value + 1)}
              onStepChange={(next) => setBrainSceneTab(next)}
              onAskBrain={handoffVideoPipelineAi}
              availableModels={Array.isArray(modelConfig.availableModels) ? modelConfig.availableModels : []}
              preferredVideoModel={String(modelConfig.model || "").trim()}
            />
          );
        }
        return renderPendingCapability(capabilityTabs.find((item) => item.key === brainSceneTab)?.label || "视频制作");
      }
      if (selectedBrainWorkspaceKey === "music") {
        if (["gen", "tracks", "slice", "export"].includes(brainSceneTab)) {
          return <MusicDawShell projectId={selectedBrainProject?.id} activeStep={brainSceneTab as "gen" | "tracks" | "slice" | "export"} refreshToken={dataWorkspaceRefreshToken} />;
        }
        return renderPendingCapability(capabilityTabs.find((item) => item.key === brainSceneTab)?.label || "音乐创作");
      }
      if (selectedBrainWorkspaceKey === "data") {
        if (brainSceneTab === "analysis") return <DataJuliusShell projectId={selectedBrainProject?.id} files={brainFiles} refreshToken={dataWorkspaceRefreshToken} />;
        if (brainSceneTab === "flow") return <FlowWorkspace projectId={selectedBrainProject?.id} />;
        if (["import", "table", "clean", "chart"].includes(brainSceneTab)) {
          return <DataWorkspace projectId={selectedBrainProject?.id} files={brainFiles} selectedFileId={activeBrainDocumentFileId} onSelectFile={setActiveBrainDocumentFileId} activeView={brainSceneTab as "import" | "table" | "clean" | "chart"} refreshToken={dataWorkspaceRefreshToken} />;
        }
        return renderPendingCapability(capabilityTabs.find((item) => item.key === brainSceneTab)?.label || "数据与决策");
      }
      if (selectedBrainWorkspaceKey === "software") {
        if (brainSceneTab === "flow") return <FlowWorkspace projectId={selectedBrainProject?.id} />;
        if (["terminal", "code", "test", "deploy", "files"].includes(brainSceneTab)) {
          return <SoftwareWorkspace
            projectId={selectedBrainProject?.id}
            activeView={brainSceneTab as "terminal" | "code" | "test" | "deploy" | "files"}
            files={brainFiles}
            onOpenFiles={() => setBrainResourceTab("files")}
          />;
        }
        return renderPendingCapability(capabilityTabs.find((item) => item.key === brainSceneTab)?.label || "软件与自动化");
      }
      if (selectedBrainWorkspaceKey === "document") {
        if (brainSceneTab === "preview") {
          return <DocumentWorkspace
            activeView="review"
            files={brainFiles}
            activeFileId={activeBrainDocumentFileId}
            availableAnchors={brainDocumentAnchors}
            annotations={brainAnnotations}
            changeSets={brainChangeSets}
            preview={brainChangeSetPreview}
            busy={documentAnnotationBusy}
            annotationActive={documentAnnotationActive}
            onOpenFiles={() => setBrainResourceTab("files")}
            onSelectFile={selectBrainDocumentFile}
            onSelectAnchor={() => { activateDocumentMarkingInPreview(); }}
            onToggleAnnotation={toggleDocumentMarking}
            onSendAnnotation={sendDocumentAnnotationToChat}
            onPreviewChangeSet={(changeSet) => void previewDocumentChangeSet(changeSet)}
            onReviewChangeSet={(changeSet, status) => void reviewDocumentChangeSet(changeSet, status)}
            onExportChangeSet={(changeSet) => void exportDocumentChangeSet(changeSet)}
          />;
        }
        const documentView = brainSceneTab === "files" ? "project" : "review";
        return <DocumentWorkspace
          activeView={documentView as "project" | "review"}
          files={brainFiles}
          activeFileId={activeBrainDocumentFileId}
          availableAnchors={brainDocumentAnchors}
          annotations={brainAnnotations}
          changeSets={brainChangeSets}
          preview={brainChangeSetPreview}
          busy={documentAnnotationBusy}
          annotationActive={documentAnnotationActive}
          onOpenFiles={() => setBrainResourceTab("files")}
          onSelectFile={selectBrainDocumentFile}
          onSelectAnchor={() => { activateDocumentMarkingInPreview(); }}
          onToggleAnnotation={toggleDocumentMarking}
          onSendAnnotation={sendDocumentAnnotationToChat}
          onPreviewChangeSet={(changeSet) => void previewDocumentChangeSet(changeSet)}
          onReviewChangeSet={(changeSet, status) => void reviewDocumentChangeSet(changeSet, status)}
          onExportChangeSet={(changeSet) => void exportDocumentChangeSet(changeSet)}
        />;
      }
      return renderPendingCapability(capabilityTabs.find((item) => item.key === brainSceneTab)?.label || "工作台");
    };
    return (
      <aside className={`brain-resource-panel${isCenter ? " center" : ""}`} ref={isCenter ? undefined : attachBrainResourcePanel} data-placement={placement} data-workspace={selectedBrainWorkspaceKey}>
        {isCenter ? null : (
          <button
            type="button"
            className="brain-resource-resize-handle"
            aria-label="调整右侧面板宽度"
            title="拖动调整右侧面板宽度"
            onPointerDown={resizeBrainResourcePanel}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              setBrainResourceWidth((current) => Math.max(320, Math.min(760, current + (event.key === "ArrowLeft" ? 24 : -24))));
            }}
          />
        )}
        <header className="brain-resource-header">
          <div className="brain-resource-header-copy">
            <strong>{selectedBrainProject?.name || "项目资源"}</strong>
            <small>仅保存在本机</small>
          </div>
          <nav className="brain-resource-global-nav" aria-label="通用功能">
          {capabilityTabs.length ? <button type="button" className={brainResourceTab === "scene" ? "active" : ""} onClick={() => showCapability(brainSceneTab)}>Tools</button> : null}
          <button type="button" className={brainResourceTab === "files" ? "active" : ""} onClick={() => { setBrainResourcePlacement((current) => current === "hidden" ? "side" : current); setBrainResourceTab("files"); }}>文件 <em>{brainFiles.length}</em></button>
          <button type="button" className={brainResourceTab === "artifacts" ? "active" : ""} onClick={() => { setBrainResourcePlacement((current) => current === "hidden" ? "side" : current); setBrainResourceTab("artifacts"); }}>产物 <em>{brainArtifacts.length}</em></button>
          <button type="button" className={brainResourceTab === "tasks" ? "active" : ""} onClick={() => { setBrainResourcePlacement((current) => current === "hidden" ? "side" : current); setBrainResourceTab("tasks"); }}>任务 <em>{brainTasks.length}</em></button>
        </nav>
          <div className={`preview-header-actions ${isCenter ? "expanded" : "sidebar"}`} aria-label="工作区操作">
            <button
              className={`preview-icon-button brain-resource-expand-toggle${isCenter ? " is-expanded" : ""}`}
              type="button"
              title={isCenter ? "还原布局" : "展开预览"}
              aria-label={isCenter ? "还原布局" : "展开预览"}
              aria-pressed={isCenter}
              data-testid="brain-resource-expand-toggle"
              onClick={toggleBrainExpanded}
            >
              <SidebarIcon name={isCenter ? "minimize" : "maximize"} />
            </button>
            <button
              className="preview-icon-button preview-panel-toggle"
              type="button"
              title="隐藏侧栏"
              aria-label="隐藏侧栏"
              onClick={collapseBrainPanel}
            >
              <span className="preview-panel-glyph visible"><SidebarIcon name="panel-right" /></span>
            </button>
          </div>
        </header>
        {capabilityTabs.length ? (
          brainResourceTab === "scene" ? (
            <nav className="brain-resource-scene-nav" aria-label="当前工作台功能">
              {capabilityTabs.map((tab) => (
                <button key={tab.key} type="button" className={brainSceneTab === tab.key ? "active" : ""} onClick={() => showCapability(tab.key)}>{tab.label}</button>
              ))}
            </nav>
          ) : (
            <div className="brain-resource-scene-shortcuts" aria-label="工作台功能入口">
              <span>工作台</span>
              {capabilityTabs.map((tab) => (
                <button key={tab.key} type="button" onClick={() => showCapability(tab.key)}>{tab.label}</button>
              ))}
            </div>
          )
        ) : null}
        <div className={`brain-resource-list${brainResourceTab === "scene" ? " scene-plugin" : ""}`}>
          {brainResourceTab === "scene" ? renderSceneCapability() : null}
          {brainResourceTab === "files" ? brainFiles.map((file) => (
            <button key={file.id} type="button" className={`brain-resource-row${activeBrainDocumentFileId === file.id ? " selected" : ""}`} onClick={() => selectBrainDocumentFile(file)}>
              <SidebarIcon name="file" />
              <span><strong>{file.logicalName}</strong><small>版本 {file.versionNo} · {(file.sizeBytes / 1024).toFixed(file.sizeBytes >= 1024 ? 1 : 0)} KB</small></span>
              <em>{file.validationStatus}</em>
            </button>
          )) : null}
          {brainResourceTab === "artifacts" ? brainArtifacts.map((artifact) => (
            <div key={artifact.id} className="brain-resource-row">
              <SidebarIcon name="file-check" />
              <span><strong>{artifact.artifactType}</strong><small>{artifact.storageKey}{artifact.sourceWorkspaceKey ? ` · 来源 ${artifact.sourceWorkspaceKey}` : ""}</small></span>
              <em>{artifact.validationStatus}</em>
            </div>
          )) : null}
          {brainResourceTab === "tasks" ? brainTasks.map((task) => (
            <button key={task.id} type="button" className="brain-resource-row brain-task-row" onClick={() => void openDocumentRevisionTask(task)}>
              <SidebarIcon name={task.status === "RUNNING" ? "automation" : "list-status"} />
              <span><strong>{task.taskType}</strong><small>{Math.round(task.progress * 100)}% · {taskStatusLabel[task.status] || task.status}</small></span>
              <em>{task.errorCode || ""}</em>
            </button>
          )) : null}
          {brainResourceTab === "files" && !brainFiles.length ? <div className="brain-resource-empty">项目还没有文件</div> : null}
          {brainResourceTab === "artifacts" && !brainArtifacts.length ? <div className="brain-resource-empty">生成产物会显示在这里</div> : null}
          {brainResourceTab === "tasks" && !brainTasks.length ? <div className="brain-resource-empty">当前没有执行任务</div> : null}
        </div>
      </aside>
    );
  }

function renderChatModule() {
    return (
      <section className={`task-column${isNewChatMode ? " new-chat-task" : ""}${pptxChatCollapsed && searchFilePreview?.kind === "pptx" ? " pptx-chat-collapsed" : ""}`}>
        <header className="task-topbar">
          <div className="task-thread-title">
            <span className="task-topbar-kicker">当前工作区</span>
            <strong>{taskTitle}</strong>
          </div>
          <div className="task-topbar-actions">
            {renderPreviewHeaderActions("topbar")}
          </div>
        </header>

        <div className="task-scroll" ref={taskScrollRef} data-testid="task-scroll">
          {errorMessage
            && !(ctx.generationFailure && ctx.generationFailure.threadId === selectedThread?.id)
            && !isComposerAttachmentErrorMessage(errorMessage)
            ? <div className="error-banner" data-testid="task-error-banner">{errorMessage}</div>
            : null}
          {isNewChatMode ? (
            <div className="new-chat-canvas">
              <h1>{newChatTitle}</h1>
              <div className="new-chat-composer-shell">
              <div className="new-chat-composer-slot" ref={setNewChatComposerHost} />
              <div className={`new-chat-project-row ${newThreadScope === "chat" ? "chat-scope" : "project-scope"}`} ref={newChatProjectRowRef}>
                <div className="new-chat-project-picker">
                  <button type="button" aria-expanded={newChatProjectMenu === "workspace"} onClick={() => openNewChatProjectMenu("workspace")}>
                    <SidebarIcon name="folder" />
                    <strong>{newThreadScope === "chat" && !chatUsesProject ? "Choose project" : selectedProjectWorkspace?.name ?? "Choose project"}</strong>
                    <em><SidebarIcon name="chevron-down" /></em>
                  </button>
                  {newChatProjectMenu === "workspace" ? (
                    <div className="new-chat-project-menu">
                      {sceneVisibleWorkspaceCatalog.map((workspace: any) => (
                        <button key={workspace.id} type="button" className={chatUsesProject && workspace.id === selectedWorkspace?.id ? "active" : ""} onClick={() => { setSelectedWorkspaceId(workspace.id); setChatUsesProject?.(true); setNewThreadScope(newThreadScope === "chat" ? "chat" : "project"); setNewChatProjectMenu(null); }}>
                          <SidebarIcon name="folder" />
                          <span>{workspace.name}</span>
                          <em>{chatUsesProject && workspace.id === selectedWorkspace?.id ? "✓" : ""}</em>
                        </button>
                      ))}
                      {newThreadScope === "chat" ? <div className="new-chat-project-menu-divider" /> : null}
                      {newThreadScope === "chat" ? (
                        <button type="button" className={!chatUsesProject ? "active" : ""} onClick={() => { setChatUsesProject?.(false); setNewThreadScope("chat"); setNewChatProjectMenu(null); }}>
                          <span aria-hidden="true">×</span>
                          <span>不使用项目</span>
                          <em>{!chatUsesProject ? "✓" : ""}</em>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="new-chat-project-picker">
                  <button type="button" aria-expanded={newChatProjectMenu === "local"} onClick={() => openNewChatProjectMenu("local")}>
                    <SidebarIcon name="computer" />
                    <strong>本地模式</strong>
                    <em><SidebarIcon name="chevron-down" /></em>
                  </button>
                  {newChatProjectMenu === "local" ? (
                    <div className="new-chat-project-menu local-menu">
                      <span className="new-chat-project-menu-label">启动模式</span>
                      <button type="button" className="active" onClick={() => setNewChatProjectMenu(null)}>
                        <SidebarIcon name="computer" />
                        <span>在本地处理</span>
                        <em>✓</em>
                      </button>
                      <button type="button" onClick={() => { setNewChatProjectMenu(null); setBlankProjectDialogOpen(true); }}>
                        <SidebarIcon name="git-worktree" />
                        <span>新工作树</span>
                        <em />
                      </button>
                      <div className="new-chat-project-menu-divider" />
                      <button type="button" aria-expanded={localModeUsageOpen} onClick={() => setLocalModeUsageOpen((current) => !current)}>
                        <SidebarIcon name="search" />
                        <span>剩余用量</span>
                        <em>›</em>
                      </button>
                      {localModeUsageOpen ? (
                        <div className="local-usage-details">
                          {dailyBalance ? (
                            <div>
                              <strong>每日额度</strong>
                              <span>{dailyBalance.percent}%</span>
                              <em>{dailyBalance.remaining} / {dailyBalance.quota}</em>
                            </div>
                          ) : (
                            <div><strong>用量暂不可用</strong><span>--</span><em>请稍后重试</em></div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="new-chat-project-picker">
                  <button type="button" aria-expanded={newChatProjectMenu === "branch"} onClick={() => openNewChatProjectMenu("branch")}>
                    <SidebarIcon name="branch" />
                    <strong>{workspaceHeaderStatus?.branch || newChatBranches.current || "main"}</strong>
                    <em><SidebarIcon name="chevron-down" /></em>
                  </button>
                  {newChatProjectMenu === "branch" ? (
                    <div className="new-chat-project-menu branch-menu">
                      {(newChatBranches.branches.length ? newChatBranches.branches : [workspaceHeaderStatus?.branch || "main"]).map((branch: string) => (
                        <button key={branch} type="button" className={branch === (newChatBranches.current || workspaceHeaderStatus?.branch) ? "active" : ""} onClick={() => setNewChatProjectMenu(null)}>
                          <SidebarIcon name="branch" />
                          <span>{branch}</span>
                          <em>{branch === (newChatBranches.current || workspaceHeaderStatus?.branch) ? "✓" : ""}</em>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              </div>
              <div className="new-chat-integrations" aria-label="连接常用应用">
                <button type="button" onClick={openIntegrationSettings}>
                  <span className="integration-logo slack" aria-hidden="true">✣</span>
                  <strong>连接消息传送</strong>
                  <small>了解工程对话线程动态</small>
                </button>
                <button type="button" onClick={openIntegrationSettings}>
                  <span className="integration-logo github" aria-hidden="true">●</span>
                  <strong>连接 GitHub</strong>
                  <small>审查 PR、代码和 CI 检查项</small>
                </button>
                <button type="button" onClick={openIntegrationSettings}>
                  <span className="integration-logo linear" aria-hidden="true">◒</span>
                  <strong>连接 Linear</strong>
                  <small>跟踪缺陷和实施工作</small>
                </button>
              </div>
            </div>
          ) : (
          <div className="conversation-history">
            {goalExecution?.runtime?.selectedSkillNames?.length ? (
              <div className="goal-skill-record" data-testid="goal-skill-record">
                本轮使用 Skill：{goalExecution.runtime.selectedSkillNames.map((name: string) => name === RESEARCH_WRITING_SKILL ? "政务写作" : name).join("、")}
              </div>
            ) : null}
            {goalExecution?.goal?.status === "complete" && goalExecution?.plan?.length ? (
              <section className="goal-context-card completed" aria-label="已完成的目标步骤" data-testid="goal-runtime-panel-complete">
                <header className="goal-context-header"><div><strong>已完成的目标</strong><span>{goalExecution.goal.objective}</span></div><div className="goal-context-actions"><span>{goalExecution.plan.length}/{goalExecution.plan.length} 步</span></div></header>
                <ol>{goalExecution.plan.map((step: any) => <li key={`completed-goal-${step.stepId}`} className={step.status}><span>✓</span><div><strong>{step.title}</strong><small>{step.result || step.description}</small></div></li>)}</ol>
              </section>
            ) : null}
            {conversationTurns.map((turn, index) => {
              const turnAssistantActivities = dedupeActivities(
                persistedActivitiesByUserMessage.get(turn.user?.id || "") ?? []
              );
              const turnDetailPanelActivities = turnAssistantActivities.filter(
                (activity: any) => typeof activity.contentOffset !== "number"
              );
              const isLiveTurn = isAskingModel && index === conversationTurns.length - 1;
              return (
              <section className={`conversation-turn${isLiveTurn ? " current" : ""}`} key={turn.id}>
                {turn.user ? (
                  <div className="request-row history-item">
                    <div className="request-stack">
                      {turn.user.attachments?.length ? (
                        <div className="request-attachments">
                          {turn.user.attachments.map((attachment) => {
                            const kind = getAttachmentKind(attachment);
                            return (
                              <button
                                key={attachment.path}
                                type="button"
                                className={kind.tone === "image" ? "request-image-attachment" : `request-file-card type-${kind.tone}`}
                                title={attachment.name}
                                onClick={async () => {
                                  if (kind.tone === "image") {
                                    setImagePreview(attachment);
                                    return;
                                  }
                                  const result = await api.openComposerAttachment({ path: attachment.path });
                                  if (!result.ok) setChatStatus(result.detail || "附件无法打开");
                                }}
                              >
                                {kind.tone === "image" ? (
                                  <img src={attachment.url} alt={attachment.name} />
                                ) : (
                                  <span className="request-file-attachment">
                                    <strong>{kind.icon}</strong>
                                    <span>{attachment.name}</span>
                                    <em>{kind.label}</em>
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {editingUserMessageId === turn.user.id ? (
                        <div className="request-edit" data-testid="user-message-edit">
                          <textarea
                            value={editingUserDraft}
                            aria-label="编辑问题"
                            rows={Math.min(8, Math.max(2, editingUserDraft.split("\n").length))}
                            onChange={(event) => setEditingUserDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelEditUserMessage();
                              } else if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                void submitEditedUserMessage(turn);
                              }
                            }}
                            autoFocus
                          />
                          <div className="request-edit-actions">
                            <button type="button" onClick={cancelEditUserMessage}>取消</button>
                            <button
                              type="button"
                              className="request-edit-send"
                              aria-label="发送修改后的问题"
                              disabled={!editingUserDraft.trim()}
                              onClick={() => void submitEditedUserMessage(turn)}
                            >
                              发送
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="request-bubble">{turn.user.content}</div>
                      )}
                      {editingUserMessageId === turn.user.id ? null : (
                      <div className="request-actions" aria-label="问题操作">
                        <button
                          type="button"
                          title={copiedUserMessageId === turn.user.id ? "已复制" : "复制问题"}
                          aria-label={copiedUserMessageId === turn.user.id ? "已复制" : "复制问题"}
                          className="message-action-copy"
                          onClick={() => copyUserMessage(turn.user!.id, turn.user!.content)}
                        >
                          <SidebarIcon name={copiedUserMessageId === turn.user.id ? "check" : "copy"} />
                        </button>
                        <button
                          type="button"
                          title="编辑问题"
                          aria-label="编辑问题"
                          className="message-action-edit"
                          onClick={() => beginEditUserMessage(turn.user!.id, turn.user!.content)}
                        >
                          <SidebarIcon name="edit" />
                        </button>
                      </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {turn.tools?.length ? (
                  <div className="tool-result-group history-item">
                    {turn.tools.map((toolMessage) => (
                      <article key={toolMessage.id} className="tool-result-card">
                        <div className="tool-result-head">
                          <strong>{toolMessage.toolName || "MCP 工具"}</strong>
                          <span>工具结果</span>
                        </div>
                        <pre>{toolMessage.content}</pre>
                      </article>
                    ))}
                  </div>
                ) : null}

                {turn.assistant && turn.assistant.id !== "assistant-pending" ? (
                  <div className={`answer-group history-item${isLiveTurn ? " streaming" : ""}${turn.assistant.excludeFromModelContext ? " interrupted" : ""}`}>
                    {(() => {
                      const detailsExpanded = expandedAssistantTurns.has(turn.id)
                        || (goalOwnerTurnId === turn.id && Boolean(goalExecution?.pendingQuestion));
                      const canToggleDetails = Boolean(
                        (turn.tools?.length ?? 0) > 0
                        || turnAssistantActivities.length > 0
                        || turn.assistant.reasoningSummary?.trim()
                        || isLiveTurn
                      );
                      return (
                    <>
                    <div className="handled-row">
                      <button
                        type="button"
                        data-testid="assistant-details-toggle"
                        className={`handled-row-toggle${detailsExpanded ? " expanded" : ""}`}
                        disabled={!canToggleDetails}
                        aria-expanded={detailsExpanded}
                        title={detailsExpanded ? "收起详情" : "展开详情"}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleAssistantTurnDetails(turn.id);
                        }}
                      >
                        ›
                      </button>
                      <span>{isLiveTurn
                        ? `${effectiveApproval ? "等待批准" : approvalResponding ? "正在继续执行" : `正在思考`}${liveElapsedSeconds ? ` ${formatElapsed(liveElapsedSeconds)}` : ""}`
                        : `${turn.assistant.excludeFromModelContext
                          ? "生成中断"
                          : snapshot?.approval && index === conversationTurns.length - 1 ? "等待批准" : "已处理"} ${index === conversationTurns.length - 1 && lastAssistantElapsedSeconds ? formatElapsed(lastAssistantElapsedSeconds) : formatRelativeTimeLabel(turn.assistant?.createdAt || turn.user?.createdAt)}`}</span>
                      <span>›</span>
                    </div>
                    {!isLiveTurn && detailsExpanded && turn.assistant.reasoningSummary?.trim() ? (
                      <div data-testid="reasoning-summary">
                        <AssistantThinkingPanel
                          text={buildLiveReasoningProcess(turn.assistant.reasoningSummary)}
                          live={false}
                          hasAnswer={Boolean(sanitizeVisibleModelContent(turn.assistant.content).trim())}
                          statusLabel="思考过程"
                        />
                      </div>
                    ) : null}
                    {!isLiveTurn && detailsExpanded && ((turn.tools?.length ?? 0) > 0 || turnDetailPanelActivities.length > 0) ? (
                      <div className="assistant-activity-panel compact">
                        <div className="assistant-activity-summary">
                          <span>
                            已编辑 {turnAssistantActivities.filter((item: any) => item.type === "patch").length} 个文件
                          </span>
                          <span>
                            已运行 {turnAssistantActivities.filter((item: any) => item.type === "run" && (["已执行命令", "已运行命令", "命令执行失败"].includes(item.title))).length} 条命令
                          </span>
                          {turnAssistantActivities.some((item: any) => item.type === "patch") ? (
                            <button type="button" onClick={() => setReviewDrawerOpen(true)}>审核变更</button>
                          ) : null}
                        </div>
                        <div
                          className="assistant-activity-scroll"
                          ref={activityScrollRef}
                        >
                          {turn.tools?.map((toolMessage: any) => (
                            <div className="assistant-activity-row tool" key={`tool-context-${toolMessage.id}`}>
                              <SidebarIcon name="chevron-right" />
                              <span>{toolMessage.toolName || "MCP 工具"}</span>
                              <code>{toolMessage.content}</code>
                            </div>
                          ))}
                          {turnDetailPanelActivities.map((activity: any, activityIndex: number) => {
                              return renderActivityRow(activity, `${activity.title}-${activity.detail}-${activityIndex}`);
                          })}
                        </div>
                      </div>
                    ) : null}
                    {isLiveTurn && !effectiveApproval ? (
                      <div className="assistant-live-progress">
                        {(() => {
                          const liveAnswer = sanitizeVisibleModelContent(activeStreamContent || turn.assistant.content);
                          const planningFallback = activeStreamContent.trim() && !liveAnswer
                            ? activeStreamContent.trim()
                            : "";
                          const liveThinking = buildLiveReasoningProcess(
                            activeReasoningSummary || turn.assistant.reasoningSummary || "",
                            dedupedAssistantActivities,
                            planningFallback
                          );
                          const processSteps = formatLiveProcessSteps(dedupedAssistantActivities);
                          return (
                            <AssistantThinkingPanel
                              text={liveThinking}
                              processSteps={processSteps}
                              live
                              hasAnswer={Boolean(liveAnswer.trim())}
                              statusLabel={approvalResponding ? "正在继续执行" : (liveAnswer.trim() ? "思考过程" : "正在思考")}
                              elapsedLabel={liveElapsedSeconds ? formatElapsed(liveElapsedSeconds) : ""}
                              testId="reasoning-summary-live"
                            />
                          );
                        })()}
                      </div>
                    ) : null}
                    {!isAskingModel
                      ? renderFileChangeContext(turn.id, turnAssistantActivities)
                      : null}
                    {index === conversationTurns.length - 1 && effectiveApproval ? (
                      <section
                        className="approval-request-banner conversation-approval-banner"
                        aria-live="polite"
                        role="dialog"
                        aria-label="命令审批"
                        data-testid="conversation-approval-dialog"
                      >
                        <div className="approval-request-main">
                          <header className="approval-request-heading">
                            <span>需要批准</span>
                            <em data-risk={approvalTool?.risk || "unknown"}>{approvalRiskLabel}</em>
                          </header>
                          <strong>{approvalUx.reasonText}</strong>
                          <small>请在当前对话中批准后继续；仅批准本次操作 · 权限范围：{approvalScopeLabel}</small>
                          {approvalUx.categoryLabels.length ? (
                            <div className="approval-category-tags" data-testid="conversation-approval-tags">
                              {approvalUx.categoryLabels.map((label) => <span key={label}>{label}</span>)}
                            </div>
                          ) : null}
                          {approvalUx.memoryHint ? <small className="approval-memory-hint">{approvalUx.memoryHint}</small> : null}
                          {approvalCommand ? (
                            <div className={`approval-command-shell${approvalCommandExpanded ? " expanded" : ""}`}>
                              <code className="approval-command-preview">{approvalCommand}</code>
                              {approvalCommand.length > 120 || approvalCommand.includes("\n") ? (
                                <button
                                  type="button"
                                  className="approval-command-toggle"
                                  aria-expanded={approvalCommandExpanded}
                                  onClick={() => setApprovalCommandExpanded((current) => !current)}
                                >
                                  {approvalCommandExpanded ? "收起命令" : "展开命令"}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {approvalError ? <small className="approval-error-text">{approvalError}</small> : null}
                        </div>
                        <div className="approval-request-actions">
                          {approvalResponding ? (
                            <button type="button" data-testid="conversation-approval-cancel-button" onClick={() => void cancelCurrentModelRequest()}>停止</button>
                          ) : (
                            <>
                              <button type="button" data-testid="conversation-approval-reject-button" onClick={() => void handleApprovalResponse(false)}>拒绝</button>
                              <button className="primary" type="button" data-testid="conversation-approval-approve-button" onClick={() => void handleApprovalResponse(true)}>批准并继续</button>
                            </>
                          )}
                        </div>
                      </section>
                    ) : null}
                    {(() => {
                      const renderedContentRaw = isLiveTurn
                        ? sanitizeVisibleModelContent(activeStreamContent || turn.assistant.content)
                        : sanitizeVisibleModelContent(turn.assistant.content);
                      const stillWaitingForApproval = index === conversationTurns.length - 1
                        && Boolean(effectiveApproval)
                        && !approvalResponding;
                      const renderedContent = stillWaitingForApproval
                        ? renderedContentRaw
                        : stripApprovalWaitNotice(renderedContentRaw);
                      // Never leave a blank hole under the user bubble: live empty stays on
                      // the thinking panel; finished empty gets an explicit fallback.
                      if (isLiveTurn && !renderedContent.trim()) return null;
                      const displayContent = renderedContent.trim()
                        ? renderedContent
                        : (turn.assistant.excludeFromModelContext
                          ? "本轮生成已中断，内容未完整保留。请再发一条消息继续。"
                          : "本轮没有生成可见回复。请再发一条消息继续，或重新描述你的需求。");
                      return (
                    <article
                      className={`assistant-block${ttsFollow?.scope === "message" && ttsFollow.messageId === turn.assistant.id ? " tts-following" : ""}`}
                      data-message-id={turn.assistant.id}
                      data-tts-message={turn.assistant.id}
                      data-content-length={turn.assistant.content.length}
                      data-rendered-content-length={displayContent.length}
                      data-empty-fallback={!renderedContent.trim() ? "true" : undefined}
                    >
                      <MarkdownMessage content={displayContent} workspaceId={selectedWorkspace?.id} onOpenLocalFile={openLocalFilePreview} isStreaming={isLiveTurn && Boolean(renderedContent)} />
                      <div
                        className="message-actions"
                        hidden={isLiveTurn}
                      >
                        <button
                          type="button"
                          title="有帮助"
                          className={`message-action-positive${messageFeedback[turn.assistant.id] === "helpful" ? " active" : ""}`}
                          aria-pressed={messageFeedback[turn.assistant.id] === "helpful"}
                          disabled={turn.assistant.id === "assistant-pending"}
                          onClick={() => void submitAssistantFeedback(turn.assistant!.id, "helpful")}
                        >
                          <SidebarIcon name="thumb-up" />
                        </button>
                        <button
                          type="button"
                          title="没有帮助"
                          className={`message-action-negative${messageFeedback[turn.assistant.id] === "unhelpful" ? " active" : ""}`}
                          aria-pressed={messageFeedback[turn.assistant.id] === "unhelpful"}
                          disabled={turn.assistant.id === "assistant-pending"}
                          onClick={() => void submitAssistantFeedback(turn.assistant!.id, "unhelpful")}
                        >
                          <SidebarIcon name="thumb-down" />
                        </button>
                        <button
                          type="button"
                          title="分叉答案"
                          className="message-action-branch"
                          disabled={!api || !selectedWorkspace || !selectedThread || turn.assistant.id === "assistant-pending"}
                          onClick={() => void forkCurrentAnswer()}
                        >
                          <SidebarIcon name="branch" />
                        </button>
                        <button
                          type="button"
                          title="复制答案"
                          className="message-action-copy"
                          onClick={() => {
                            writeClipboard(sanitizeVisibleModelContent(turn.assistant!.content));
                            setChatStatus("复制成功");
                          }}
                        >
                          <SidebarIcon name="copy" />
                        </button>
                        <NovelTtsButton
                          className="message-action-tts"
                          disabled={turn.assistant.id === "assistant-pending"}
                          text={sanitizeVisibleModelContent(turn.assistant.content)}
                          sourceText={sanitizeVisibleModelContent(turn.assistant.content)}
                          synthesizer={api?.synthesizeNovelSpeech}
                          canceller={api?.cancelNovelSpeech}
                          onStatus={setChatStatus}
                          onFollow={(target) => applyTtsFollow("message", turn.assistant!.id, target)}
                        />
                      </div>
                    </article>
                      );
                    })()}
                    </>
                      );
                    })()}
                  </div>
                ) : !isLiveTurn && turn.user && !turn.assistant ? (
                  <div className="answer-group history-item interrupted" data-testid="missing-assistant-fallback">
                    <div className="handled-row">
                      <span>生成中断 {formatRelativeTimeLabel(turn.user?.createdAt)}</span>
                      <span>›</span>
                    </div>
                    <article className="assistant-block" data-empty-fallback="true">
                      <MarkdownMessage
                        content="本轮没有生成可见回复。结果可能在等待批准或异常时丢失，请再发一条消息继续。"
                        workspaceId={selectedWorkspace?.id}
                        onOpenLocalFile={openLocalFilePreview}
                      />
                    </article>
                  </div>
                ) : turn.assistant?.id === "assistant-pending" ? (
                  <div className="answer-group history-item streaming">
                    <div className="handled-row">
                      <span>正在思考{liveElapsedSeconds ? ` ${formatElapsed(liveElapsedSeconds)}` : ""}</span>
                      <span>›</span>
                    </div>
                    <div className="assistant-live-progress">
                      {(() => {
                        const liveAnswer = sanitizeVisibleModelContent(activeStreamContent);
                        const planningFallback = activeStreamContent.trim() && !liveAnswer
                          ? activeStreamContent.trim()
                          : "";
                        const liveThinking = buildLiveReasoningProcess(
                          activeReasoningSummary,
                          visibleAssistantActivities,
                          planningFallback
                        );
                        const processSteps = formatLiveProcessSteps(visibleAssistantActivities);
                        return (
                          <AssistantThinkingPanel
                            text={liveThinking}
                            processSteps={processSteps}
                            live
                            hasAnswer={Boolean(liveAnswer.trim())}
                            statusLabel={liveAnswer.trim() ? "思考过程" : "正在思考"}
                            elapsedLabel={liveElapsedSeconds ? formatElapsed(liveElapsedSeconds) : ""}
                            testId="reasoning-summary-live"
                          />
                        );
                      })()}
                    </div>
                    {sanitizeVisibleModelContent(activeStreamContent) ? (
                      <article className="assistant-block streaming-output">
                        <MarkdownMessage content={sanitizeVisibleModelContent(activeStreamContent)} workspaceId={selectedWorkspace?.id} onOpenLocalFile={openLocalFilePreview} isStreaming />
                      </article>
                    ) : null}
                  </div>
                ) : null}
          {goalOwnerTurnId === turn.id && goalExecution?.runtime?.selectedSkillNames?.length ? (
            <div className="goal-skill-record" data-testid="goal-skill-record">
              本轮使用 Skill：{goalExecution.runtime.selectedSkillNames.map((name: string) => name === RESEARCH_WRITING_SKILL ? "政务写作" : name).join("、")}
            </div>
          ) : null}
          {showGovernmentSpecification && index === conversationTurns.length - 1 ? (
            <GovernmentWritingSpecification
              snapshot={governmentSpecification}
              busy={governmentSpecificationBusy || isAskingModel}
              onSave={async (content, source) => {
                setGovernmentSpecificationBusy(true);
                try {
                  const snapshot = await api.saveGovernmentWritingSpecification({
                    threadId: selectedThread?.id,
                    goalId: goalExecution.goal.goalId,
                    currentVersionId: governmentSpecification.currentVersionId,
                    source,
                    changeSummary: source === "user-markdown" ? "用户通过Markdown修改" : "用户直接修改",
                    content
                  });
                  setGovernmentSpecification(snapshot);
                } finally { setGovernmentSpecificationBusy(false); }
              }}
              onConfirm={async (versionId) => {
                setGovernmentSpecificationBusy(true);
                try {
                  const snapshot = await api.confirmGovernmentWritingSpecification({ threadId: selectedThread?.id, goalId: goalExecution.goal.goalId, versionId });
                  setGovernmentSpecification(snapshot);
                  const draft = { threadId: selectedThread?.id || "", question: "确认并开始写作", images: [], tools: [], skill: null, skillContext: "", modes: ["goal"], createdAt: new Date().toISOString() };
                  void askModel(draft);
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  setChatStatus(`规格确认失败：${message}`);
                  setErrorMessage(message);
                } finally { setGovernmentSpecificationBusy(false); }
              }}
              onRequestModelRevision={(instruction) => requestGovernmentSpecificationModel("revision", instruction)}
              onRequestModelGuidance={(instruction) => requestGovernmentSpecificationModel("guidance", instruction)}
              onApplySuggestions={async (suggestionIds) => {
                setGovernmentSpecificationBusy(true);
                try {
                  const snapshot = await api.applyGovernmentWritingSuggestions({
                    threadId: selectedThread?.id,
                    goalId: goalExecution.goal.goalId,
                    baseVersionId: governmentSpecification.currentVersionId,
                    suggestionIds
                  });
                  setGovernmentSpecification(snapshot);
                } finally { setGovernmentSpecificationBusy(false); }
              }}
            />
          ) : null}
          {goalOwnerTurnId === turn.id && ["active", "paused", "complete"].includes(goalExecution?.goal?.status) && goalExecution?.plan?.length ? (() => {
            const planSteps = goalExecution.plan as Array<any>;
            const completedSteps = planSteps.filter((step: any) => step.status === "completed").length;
            const currentStep = planSteps.find((step: any) => step.status === "in_progress");
            const showCompactProgress = goalExecution.goal.status === "active" && Boolean(currentStep) && !goalPlanExpanded && !goalExecution.pendingQuestion;
            const showPausedCard = goalExecution.goal.status === "paused" && !goalPlanExpanded;
            if (showPausedCard) {
              const pausedStep = currentStep ?? planSteps.find((step: any) => step.status === "pending");
              return (
                <section className="goal-paused-card" data-testid="goal-paused-card" aria-live="polite">
                  <strong>任务已暂停</strong>
                  <p>
                    已完成 {completedSteps}/{planSteps.length} 个阶段{pausedStep ? `，当前停在“${pausedStep.title}”` : ""}。已保存大纲、材料引用和生成进度。
                  </p>
                  <div className="goal-paused-actions">
                    <button type="button" data-testid="goal-paused-resume" onClick={() => void enableGoalMode()}>
                      <span aria-hidden="true">▶</span> 继续任务
                    </button>
                    <button type="button" data-testid="goal-paused-revise" onClick={() => {
                      setChatStatus("请在下方输入修改要求，发送后任务将按新要求继续。");
                      document.querySelector<HTMLTextAreaElement>("[data-testid=\"composer-input\"]")?.focus();
                    }}>
                      <span aria-hidden="true">✍</span> 修改要求后继续
                    </button>
                    <button type="button" className="goal-paused-detail" onClick={() => setGoalPlanExpanded(true)}>
                      查看进度 <span aria-hidden="true">›</span>
                    </button>
                  </div>
                </section>
              );
            }
            if (showCompactProgress) {
              return (
                <div className="goal-progress-strip" data-testid="goal-progress-strip" aria-live="polite">
                  <span className="goal-progress-spinner" aria-hidden="true" />
                  <span className="goal-progress-label">
                    {/^正在/u.test(currentStep.title) ? currentStep.title : `正在${currentStep.title}`} · 第{Math.min(completedSteps + 1, planSteps.length)}/{planSteps.length}阶段
                  </span>
                  <button type="button" data-testid="goal-progress-expand" onClick={() => setGoalPlanExpanded(true)}>
                    查看进度 <span aria-hidden="true">›</span>
                  </button>
                </div>
              );
            }
            return (
            <section className="goal-context-card" aria-label="目标执行上下文" data-testid="goal-runtime-panel">
              <header className="goal-context-header">
                <div>
                  <strong>{goalExecution.goal.status === "complete" ? "已完成的目标" : goalExecution.goal.status === "paused" ? "已暂停的目标" : "进行中的目标"}</strong>
                  {goalObjectiveEditing ? (
                    <span className="goal-objective-editor">
                      <input value={goalObjectiveDraft} onChange={(event) => setGoalObjectiveDraft(event.target.value)} autoFocus />
                      <button type="button" onClick={() => void saveGoalObjective()}>保存</button>
                      <button type="button" onClick={() => setGoalObjectiveEditing(false)}>取消</button>
                    </span>
                  ) : <span>{goalExecution.goal.objective}</span>}
                </div>
                <div className="goal-context-actions">
                  <span>{completedSteps}/{planSteps.length} 步</span>
                  {(goalExecution.goal.status === "active" && currentStep) || goalExecution.goal.status === "paused" ? (
                    <button type="button" title="收起进度" onClick={() => setGoalPlanExpanded(false)}>⌃</button>
                  ) : null}
                  <button type="button" title="编辑目标" onClick={() => { setGoalObjectiveDraft(goalExecution.goal.objective); setGoalObjectiveEditing(true); }}>✎</button>
                  {goalExecution.goal.status !== "complete" ? <button type="button" title={goalExecution.goal.status === "paused" ? "继续目标" : "暂停目标"} onClick={() => void (goalExecution.goal.status === "paused" ? enableGoalMode() : pauseGoalMode())}>{goalExecution.goal.status === "paused" ? "▶" : "Ⅱ"}</button> : null}
                  <button type="button" title="删除目标" onClick={() => void deleteCurrentGoal()}>⌫</button>
                </div>
              </header>
              <ol>
                {planSteps.map((step: any) => (
                  <li key={`goal-context-${step.stepId}`} className={step.status}>
                    <span>{step.status === "completed" ? "✓" : step.status === "in_progress" ? "→" : "·"}</span>
                    <div><strong>{step.title}</strong><small>{step.result || step.description}</small></div>
                  </li>
                ))}
              </ol>
            </section>
            );
          })() : null}
          {turn.id === conversationTurns.at(-1)?.id
            && !isAskingModel
            && goalExecution?.goal?.status === "active"
            && goalExecution?.pendingQuestion ? (() => {
            const isIntakeQuestion = goalExecution.pendingQuestion.questionId === "requirement-clarification";
            const isExpertQuestion = goalExecution.pendingQuestion.questionId.startsWith("expert-");
            return (
            <section ref={(element) => {
              goalQuestionCardRef.current = element;
            }} className="goal-question-card" aria-live="polite" data-testid="goal-question-card">
              <header>
                <strong>{goalExecution.pendingQuestion.prompt}</strong>
                <span>{isExpertQuestion ? "专家协作 · 等待你的选择" : "目标需要你的决策"}</span>
              </header>
              <div className="goal-question-options">
                {goalExecution.pendingQuestion.options.map((option: any, index: number) => (
                  <button
                    key={`${goalExecution.pendingQuestion.questionId}-${option.label}`}
                    type="button"
                    data-testid={`goal-option-${index}`}
                    data-recommended={option.recommended ? "true" : "false"}
                    disabled={answeringGoalQuestion}
                    onClick={() => {
                      if (isExpertQuestion && option.label === "调整分工") {
                        document.querySelector<HTMLTextAreaElement>("[data-testid=goal-custom-adjustment-input]")?.focus();
                        return;
                      }
                      if (isIntakeQuestion && option.label === "我先补充信息") {
                        setChatStatus("请在下方输入框补充信息，或点击 + 上传材料后发送。");
                        document.querySelector<HTMLTextAreaElement>("[data-testid=\"composer-input\"]")?.focus();
                        return;
                      }
                      void answerGoalDecision(option.label);
                    }}
                  >
                    <span>{index + 1}</span>
                    <span><strong>{option.label}{option.recommended ? <em>推荐</em> : null}</strong><small>{option.description}</small></span>
                  </button>
                ))}
              </div>
              <form className="goal-question-custom" onSubmit={(event) => {
                event.preventDefault();
                const adjustment = goalCustomAdjustment.trim();
                if (!adjustment || answeringGoalQuestion) return;
                setGoalCustomAdjustment("");
                void answerGoalDecision(isIntakeQuestion ? adjustment : `${isExpertQuestion ? "调整专家分工" : "调整提纲"}：${adjustment}`);
              }}>
                <label htmlFor="goal-custom-adjustment-input">{isIntakeQuestion ? "补充信息" : "自定义调整意见"}</label>
                <textarea
                  id="goal-custom-adjustment-input"
                  data-testid="goal-custom-adjustment-input"
                  value={goalCustomAdjustment}
                  disabled={answeringGoalQuestion}
                  onChange={(event) => setGoalCustomAdjustment(event.target.value)}
                  rows={5}
                  placeholder={isExpertQuestion ? "例如：只检查接口安全；暂时不安排交付验收；换一位擅长视频分镜的专家。" : isIntakeQuestion
                    ? "可补充使用场景、目标字数等信息，例如：\n用于全市年终工作会议发言；\n字数3500字左右。"
                    : "可逐条说明调整要求，例如：\n1. 安全生产放在第一部分；\n2. 增加“存在的问题”；\n3. 暂时不要生成正文和文件。"}
                />
                <button data-testid="goal-custom-adjustment-submit" type="submit" disabled={answeringGoalQuestion || !goalCustomAdjustment.trim()}>{isIntakeQuestion ? "提交补充" : "提交调整"}</button>
              </form>
            </section>
            );
          })() : null}
              </section>
              );
            })}
          {ctx.generationFailure && ctx.generationFailure.threadId === selectedThread?.id && !isGlobalModelBusy ? (
            <section className="goal-failure-card" data-testid="generation-failure-card" role="alert">
              <strong>{isSubscriptionInactiveError(ctx.generationFailure.message) ? "订阅未激活或已过期" : "生成异常终止"}</strong>
              <p>{ctx.generationFailure.message}</p>
              <small>
                {isSubscriptionInactiveError(ctx.generationFailure.message)
                  ? "请先完成订阅或联系管理员确认状态后再继续；当前进度已保存。"
                  : "已保存当前进度，未完成的内容不会计入后续上下文，可安全重试。"}
              </small>
              <div className="goal-paused-actions">
                <button type="button" data-testid="generation-failure-retry" onClick={() => void (async () => {
                  const recovery = await recoverActiveThreadRetry({
                    message: ctx.generationFailure?.message || "",
                    workspaceId: selectedWorkspace?.id || "",
                    threadId: selectedThread?.id || "",
                    releaseThreadTasks: async ({ threadId }) => {
                      const requestId = activeThreadRequestIds[threadId] || "";
                      if (requestId && api?.cancelModelRequest) {
                        try {
                          await api.cancelModelRequest({ requestId });
                        } catch {
                          // Prepare-path force-release still clears stuck map entries on retry.
                        }
                      }
                    },
                    activateThread: (input) => api.activateWorkspaceThread(input)
                  });
                  ctx.setGenerationFailure(null);
                  setErrorMessage("");
                  if (recovery.recovered) {
                    if (typeof syncSnapshot === "function") syncSnapshot(recovery.snapshot, selectedThread?.id || "");
                    else setSnapshot(recovery.snapshot);
                    setChatStatus("已恢复正在等待处理的任务。");
                    setWorkspaceCatalog(normalizeWorkspaceCatalog(await api.listWorkspaces()));
                    return;
                  }
                  await askModel({
                    threadId: selectedThread?.id || "",
                    question: "从上次异常中断的位置继续执行，不要重复已完成的内容。",
                    images: [],
                    tools: [],
                    skill: null,
                    skillContext: "",
                    modes: goalExecution?.goal?.status === "active" || goalExecution?.goal?.status === "paused" ? ["goal"] : [],
                    createdAt: new Date().toISOString()
                  });
                })()}>
                  <span aria-hidden="true">↻</span> 重试并从断点继续
                </button>
                <button type="button" onClick={() => {
                  setChatStatus("请在下方输入修改要求，发送后将按新要求继续。");
                  document.querySelector<HTMLTextAreaElement>("[data-testid=\"composer-input\"]")?.focus();
                }}>
                  <span aria-hidden="true">✍</span> 修改要求后继续
                </button>
                <button
                  type="button"
                  data-testid="generation-failure-report-feedback"
                  disabled={usageExceptionFeedbackBusy}
                  onClick={() => void reportGenerationFailureFeedback?.()}
                >
                  <span aria-hidden="true">⚑</span> 反馈此异常
                </button>
                <button type="button" className="goal-paused-detail" onClick={() => { ctx.setGenerationFailure(null); setErrorMessage(""); }}>
                  忽略 <span aria-hidden="true">×</span>
                </button>
              </div>
            </section>
          ) : null}
          </div>
          )}

        </div>

        {delegatedAgentDetailsOpen && showDelegatedAgentStrip && delegatedAgents.length > 0 ? (
          <aside className="delegated-agent-panel" role="dialog" aria-modal="false" aria-label="子 Agent 协作详情">
            <header className="delegated-agent-panel__header">
              <div>
                <strong>子 Agent 协作详情</strong>
                <span>{delegatedAgentSummary.label.replace(/ · \d+ 项等待审批$/, "")}</span>
              </div>
              <button type="button" aria-label="关闭子 Agent 协作详情" onClick={() => setDelegatedAgentDetailsOpen(false)}>×</button>
            </header>
            <div className="delegated-agent-panel__list">
              {delegatedAgents.map((agent) => {
                const terminal = ["failed", "cancelled", "canceled", "completed"].includes(String(agent.status || "").toLowerCase());
                const awaiting = !terminal && agent.checkpointStatus === "awaiting-approval";
                const statusLabel = awaiting
                  ? "等待审批"
                  : agent.status === "failed"
                    ? (agent.error || "失败")
                    : agent.status;
                return (
                  <article className={`delegated-agent-item${terminal && agent.status !== "completed" ? " failed" : ""}`} key={agent.id || agent.childThreadId}>
                    <div className="delegated-agent-item__title">
                      <strong>{agent.title}</strong>
                      <span>{statusLabel}</span>
                    </div>
                    <p>{agent.owner} · {agent.summary || agent.error || agent.instruction || "处理中"}</p>
                    {agent.result?.modelUsage?.selectedModel || agent.result?.modelUsage?.requestedModel ? (
                      <small data-testid="delegated-agent-model">
                        模型：{agent.result.modelUsage.selectedModel || agent.result.modelUsage.requestedModel}
                        {agent.result.modelUsage.requestedModel
                          && agent.result.modelUsage.selectedModel
                          && agent.result.modelUsage.requestedModel !== agent.result.modelUsage.selectedModel
                          ? `（请求 ${agent.result.modelUsage.requestedModel}）`
                          : ""}
                      </small>
                    ) : null}
                    {agent.dependsOn?.length ? <small>依赖：{agent.dependsOn.join(" → ")}</small> : null}
                    {agent.result?.qualityGates?.length ? (
                      <div className="delegated-agent-gates">
                        {agent.result.qualityGates.map((gate) => (
                          <span key={gate.id} title={gate.detail} data-status={gate.status}>{gate.id}: {gate.status}</span>
                        ))}
                      </div>
                    ) : null}
                    {awaiting ? (
                      <div className="delegated-agent-approval">
                        <code>{agent.pendingTool?.name || "工具调用"}</code>
                        <div className="approval-card__actions">
                          <button type="button" data-testid="delegated-agent-reject-button" disabled={delegatedAgentAction === agent.childThreadId} onClick={() => void handleDelegatedAgentApproval(agent.childThreadId, false)}>拒绝</button>
                          <button type="button" className="primary" data-testid="delegated-agent-approve-button" disabled={delegatedAgentAction === agent.childThreadId} onClick={() => void handleDelegatedAgentApproval(agent.childThreadId, true)}>批准</button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </aside>
        ) : null}

        {usageExceptionFeedbackPreview ? (
          <div className="usage-exception-feedback-overlay" role="presentation">
            <section
              className="usage-exception-feedback-dialog"
              data-testid="usage-exception-feedback-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="usage-exception-feedback-title"
            >
              <header>
                <div>
                  <span>异常标题</span>
                  <h2 id="usage-exception-feedback-title">{usageExceptionFeedbackPreview.title}</h2>
                </div>
              </header>
              <dl>
                <div><dt>异常现象</dt><dd>{usageExceptionFeedbackPreview.symptomSummary}</dd></div>
                <div><dt>可能原因</dt><dd>{usageExceptionFeedbackPreview.possibleCause}</dd></div>
                <div><dt>问题分类</dt><dd>{usageExceptionFeedbackPreview.category}</dd></div>
                <div><dt>上下文摘要</dt><dd>{usageExceptionFeedbackPreview.contextSummary}</dd></div>
                <div><dt>环境信息</dt><dd><pre>{usageExceptionFeedbackPreview.environmentSummary || "无"}</pre></dd></div>
                <div><dt>日志摘要</dt><dd><pre>{usageExceptionFeedbackPreview.logSummary || "无"}</pre></dd></div>
              </dl>
              <footer>
                <button type="button" disabled={usageExceptionFeedbackBusy} onClick={cancelUsageExceptionFeedback}>取消</button>
                <button type="button" className="primary" disabled={usageExceptionFeedbackBusy} onClick={() => void confirmUsageExceptionFeedback()}>确认提交</button>
              </footer>
            </section>
          </div>
        ) : null}

        {renderComposerPortal(<footer className={`composer-area${isNewChatMode ? " new-chat-composer" : ""}${!isNewChatMode && isBrainConversationSelection ? " brain-chat-composer" : ""}${composerImages.length ? " has-images" : ""}${ttsFollow ? " has-tts-follow" : ""}`}>
          {ttsFollow ? (
            <div className="novel-tts-follow-cue novel-tts-follow-cue--dock" data-tts-follow={ttsFollow.messageId || "preview"} aria-live="polite">
              <strong>正在朗读</strong>
              <span>
                {ttsFollow.scope === "preview" ? "预览" : "消息"}
                {" · "}
                第 {ttsFollow.line}{ttsFollow.endLine !== ttsFollow.line ? `–${ttsFollow.endLine}` : ""} 行
              </span>
              {ttsFollow.snippet ? <em>{ttsFollow.snippet}</em> : null}
            </div>
          ) : null}
          {errorMessage
            && !(ctx.generationFailure && ctx.generationFailure.threadId === selectedThread?.id)
            && isComposerAttachmentErrorMessage(errorMessage)
            ? (
              <div className="error-banner composer-error-banner" data-testid="composer-error-banner" role="alert">
                {errorMessage}
              </div>
            )
            : null}
          {showJumpToLatest ? (
            <button
              type="button"
              className="chat-jump-latest"
              data-testid="chat-jump-latest"
              onClick={() => {
                stickToBottomRef.current = true;
                setShowJumpToLatest(false);
                scrollTaskToBottom("smooth");
              }}
            >
              ↓ 回到底部
            </button>
          ) : null}
          <div
            className={`composer-card${isGlobalModelBusy || brainMessageBusy ? " busy" : ""}${composerDragActive ? " drag-active" : ""}${composerTextareaHeight > COMPOSER_TEXTAREA_DEFAULT_HEIGHT || String(composerLayoutDraft || question || "").includes("\n") || String(composerLayoutDraft || question || "").length > 80 ? " composer-card--expanded" : ""}${composerTextareaHeight !== COMPOSER_TEXTAREA_DEFAULT_HEIGHT ? " composer-card--manual-height" : ""}`}
            style={{
              ["--composer-textarea-height" as string]: `${composerTextareaHeight}px`,
              ["--composer-textarea-max-height" as string]: `${COMPOSER_TEXTAREA_MAX_HEIGHT}px`
            }}
            onDragEnter={(event) => {
              if (!Array.from(event.dataTransfer.types).includes("Files")) return;
              event.preventDefault();
              setComposerDragActive(true);
            }}
            onDragOver={(event) => {
              if (!Array.from(event.dataTransfer.types).includes("Files")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setComposerDragActive(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setComposerDragActive(false);
            }}
            onDrop={(event) => {
              if (!Array.from(event.dataTransfer.types).includes("Files")) return;
              event.preventDefault();
              setComposerDragActive(false);
              void addComposerFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <button
              type="button"
              className="composer-resize-handle"
              data-testid="composer-resize-handle"
              aria-label="拖动调整输入框高度"
              title="向上拖动可拉高输入框"
              onPointerDown={startComposerTextareaResize}
            >
              <span aria-hidden="true" />
            </button>
            <div className="composer-heading">
              <span>{isBrainConversationSelection
                ? `给 ${selectedBrainWorkspace?.displayName || "BRAIN"} 发消息`
                : "向 NewBrain 描述你要继续完成的工作"}</span>
            </div>
            <DeliveryPreferenceChip
              state={deliveryPreferenceChip}
              busy={deliveryPreferenceBusy || isAskingModel}
              onClear={() => void clearDeliveryPreferenceChip()}
              onPin={() => void pinDeliveryPreferenceChip()}
            />
            {composerConversationRefs.length ? (
              <div className="composer-conversation-refs" data-testid="composer-conversation-refs">
                {composerConversationRefs.map((ref) => (
                  <button
                    key={conversationRefKey(ref)}
                    type="button"
                    className="composer-conversation-ref-chip"
                    title={ref.summary || ref.title}
                    onClick={() => setComposerConversationRefs((current) => current.filter((item) => conversationRefKey(item) !== conversationRefKey(ref)))}
                  >
                    <em>{ref.kind === "brain_conversation" ? "BRAIN" : "线程"}</em>
                    <strong>{ref.title}</strong>
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            ) : null}
            {composerMentionQuery && composerMentionCandidates.length ? (
              <div className="composer-mention-picker" role="listbox" aria-label="引用对话" data-testid="composer-mention-picker">
                <div className="composer-mention-picker-title">引用其它对话（摘要 + 最近 5 轮）</div>
                {composerMentionCandidates.map((candidate, index) => (
                  <button
                    key={candidate.id}
                    type="button"
                    role="option"
                    aria-selected={index === composerMentionIndex}
                    className={`composer-mention-option${index === composerMentionIndex ? " active" : ""}`}
                    disabled={composerMentionBusy}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      void selectComposerMentionCandidate(candidate);
                    }}
                  >
                    <em>{candidate.kind === "brain_conversation" ? "BRAIN" : "线程"}</em>
                    <span>
                      <strong>{candidate.title}</strong>
                      <small>{candidate.detail}</small>
                    </span>
                    {candidate.archived ? <i>已归档</i> : null}
                  </button>
                ))}
              </div>
            ) : null}
            {showDelegatedAgentStrip ? (
              <button
                type="button"
                className={`delegated-agent-strip${delegatedAgentSummary.attention ? " attention" : ""}${failedDelegatedAgentCount ? " failed" : ""}`}
                aria-expanded={delegatedAgentDetailsOpen}
                onClick={() => setDelegatedAgentDetailsOpen((current) => !current)}
              >
                <span className="delegated-agent-strip__pulse" aria-hidden="true" />
                <strong>子 Agent 协作</strong>
                <span>{delegatedAgentSummary.label}</span>
                <span className="delegated-agent-strip__action">查看详情 ›</span>
              </button>
            ) : null}
            {effectiveApproval && conversationTurns.length === 0 ? (
              <section className="approval-request-banner composer-approval-banner" aria-live="polite" role="dialog" aria-label="命令审批" data-testid="approval-dialog">
                <div className="approval-request-main">
                  <header className="approval-request-heading">
                    <span>需要批准</span>
                    <em data-risk={approvalTool?.risk || "unknown"}>{approvalRiskLabel}</em>
                  </header>
                  <strong>{approvalUx.reasonText}</strong>
                  <small>权限范围：{approvalScopeLabel} · 仅批准本次操作</small>
                  {approvalUx.categoryLabels.length ? (
                    <div className="approval-category-tags" data-testid="composer-approval-tags">
                      {approvalUx.categoryLabels.map((label) => <span key={label}>{label}</span>)}
                    </div>
                  ) : null}
                  {approvalUx.memoryHint ? <small className="approval-memory-hint">{approvalUx.memoryHint}</small> : null}
                  {approvalCommand ? (
                    <div className={`approval-command-shell${approvalCommandExpanded ? " expanded" : ""}`}>
                      <code className="approval-command-preview">{approvalCommand}</code>
                      {approvalCommand.length > 120 || approvalCommand.includes("\n") ? (
                        <button type="button" className="approval-command-toggle" aria-expanded={approvalCommandExpanded} onClick={() => setApprovalCommandExpanded((current) => !current)}>
                          {approvalCommandExpanded ? "收起命令" : "展开命令"}
                        </button>
                      ) : null}
                    </div>
                  ) : approvalTool ? (
                    <small>工具：{approvalTool.kind || "tool"} · 原因：{approvalTool.reason || "需要访问当前工作区"}</small>
                  ) : (
                    <small>请确认是否允许当前线程继续执行等待中的工具调用。</small>
                  )}
                  {approvalResponding ? (
                    <div className="approval-live-output" data-testid="approval-live-output" aria-live="polite">
                      <div className="approval-live-status">
                        <span className="approval-live-pulse" aria-hidden="true" />
                        <strong>正在继续执行</strong>
                      </div>
                      {activeReasoningSummary.trim() ? (
                        <div className="approval-live-reasoning">
                          <MarkdownMessage content={activeReasoningSummary} workspaceId={selectedWorkspace?.id} onOpenLocalFile={openLocalFilePreview} isStreaming />
                        </div>
                      ) : null}
                      {visibleAssistantActivities.length ? (
                        <div className="approval-live-activities">
                          {visibleAssistantActivities.map((activity: any, index: number) => renderActivityRow(activity, `approval-live-${activityKey(activity)}-${index}`))}
                        </div>
                      ) : null}
                      {activeStreamContent ? (
                        <div className="approval-live-text">
                          <MarkdownMessage content={activeStreamContent} workspaceId={selectedWorkspace?.id} onOpenLocalFile={openLocalFilePreview} isStreaming />
                        </div>
                      ) : (
                        <small>命令完成后，模型返回的内容会在这里实时显示。</small>
                      )}
                    </div>
                  ) : null}
                  {approvalError ? <small className="approval-error-text">{approvalError}</small> : null}
                </div>
                <div className="approval-request-actions">
                  {approvalResponding ? (
                    <button type="button" data-testid="approval-cancel-button" onClick={() => void cancelCurrentModelRequest()}>停止</button>
                  ) : (
                    <>
                      <button type="button" data-testid="approval-reject-button" onClick={() => void handleApprovalResponse(false)}>拒绝</button>
                      <button className="primary" type="button" data-testid="approval-approve-button" onClick={() => void handleApprovalResponse(true)}>{"批准并继续"}</button>
                    </>
                  )}
                </div>
              </section>
            ) : null}
            {isGlobalModelBusy || brainMessageBusy ? <div className="composer-busy-note">处理中，发送后排队</div> : null}
            {selectedThreadQueue.length ? (
              <div className={`composer-queue${composerQueueCollapsed ? " collapsed" : ""}`} data-testid="composer-queue">
                <div className="composer-queue-header">
                  <button
                    type="button"
                    className="composer-queue-toggle"
                    aria-expanded={!composerQueueCollapsed}
                    onClick={() => setComposerQueueCollapsed((current) => !current)}
                  >
                    <SidebarIcon name={composerQueueCollapsed ? "chevron-right" : "chevron-down"} />
                    <span>排队中 · {selectedThreadQueue.length}</span>
                  </button>
                  <span className="composer-queue-hint">
                    {selectedThreadRunning ? "当前轮结束后按顺序发送" : "队列已暂停"}
                  </span>
                  {!selectedThreadRunning ? (
                    <button type="button" className="composer-queue-resume" data-testid="composer-queue-resume" onClick={resumeComposerQueue}>
                      发送下一条
                    </button>
                  ) : null}
                </div>
                {!composerQueueCollapsed ? (
                  <ol className="composer-queue-list">
                    {selectedThreadQueue.map((item: any, index: number) => {
                      const attachmentCount = Array.isArray(item.images) ? item.images.length : 0;
                      return (
                        <li key={item.id || `${item.createdAt}-${index}`} className="composer-queue-item" data-testid="composer-queue-item">
                          <span className="composer-queue-index">{index + 1}</span>
                          <button
                            type="button"
                            className="composer-queue-text"
                            title={item.question || "请查看附件"}
                            onClick={() => editQueuedComposerItem(item)}
                          >
                            {item.question || "请查看附件"}
                          </button>
                          {attachmentCount ? <span className="composer-queue-meta">{attachmentCount} 个附件</span> : null}
                          <div className="composer-queue-actions">
                            <button
                              type="button"
                              aria-label="立即发送"
                              title={selectedThreadRunning ? "立即插入当前运行" : "立即发送"}
                              onClick={() => void sendQueuedComposerItemNow(item)}
                            >
                              <SidebarIcon name="arrow-up" />
                            </button>
                            <button type="button" aria-label="编辑排队消息" title="放回输入框编辑" onClick={() => editQueuedComposerItem(item)}>
                              <SidebarIcon name="edit" />
                            </button>
                            <button type="button" aria-label="删除排队消息" title="删除" onClick={() => removeQueuedComposerItem(item)}>
                              <SidebarIcon name="remove" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </div>
            ) : null}
            {selectedComposerTools.some((tool: any) => tool.inputSchema) ? (
              <div className="composer-context-fields">
                {selectedComposerTools.map((tool: any) => tool.inputSchema ? (
                  <div key={tool.id} className="composer-context-tool" title={tool.detail}>{renderComposerToolFields(tool)}</div>
                ) : null)}
              </div>
            ) : null}
            {composerImages.length > 0 ? (
              <div className="composer-image-strip" data-testid="composer-materials-strip">
                <div className="composer-materials-hint" data-testid="composer-materials-hint" title="焦点材料是对话里的少量关键文件；目录请挂载工作区；万级表格请用数据场景。">
                  {composerFocusCapacityHint(composerImages.length, COMPOSER_FOCUS_ATTACHMENT_LIMIT)}
                </div>
                {composerImages.map((image) => {
                  const kind = getAttachmentKind(image);
                  const accessLabel = composerAttachmentAccessLabel(image.linkMode);
                  return (
                    <div className="composer-image-preview" key={image.path} data-link-mode={image.linkMode || "copied"}>
                      {kind.tone === "image" ? (
                        <button
                          type="button"
                          className="composer-image-open"
                          title={`预览 ${image.name}`}
                          onClick={() => setImagePreview(image)}
                        >
                          <img src={image.url} alt={image.name} />
                        </button>
                      ) : (
                        <div className={`composer-file-preview type-${kind.tone}`} title={`${image.name} · ${accessLabel}${image.sourcePath ? `\n${image.sourcePath}` : ""}`}>
                          <strong>{kind.icon}</strong>
                          <span>{image.name}</span>
                          <em>{kind.label}</em>
                          <i className="composer-file-access">{accessLabel}</i>
                        </div>
                      )}
                      <button
                        type="button"
                        title={`移除 ${image.name}`}
                        aria-label={`移除 ${image.name}`}
                        onClick={() => removeComposerAttachment(image)}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <ComposerTextarea
              ref={composerTextareaRef}
              resetKey={`${selectedThreadId || "none"}:${selectedBrainConversationId || "none"}:${isComposingNewThread ? "new" : "thread"}`}
              initialValue={question}
              readOnly={researchWritingSession.enabled && Boolean(researchWritingSession.requestText)}
              placeholder={
                selectedComposerSkill?.name === RESEARCH_WRITING_SKILL
                  ? "描述您撰写或修改的文档，也可以上传材料..."
                  : isBrainConversationSelection
                    ? `给 ${selectedBrainWorkspace?.displayName || "BRAIN"} 发消息`
                  : isNewChatMode
                    ? "问任何事"
                    : "继续输入"
              }
              onDraftChange={handleComposerDraftChange}
              onHistoryChange={setComposerDraftHistoryCaps}
              onEnter={handleComposerEnter}
              onMentionQueryChange={setComposerMentionQuery}
              onMentionNavigate={handleComposerMentionNavigate}
              onAltEnter={() => composerTextareaRef.current?.insertNewlineAtCursor()}
              onContextMenu={(event) => {
                event.preventDefault();
                if (api) void api.showInputContextMenu();
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);
                if (files.length === 0) return;
                void addComposerFiles(files);
              }}
            />
            {voiceInputAvailable && desktopPreferences?.dictation?.keepBarVisible ? (
              <div className="composer-dictation-bar">
                <span className="composer-dictation-dot" />
                <span>听写</span>
                <kbd>{desktopPreferences.dictation.holdShortcut || "按住快捷键未设置"}</kbd>
                <kbd>{desktopPreferences.dictation.toggleShortcut || "切换快捷键未设置"}</kbd>
                <em>{desktopPreferences.dictation.microphone === "default" ? "默认输入设备" : "系统默认麦克风"}</em>
              </div>
            ) : null}
            <div className="composer-tools">
              <div className="composer-modern-controls">
                <div className="composer-picker-wrap">
                  <button type="button" data-testid="composer-add-button" className="composer-icon-button" title="添加文件等内容" onClick={() => setComposerMenu((current) => current === "add" ? null : "add")}>＋</button>
                  {composerMenu === "add" ? (
                    <div className="composer-picker-menu composer-add-menu" data-testid="composer-materials-menu">
                      <span className="composer-menu-label">材料分层</span>
                      <button
                        type="button"
                        data-testid={COMPOSER_MATERIALS_MENU_ITEMS[0].testId}
                        onClick={() => void selectComposerFiles()}
                      >
                        <SidebarIcon name="paperclip" />
                        <span>
                          <strong>{COMPOSER_MATERIALS_MENU_ITEMS[0].title}</strong>
                          <small>{COMPOSER_MATERIALS_MENU_ITEMS[0].detail}</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        data-testid={COMPOSER_MATERIALS_MENU_ITEMS[1].testId}
                        onClick={() => {
                          setComposerMenu(null);
                          void (async () => {
                            const workspaceId = await addExistingProject({ brainWorkspaceKey: selectedBrainWorkspaceKey });
                            if (!workspaceId) return;
                            const projects = await refreshBrainProjects(selectedBrainWorkspaceKey);
                            setSelectedSidebarRow(`project:${workspaceId}`);
                            bindBrainProjectToWorkspace(workspaceId, {
                              composingNewThread: true,
                              projects
                            });
                            setActiveFeature("new-chat");
                            setNewThreadScope("project");
                            setChatUsesProject?.(true);
                            setExpandedWorkspaceIds((current) => new Set([...current, workspaceId]));
                            setChatStatus("已挂载工作区文件夹。大目录请在此按需读取，不要塞进聊天焦点附件。");
                          })();
                        }}
                      >
                        <SidebarIcon name="folder-open" />
                        <span>
                          <strong>{COMPOSER_MATERIALS_MENU_ITEMS[1].title}</strong>
                          <small>{COMPOSER_MATERIALS_MENU_ITEMS[1].detail}</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        data-testid={COMPOSER_MATERIALS_MENU_ITEMS[2].testId}
                        onClick={() => {
                          setComposerMenu(null);
                          switchBrainWorkspace("data");
                          setActiveFeature("new-chat");
                          setChatStatus("已打开数据场景。万级表格请走数据导入/查询，不要用聊天附件硬塞。");
                        }}
                      >
                        <SidebarIcon name="file-text" />
                        <span>
                          <strong>{COMPOSER_MATERIALS_MENU_ITEMS[2].title}</strong>
                          <small>{COMPOSER_MATERIALS_MENU_ITEMS[2].detail}</small>
                        </span>
                      </button>
                      <span className="composer-menu-label">添加</span>
                      <button type="button" data-composer-mode="goal" className={composerModes.includes("goal") ? "active" : ""} aria-pressed={composerModes.includes("goal")} onClick={() => void enableGoalMode()}><SidebarIcon name="target" /><span><strong>{goalExecution?.goal?.status === "paused" ? "继续目标" : "目标"}</strong><small>{goalExecution?.goal?.status === "paused" ? goalExecution.goal.objective : "设置要持续追求的目标"}</small></span><span className="composer-add-option-check" aria-hidden="true">{composerModes.includes("goal") ? "✓" : ""}</span></button>
                      <button type="button" data-composer-mode="plan" className={composerModes.includes("plan") ? "active" : ""} aria-pressed={composerModes.includes("plan")} onClick={() => void enablePlanMode()}><SidebarIcon name="plan" /><span><strong>计划模式</strong><small>开启计划模式</small></span><span className="composer-add-option-check" aria-hidden="true">{composerModes.includes("plan") ? "✓" : ""}</span></button>
                      {researchWritingSession.enabled ? <>
                        <button type="button" onClick={() => void reviewCurrentResearchWriting()}><SidebarIcon name="file-check" /><span><strong>校验最新稿件</strong><small>检查数据、政策、时间、做法和行政层级来源</small></span></button>
                        <button type="button" onClick={() => void exportCurrentResearchWriting("docx")}><SidebarIcon name="file-word" /><span><strong>导出 Word / WPS</strong><small>将最新助手稿件导出为 DOCX</small></span></button>
                        <button type="button" onClick={() => void exportCurrentResearchWriting("review-docx")}><SidebarIcon name="file-review" /><span><strong>导出校验版</strong><small>DOCX 正文附带事实风险清单</small></span></button>
                        <button type="button" onClick={() => void exportCurrentResearchWriting("txt")}><SidebarIcon name="file-text" /><span><strong>导出纯文本</strong><small>UTF-8 文本，不附带校验清单</small></span></button>
                      </> : null}
                      <span className="composer-menu-label composer-plugin-label">插件</span>
                      {builtinPluginCatalog.map((plugin) => (
                        <button key={plugin.id} type="button" className="composer-builtin-plugin" data-plugin={plugin.packageName} onClick={() => selectBuiltinPlugin(plugin)}>
                          <BuiltinPluginIcon plugin={plugin} />
                          <span><strong>{plugin.name}</strong><small>{plugin.summary}</small></span>
                        </button>
                      ))}
                      {mcpDiscoveredTools.length > 0 ? <span className="composer-menu-label composer-plugin-label">MCP 工具</span> : null}
                      {mcpDiscoveredTools.slice(0, 6).map((tool) => (
                        <button key={`composer-add-${tool.id}`} type="button" onClick={() => { handleInsertMcpTool(tool); setComposerMenu(null); setShowMcpToolPicker(false); }}><SidebarIcon name="tool" /><span><strong>{tool.name}</strong><small>{tool.serverName} · {tool.description || "工作区工具"}</small></span></button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {composerModes.includes("goal") || goalExecution?.goal?.status === "active" ? (
                  <div className="composer-picker-wrap">
                    <button type="button" data-testid="composer-goal-button" className="composer-goal-button" title={goalExecution?.goal?.objective || (selectedComposerTools.length ? `目标 · ${selectedComposerTools.map((tool: any) => tool.label).join("、")}` : "目标模式")} onClick={() => { setComposerMenu("add"); setShowMcpToolPicker(true); }}>
                      <SidebarIcon name="target" />
                      <span>目标</span>
                    </button>
                  </div>
                ) : null}
                {composerModes.includes("plan") ? (
                  <div className="composer-picker-wrap">
                    <button type="button" data-testid="composer-plan-button" className="composer-plan-button" title="计划模式：先规划再执行" onClick={() => setComposerMenu("add")}>
                      <SidebarIcon name="plan" />
                      <span>计划</span>
                    </button>
                  </div>
                ) : null}
                <div className="composer-picker-wrap">
                  <button type="button" data-testid="composer-permission-button" data-permission-mode={composerPermission} className={`composer-permission-button permission-${composerPermission}`} onClick={() => setComposerMenu((current) => current === "permission" ? null : "permission")}><SidebarIcon name={permissionOption(composerPermission).icon} /><span>{permissionOption(composerPermission).name}</span><SidebarIcon name="chevron-down" /></button>
                  {composerMenu === "permission" ? (
                    <div className="composer-picker-menu composer-permission-menu">
                      <span className="composer-menu-label">应如何批准 NewBrain 操作？</span>
                      {COMPOSER_PERMISSION_OPTIONS.map((option) => (
                        <button key={option.id} type="button" data-testid={`permission-option-${option.id}`} data-permission-option={option.id} className={composerPermission === option.id ? "active" : ""} aria-pressed={composerPermission === option.id} onClick={() => { setComposerPermission(option.id); setComposerMenu(null); }}><span className="permission-option-icon" aria-hidden="true"><SidebarIcon name={option.icon} /></span><span className="permission-option-copy"><strong>{option.name}</strong><small>{option.detail}</small></span><span className="permission-option-check" aria-hidden="true">{composerPermission === option.id ? "✓" : ""}</span></button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {summonedExpert?.expertId ? (
                  <div className="composer-picker-wrap">
                    <button
                      type="button"
                      data-testid="composer-expert-chip"
                      className="composer-skill-button active"
                      title={`Skill 已召唤专家：${summonedExpert.profession}${summonedExpert.preferredWorkspaceKey ? ` · 建议场景 ${summonedExpert.preferredWorkspaceKey}` : ""}`}
                      onClick={() => {
                        setSelectedSidebarRow("feature:experts");
                        setActiveFeature("experts");
                      }}
                    >
                      <span>专家 · {summonedExpert.profession || summonedExpert.displayName}</span>
                    </button>
                    <button
                      type="button"
                      data-testid="composer-expert-clear"
                      className="composer-permission-button"
                      title="取消当前对话的专家召唤"
                      onClick={() => {
                        const threadId = String(selectedThread?.id || "").trim();
                        if (!threadId || !window.newbrain?.clearExpertSummon) return;
                        void window.newbrain.clearExpertSummon({ threadId }).then(() => setSummonedExpert(null));
                      }}
                    >
                      <span>取消</span>
                    </button>
                  </div>
                ) : null}
                {availableComposerSkills.length > 0 ? (
                  <div className="composer-picker-wrap">
                    <button
                      type="button"
                      data-testid="composer-skill-button"
                      className={`composer-skill-button${selectedComposerSkill ? " active" : ""}`}
                      aria-expanded={composerMenu === "skill"}
                      aria-haspopup="menu"
                      title={selectedComposerSkill ? `当前技能：${composerSkillLabel(selectedComposerSkill)}` : "选择技能"}
                      onClick={() => setComposerMenu((current) => current === "skill" ? null : "skill")}
                    >
                      {selectedBuiltinPlugin ? (
                        <BuiltinPluginIcon plugin={selectedBuiltinPlugin} />
                      ) : <SidebarIcon name={composerSelectionIcon(selectedComposerSkill)} />}
                      <span>{selectedComposerSkill ? composerSkillLabel(selectedComposerSkill) : "选择技能"}</span>
                      <SidebarIcon name="chevron-down" />
                    </button>
                    {composerMenu === "skill" ? (
                      <div className="composer-picker-menu composer-skill-menu" role="menu" aria-label="选择技能">
                        <span className="composer-menu-label">选择技能</span>
                        {availableComposerSkills.map((skill: any) => {
                          const selected = selectedComposerSkill?.name === skill.name;
                          const isGov = skill.name === RESEARCH_WRITING_SKILL;
                          return (
                            <button
                              key={`composer-mode-${skill.id || skill.name}`}
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              data-testid={`composer-skill-${skill.name}`}
                              className={selected ? "active" : ""}
                              onClick={() => selectComposerSkill(skill)}
                              title={skill.summary || skill.name}
                            >
                              <span className="composer-skill-option-icon" aria-hidden="true">
                                <SidebarIcon name={isGov ? "skill-doc" : "skills"} />
                              </span>
                              <span className="composer-skill-option-copy">
                                <strong>{composerSkillLabel(skill)}</strong>
                              </span>
                              <span className="composer-skill-option-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                            </button>
                          );
                        })}
                        {selectedComposerSkill ? (
                          <button type="button" className="composer-skill-clear" onClick={clearComposerSkill}>
                            <span className="composer-skill-option-icon" aria-hidden="true"><SidebarIcon name="remove" /></span>
                            <span className="composer-skill-option-copy"><strong>关闭技能</strong></span>
                            <span className="composer-skill-option-check" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="composer-picker-wrap">
                  <button
                    type="button"
                    className={`composer-context-button${composerWorkspaceContext ? " active" : ""}`}
                    aria-pressed={composerWorkspaceContext}
                    onClick={() => setComposerMenu((current) => current === "context" ? null : "context")}
                  >@ 上下文<SidebarIcon name="chevron-down" /></button>
                  {composerMenu === "context" ? (
                    <div className="composer-picker-menu composer-context-menu">
                      <span className="composer-menu-label">对话上下文</span>
                      <button type="button" onClick={() => setComposerWorkspaceContext((current: boolean) => !current)}>
                        <span aria-hidden="true">{composerWorkspaceContext ? "✓" : ""}</span>
                        <span><strong>当前工作区</strong><small>{selectedWorkspace?.name || "尚未选择工作区"}</small></span>
                      </button>
                      <button type="button" onClick={() => { void selectComposerFiles(); setComposerMenu(null); }}>
                        <SidebarIcon name="paperclip" />
                        <span><strong>文件和图片</strong><small>插入到光标处（焦点材料）</small></span>
                      </button>
                      {mcpDiscoveredTools.slice(0, 6).map((tool: any) => (
                        <button key={`composer-context-${tool.id}`} type="button" onClick={() => { handleInsertMcpTool(tool); setComposerMenu(null); }}>
                          <span aria-hidden="true">◇</span>
                          <span><strong>{tool.name}</strong><small>{tool.serverName} · {tool.description || "工作区工具"}</small></span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span className="composer-modern-spacer" />
                <span
                  className="composer-daily-balance composer-context-meter"
                  style={{ "--daily-balance-percent": `${contextUsedPercent}%` } as any}
                  title={`上下文已用 ${contextUsedPercent}%（剩余 ${contextRemainingPercent}%）。已用 ${formatContextTokens(contextUsedTokens)} / ${formatContextTokens(contextWindowTokens)}${contextMeterBreakdownLines.length ? ` · ${contextMeterBreakdownLines.join(" · ")}` : ""}`}
                  aria-label={`上下文已用 ${contextUsedPercent}%，剩余 ${contextRemainingPercent}%，已用 ${formatContextTokens(contextUsedTokens)}，共 ${formatContextTokens(contextWindowTokens)}`}
                />
                <div className="composer-picker-wrap" ref={reasoningPickerWrapRef}>
                  <button type="button" className="composer-reasoning-button" onClick={() => void openModelMenu()}>{compactModelLabel} {reasoningLabel}<SidebarIcon name="chevron-down" /></button>
                </div>
                {composerMenu === "reasoning" && reasoningMenuPosition && typeof document !== "undefined"
                  ? createPortal(
                    <div
                      className="composer-picker-menu composer-reasoning-menu composer-reasoning-menu-fixed"
                      data-testid="composer-reasoning-menu"
                      data-placement={reasoningMenuPosition.placement}
                      style={{
                        left: reasoningMenuPosition.left,
                        top: reasoningMenuPosition.top,
                        width: reasoningMenuPosition.width,
                        maxHeight: reasoningMenuPosition.maxHeight
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <span className="composer-menu-label">推理</span>
                      {reasoningOptions.map((option) => (
                        <button key={option.id} type="button" onClick={() => { setModelConfig((current: any) => ({ ...current, reasoningEffort: option.id })); setComposerMenu(null); }}><strong>{option.label}</strong><span>{modelConfig.reasoningEffort === option.id ? "✓" : ""}</span></button>
                      ))}
                      <div className="composer-reasoning-divider" />
                      <button type="button" className="composer-submenu-trigger" onClick={() => setReasoningSubmenu((current) => current === "model" ? null : "model")}>
                        <strong>{modelLabel}</strong><span>›</span>
                      </button>
                      {reasoningSubmenu === "model" ? (
                        <div className="composer-picker-menu composer-model-submenu">
                          <span className="composer-menu-label">模型</span>
                          {composerModelOptions.map((option, index) => (
                            <button key={`${option.id}-${index}`} type="button" onClick={() => selectOfficialComposerModel(option.id)}>
                              <strong>{option.label}</strong><span>{modelConfig.model.toLowerCase() === option.id.toLowerCase() ? "✓" : ""}</span>
                            </button>
                          ))}
                          {renderCustomModelMenu(true)}
                        </div>
                      ) : null}
                      {isComposerAuto ? (
                        <>
                          <button type="button" className="composer-submenu-trigger" onClick={() => setReasoningSubmenu((current) => current === "optimize" ? null : "optimize")}>
                            <strong>Optimize · {optimizeForLabel}</strong><span>›</span>
                          </button>
                          {reasoningSubmenu === "optimize" ? (
                            <div className="composer-picker-menu composer-model-submenu">
                              <span className="composer-menu-label">Optimize For</span>
                              {optimizeForOptions.map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => {
                                    setModelConfig((current: any) => ({ ...current, optimizeFor: option.id }));
                                    setReasoningSubmenu(null);
                                    setComposerMenu(null);
                                  }}
                                >
                                  <strong>{option.label}</strong>
                                  <span>{optimizeForValue === option.id ? "✓" : ""}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      <button type="button" className="composer-submenu-trigger" onClick={() => setReasoningSubmenu((current) => current === "speed" ? null : "speed")}>
                        <strong>速度</strong><span>›</span>
                      </button>
                      {reasoningSubmenu === "speed" ? (
                        <div className="composer-picker-menu composer-speed-submenu">
                          <span className="composer-menu-label">速度</span>
                          {[{ id: "standard", label: "标准" }, { id: "fast", label: "快速" }].map((option) => (
                            <button key={option.id} type="button" onClick={() => { setComposerSpeed(option.id as "standard" | "fast"); setReasoningSubmenu(null); setComposerMenu(null); }}>
                              <strong>{option.label}</strong><span>{composerSpeed === option.id ? "✓" : ""}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>,
                    document.body
                  )
                  : null}
                {voiceInputAvailable ? <button type="button" className={`composer-voice-button${isListening ? " listening" : ""}`} title={isListening ? "停止听写" : "语音输入"} onClick={() => toggleVoiceInput()}><SidebarIcon name="microphone" /></button> : null}
              </div>
              <button
                type="button"
                title="添加图片"
                onClick={async () => {
                  if (!api) return;
                  try {
                    const result = await api.selectComposerImages();
                    const images = result?.attachments ?? [];
                    const added = attachComposerAttachmentsAtCursor(images, 5);
                    if (result?.detail) {
                      if (added > 0) setChatStatus(result.detail);
                      else setErrorMessage(result.detail);
                    } else if (added > 0) {
                      setChatStatus(`已在光标处添加 ${added} 个资料`);
                    }
                  } catch (error) {
                    setErrorMessage(normalizeComposerAttachmentError(error));
                  }
                }}
              >
                ＋
              </button>
              <div className="composer-picker-wrap">
                <button type="button" onClick={() => setComposerMenu((current) => current === "permission" ? null : "permission")}>
                  ☝ {composerPermission === "full" ? "完全访问" : "替我审批"}<SidebarIcon name="chevron-down" />
                </button>
                {composerMenu === "permission" ? (
                  <div className="composer-picker-menu composer-permission-menu">
                    {[{ id: "agent", name: "替我审批", detail: "自动审核操作，仅拦截明确高风险动作" }, { id: "full", name: "完全访问", detail: "可不受限制地访问互联网和本机文件" }].map((option) => (
                      <button key={`legacy-permission-${option.id}`} type="button" onClick={() => { setComposerPermission(option.id); setComposerMenu(null); }}>
                        <span aria-hidden="true">{composerPermission === option.id ? "✓" : ""}</span>
                        <span><strong>{option.name}</strong><small>{option.detail}</small></span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="composer-picker-wrap">
                <button type="button" onClick={() => setShowMcpToolPicker((current) => !current)}>
                  @ 工作区上下文
                </button>
                {showMcpToolPicker ? (
                  <div className="composer-picker-menu">
                    {mcpDiscoveredTools.length > 0 ? (
                      mcpDiscoveredTools.map((tool) => (
                        <button key={tool.id} type="button" onClick={() => handleInsertMcpTool(tool)}>
                          <strong>{tool.name}</strong>
                          <span>{tool.serverName} · {tool.description || "MCP 工具"}</span>
                        </button>
                      ))
                    ) : (
                      <div className="empty-hint">
                        <p>还没有可插入的 MCP 工具。先去设置页读取能力。</p>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              <span className="spacer" />
              <span>{modelConfig.provider}</span>
              <div className="composer-picker-wrap">
                <button type="button" onClick={() => void openModelMenu()}>
                  {compactModelLabel} {reasoningLabel}<SidebarIcon name="chevron-down" />
                </button>
                {composerMenu === "reasoning" ? (
                  <div className="composer-picker-menu composer-reasoning-menu">
                    {reasoningOptions.map((option) => (
                      <button key={`legacy-reasoning-${option.id}`} type="button" onClick={() => { setModelConfig((current: any) => ({ ...current, reasoningEffort: option.id })); setComposerMenu(null); }}>
                        <strong>{option.label}</strong><span>{modelConfig.reasoningEffort === option.id ? "✓" : ""}</span>
                      </button>
                    ))}
                    <div className="composer-reasoning-divider" />
                    <button type="button" className="composer-submenu-trigger" onClick={() => setReasoningSubmenu((current) => current === "model" ? null : "model")}>
                      <strong>{modelLabel}</strong><span>›</span>
                    </button>
                    {reasoningSubmenu === "model" ? (
                      <div className="composer-picker-menu composer-model-submenu">
                        <span className="composer-menu-label">模型</span>
                        {composerModelOptions.map((option, index) => (
                          <button key={`legacy-model-${option.id}-${index}`} type="button" onClick={() => selectOfficialComposerModel(option.id)}>
                            <strong>{option.label}</strong><span>{modelConfig.model.toLowerCase() === option.id.toLowerCase() ? "✓" : ""}</span>
                          </button>
                        ))}
                        {renderCustomModelMenu(reasoningMenuPosition == null)}
                      </div>
                    ) : null}
                    <button type="button" className="composer-submenu-trigger" onClick={() => setReasoningSubmenu((current) => current === "speed" ? null : "speed")}>
                      <strong>速度</strong><span>›</span>
                    </button>
                    {reasoningSubmenu === "speed" ? (
                      <div className="composer-picker-menu composer-speed-submenu">
                        <span className="composer-menu-label">速度</span>
                        {[{ id: "standard", label: "标准" }, { id: "fast", label: "快速" }].map((option) => (
                          <button key={`legacy-speed-${option.id}`} type="button" onClick={() => { setComposerSpeed(option.id as "standard" | "fast"); setReasoningSubmenu(null); setComposerMenu(null); }}>
                            <strong>{option.label}</strong><span>{composerSpeed === option.id ? "✓" : ""}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="composer-icon-button composer-history-button"
                data-testid="composer-undo-button"
                title="撤销写入 (Ctrl+Z)"
                aria-label="撤销写入"
                disabled={
                  !composerDraftHistoryCaps.canUndo
                  || (researchWritingSession.enabled && Boolean(researchWritingSession.requestText))
                }
                onClick={() => {
                  composerTextareaRef.current?.undo();
                  composerTextareaRef.current?.focus();
                }}
              >
                <SidebarIcon name="undo" />
              </button>
              <button
                type="button"
                className="composer-icon-button composer-history-button"
                data-testid="composer-redo-button"
                title="重做写入 (Ctrl+Y)"
                aria-label="重做写入"
                disabled={
                  !composerDraftHistoryCaps.canRedo
                  || (researchWritingSession.enabled && Boolean(researchWritingSession.requestText))
                }
                onClick={() => {
                  composerTextareaRef.current?.redo();
                  composerTextareaRef.current?.focus();
                }}
              >
                <SidebarIcon name="redo" />
              </button>
              <button
                className={`send-btn${(isGlobalModelBusy || brainMessageBusy) && !readComposerQuestion().trim() && composerImages.length === 0 ? " stop-btn" : ""}`}
                data-testid="composer-send-button"
                    disabled={!api || (!(isGlobalModelBusy || brainMessageBusy) && !readComposerQuestion().trim() && composerImages.length === 0)}
                type="button"
                    title={(isGlobalModelBusy || brainMessageBusy) ? "当前对话正在处理中" : "发送"}
                onClick={() => {
                  if ((isGlobalModelBusy || brainMessageBusy) && !readComposerQuestion().trim() && composerImages.length === 0) {
                    void cancelCurrentModelRequest?.();
                    return;
                  }
                  void submitComposerRequest();
                }}
              >
                <SidebarIcon name="arrow-up" />
              </button>
            </div>
          </div>
        </footer>
        )}</section>
    );
  }

  const normalizeDocumentPath = (value: unknown) => String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  const activeBrainFile = searchFilePreview ? brainFiles.find((file) => file.id === activeBrainDocumentFileId) ?? brainFiles.find((file) => {
    const previewPath = normalizeDocumentPath(searchFilePreview.tabPath || searchFilePreview.path || searchFilePreview.name);
    const storageKey = normalizeDocumentPath(file.storageKey);
    const logicalName = normalizeDocumentPath(file.logicalName);
    return previewPath === storageKey || previewPath.endsWith(`/${storageKey}`)
      || previewPath === logicalName || previewPath.endsWith(`/${logicalName}`);
  }) ?? null : null;
  const activeTextAnnotationFormat = (() => {
    const name = String(activeBrainFile?.logicalName || searchFilePreview?.name || "").toLowerCase();
    if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown" as const;
    if (name.endsWith(".txt")) return "txt" as const;
    return null;
  })();
  useEffect(() => {
    if (!activeBrainFile?.id || !selectedBrainProjectId || !window.newbrain?.ingestBrainFile) return;
    const previewKind = searchFilePreview?.kind;
    const markable = previewKind === "pdf" || previewKind === "docx" || previewKind === "pptx" || previewKind === "spreadsheet" || activeTextAnnotationFormat;
    if (!markable) return;
    const ingestFormat = previewKind === "spreadsheet" ? "xlsx" : (activeTextAnnotationFormat || previewKind);
    if (brainDocumentAnchors.length && !documentAnchorsNeedChunkRefresh(ingestFormat, brainDocumentAnchors)) return;
    void window.newbrain.ingestBrainFile({ projectId: selectedBrainProjectId, fileId: activeBrainFile.id })
      .then((result) => {
        setBrainDocumentAnchors(result.anchors || []);
        if (result.warnings?.length) setChatStatus(result.warnings.join(" "));
      })
      .catch((error: unknown) => setChatStatus(error instanceof Error ? error.message : "文档结构解析失败"));
  }, [activeBrainFile?.id, selectedBrainProjectId, searchFilePreview?.kind, activeTextAnnotationFormat]);
  const clearPendingDocumentMark = () => {
    setDocumentAnnotationCandidate(null);
    setDocumentAnnotationInstruction("");
    setDocumentAnnotationGeometry(null);
    setDocumentAnnotationPendingMark(null);
    setDocumentAnnotationSnapshot(null);
  };
  const sendPendingDocumentMark = async () => {
    if (!activeBrainFile || !selectedBrainProjectId || !documentAnnotationCandidate || !documentAnnotationInstruction.trim()) return;
    if (!window.newbrain?.createBrainAnnotation) return;
    setDocumentAnnotationBusy(true);
    try {
      let snapshotGeometry: { snapshotPath?: string; snapshotUrl?: string } = {};
      if (documentAnnotationSnapshot?.dataUrl && api?.saveComposerClipboardFile) {
        const saved = await api.saveComposerClipboardFile({
          name: `annotation-mark-${Date.now()}.png`,
          mimeType: "image/png",
          data: dataUrlToArrayBuffer(documentAnnotationSnapshot.dataUrl)
        });
        snapshotGeometry = { snapshotPath: saved.path, snapshotUrl: saved.url };
      }
      const annotation = await window.newbrain.createBrainAnnotation({
        projectId: selectedBrainProjectId,
        fileId: activeBrainFile.id,
        fileVersion: activeBrainFile.versionNo,
        anchor: documentAnnotationCandidate,
        instruction: documentAnnotationInstruction.trim(),
        geometry: {
          ...(documentAnnotationGeometry ? { style: documentAnnotationGeometry } : { style: { tool: documentMarkingTool, color: documentMarkingColor } }),
          ...snapshotGeometry
        }
      });
      setBrainAnnotations((current) => [annotation, ...current]);
      clearPendingDocumentMark();
      setDocumentAnnotationActive(true);
      const fileName = activeBrainFile.logicalName;
      const snapshotPath = String(annotation.geometry?.snapshotPath || snapshotGeometry.snapshotPath || "").trim();
      const snapshotUrl = resolveAnnotationSnapshotPreview(annotation.geometry) || snapshotGeometry.snapshotUrl || "";
      const reference = buildAnnotationChatReference(annotation, {
        fileName,
        hasSnapshot: Boolean(snapshotPath || snapshotUrl)
      });
      const markLabel = annotation.geometry?.displayIndex || annotation.id;
      submitComposerRequest({
        question: reference,
        images: snapshotPath ? [{
          name: `标记-${markLabel}.png`,
          path: snapshotPath,
          url: snapshotUrl
        }] : [],
        keepComposer: true
      });
      setChatStatus(`标注 ${markLabel} 的修改要求已发送到对话。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDocumentAnnotationBusy(false);
    }
  };
  const handlePreviewMark = (input: {
    format: "pdf" | "image" | "txt" | "markdown" | "docx" | "pptx" | "xlsx";
    rect: { x: number; y: number; width: number; height: number };
    viewport: { width: number; height: number };
    transform: { coordinateSpace: "pdf-points" | "pixels" | "slide-emu" | "sheet-grid"; basisWidth: number; basisHeight: number; scale: number };
    page?: number;
    slide?: number;
    sheet?: string;
    columnCount?: number;
    rowCount?: number;
    lines?: string[];
    docxHost?: HTMLElement | null;
    captureTarget?: HTMLElement | null;
  }) => {
    if (!documentAnnotationActive) return;
    try {
      if (!isValidDocumentMarkRect(input.rect, input.viewport)) {
        throw new Error("无法定位标记区域，请重新框选。");
      }
      let anchor;
      if (input.format === "docx") {
        anchor = resolveDocxAnchorFromMark(input.rect, input.docxHost ?? null, brainDocumentAnchors, input.viewport);
        anchor = attachMarkOverlay(anchor, { rect: input.rect, viewport: input.viewport, transform: input.transform });
      } else if (input.format === "pptx") {
        const slide = input.slide;
        if (typeof slide !== "number" || !Number.isInteger(slide) || slide < 1) throw new Error("无法定位幻灯片页码。");
        anchor = resolvePptxAnchorFromMark(input.rect, input.viewport, slide, brainDocumentAnchors);
        anchor = attachMarkOverlay(anchor, { rect: input.rect, viewport: input.viewport, transform: input.transform });
      } else if (input.format === "pdf") {
        const page = input.page;
        if (typeof page !== "number" || !Number.isInteger(page) || page < 1) throw new Error("无法定位 PDF 页码。");
        anchor = resolvePdfAnchorFromMark(input.rect, input.viewport, page, brainDocumentAnchors, input.transform);
        anchor = attachMarkOverlay(anchor, { rect: input.rect, viewport: input.viewport, transform: input.transform });
      } else if (input.format === "xlsx") {
        const sheet = input.sheet;
        if (!sheet?.trim()) throw new Error("无法定位工作表。");
        anchor = resolveXlsxAnchorFromMark(
          input.rect,
          input.viewport,
          sheet,
          brainDocumentAnchors,
          { columnCount: input.columnCount || 1, rowCount: input.rowCount || 1 }
        );
        anchor = attachMarkOverlay(anchor, { rect: input.rect, viewport: input.viewport, transform: input.transform });
      } else if (input.format === "image") {
        anchor = attachMarkOverlay(
          buildMarkingAnchor({
            format: "image",
            rect: input.rect,
            viewport: input.viewport,
            transform: input.transform
          }),
          { rect: input.rect, viewport: input.viewport, transform: input.transform }
        );
      } else if (input.format === "markdown") {
        anchor = resolveMarkdownAnchorFromMark(input.rect, input.viewport, brainDocumentAnchors, input.lines || []);
      } else if (input.format === "txt") {
        anchor = resolveTxtAnchorFromMark(input.rect, input.viewport, brainDocumentAnchors, input.lines || []);
      } else {
        const totalLines = input.lines?.length || 1;
        const lineHeight = input.viewport.height / Math.max(totalLines, 1);
        const lineRange = linesFromPreviewRect({ rect: input.rect, lineHeight, totalLines });
        const selectedText = (input.lines || []).slice(lineRange.startLine - 1, lineRange.endLine).join("\n");
        anchor = buildMarkingAnchor({
          format: input.format,
          rect: input.rect,
          viewport: input.viewport,
          transform: input.transform,
          lineRange: { ...lineRange, selectedText }
        });
      }
      setDocumentAnnotationCandidate(anchor);
      setDocumentAnnotationGeometry({ tool: documentMarkingTool, color: documentMarkingColor });
      setDocumentAnnotationPendingMark({ rect: input.rect, tool: documentMarkingTool, color: documentMarkingColor });
      setDocumentAnnotationSnapshot(null);
      const captureTarget = input.captureTarget ?? input.docxHost ?? null;
      void captureAnnotationSnapshot({ rect: input.rect, viewport: input.viewport, target: captureTarget })
        .then((snapshot) => {
          setDocumentAnnotationSnapshot(snapshot);
          setChatStatus(snapshot
            ? "已标记区域并捕获截图，请在标记下方填写并发送。"
            : "已标记区域（未捕获截图，将使用文本与位置信息），请在标记下方填写并发送。");
        })
        .catch(() => {
          setChatStatus("已标记区域，请在标记下方填写并发送。");
        });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const openDocumentRevisionTask = async (task: any) => {
    if (task.taskType !== "document.revision") return;
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(String(task.resultJson || "{}")); } catch { payload = {}; }
    const changeSetId = String(payload.changeSetId || "");
    const fileId = String(payload.fileId || "");
    const annotationId = String(payload.annotationId || "");
    const file = brainFiles.find((item) => item.id === fileId);
    const changeSet = brainChangeSets.find((item) => item.id === changeSetId)
      || brainChangeSets.find((item) => item.taskId === task.id);
    const annotation = brainAnnotations.find((item) => item.id === (annotationId || changeSet?.annotationId));
    if (file) {
      setDocumentAnnotationActive(true);
      setDocumentAnnotationCandidate(annotation?.anchor || null);
      await openLocalFilePreview(file.storageKey || file.logicalName, {
        workspaceId: selectedWorkspace?.id,
        ...(file.logicalName ? { displayName: file.logicalName } : {})
      });
    }
    if (changeSet) await previewDocumentChangeSet(changeSet);
    setBrainResourceTab("tasks");
    setBrainResourcePlacement("side");
  };
  const sendDocumentAnnotationToChat = (annotation: any) => {
    if (!String(annotation.instruction || "").trim()) {
      setChatStatus("请先在标注中填写修改要求，再加入对话。");
      return;
    }
    const fileName = activeBrainFile?.id === annotation.fileId
      ? activeBrainFile.logicalName
      : brainFiles.find((file) => file.id === annotation.fileId)?.logicalName;
    const snapshotPath = String(annotation.geometry?.snapshotPath || "").trim();
    const snapshotUrl = resolveAnnotationSnapshotPreview(annotation.geometry);
    const reference = buildAnnotationChatReference(annotation, {
      fileName,
      hasSnapshot: Boolean(snapshotPath || snapshotUrl)
    });
    setQuestion((current) => {
      const next = [current.trim(), reference].filter(Boolean).join("\n\n");
      composerTextareaRef.current?.setValue(next);
      return next;
    });
    setBrainDraft((current) => [current.trim(), reference].filter(Boolean).join("\n\n"));
    if (snapshotPath) {
      const markLabel = annotation.geometry?.displayIndex || annotation.id;
      attachComposerAttachmentsAtCursor([{
        name: `标记-${markLabel}.png`,
        path: snapshotPath,
        url: snapshotUrl || undefined
      }], COMPOSER_FOCUS_ATTACHMENT_LIMIT);
    }
    setChatStatus(snapshotPath
      ? `标注 ${annotation.geometry?.displayIndex || annotation.id} 已加入对话（含区域截图），发送后 Agent 将按附图处理。`
      : `标注 ${annotation.geometry?.displayIndex || annotation.id} 已加入对话输入框，发送后 Agent 将按标记位置处理。`);
  };
  const previewDocumentChangeSet = async (changeSet: any) => {
    if (!selectedBrainProjectId || !window.newbrain?.previewBrainChangeSet) return;
    setDocumentAnnotationBusy(true);
    try {
      setBrainChangeSetPreview(await window.newbrain.previewBrainChangeSet({ projectId: selectedBrainProjectId, changeSetId: changeSet.id }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDocumentAnnotationBusy(false);
    }
  };
  const reviewDocumentChangeSet = async (changeSet: any, status: "ACCEPTED" | "REJECTED") => {
    if (!selectedBrainProjectId || !window.newbrain?.updateBrainChangeSet) return;
    setDocumentAnnotationBusy(true);
    try {
      const updated = await window.newbrain.updateBrainChangeSet({ projectId: selectedBrainProjectId, changeSetId: changeSet.id, status });
      setBrainChangeSets((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (window.newbrain?.listBrainTasks) {
        const tasks = await window.newbrain.listBrainTasks({ projectId: selectedBrainProjectId });
        setBrainTasks(Array.isArray(tasks) ? tasks : []);
      }
      if (status === "REJECTED" && window.newbrain?.listBrainAnnotations) {
        const annotations = await window.newbrain.listBrainAnnotations({ projectId: selectedBrainProjectId });
        setBrainAnnotations(Array.isArray(annotations) ? annotations : []);
      }
      setChatStatus(status === "ACCEPTED" ? "修改方案已接受，可导出为新版本。" : "修改方案已拒绝，原文件未改变。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDocumentAnnotationBusy(false);
    }
  };
  const exportDocumentChangeSet = async (changeSet: any) => {
    if (!selectedBrainProjectId || !window.newbrain?.exportBrainChangeSet) return;
    setDocumentAnnotationBusy(true);
    try {
      const result = await window.newbrain.exportBrainChangeSet({ projectId: selectedBrainProjectId, changeSetId: changeSet.id });
      setBrainChangeSets((current) => current.map((item) => item.id === result.changeSet.id ? result.changeSet : item));
      setBrainFiles((current) => [result.file, ...current.filter((item) => item.id !== result.file.id)]);
      if (window.newbrain?.listBrainTasks) {
        const tasks = await window.newbrain.listBrainTasks({ projectId: selectedBrainProjectId });
        setBrainTasks(Array.isArray(tasks) ? tasks : []);
      }
      if (window.newbrain?.listBrainAnnotations) {
        const annotations = await window.newbrain.listBrainAnnotations({ projectId: selectedBrainProjectId });
        setBrainAnnotations(Array.isArray(annotations) ? annotations : []);
      }
      setChatStatus(`新版本已导出：${result.relativePath}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDocumentAnnotationBusy(false);
    }
  };

function isMarkdownPreviewFile(file: { name?: string; path?: string } | null | undefined) {
  return /\.(?:md|markdown)$/i.test(String(file?.name || file?.path || ""));
}

function renderPreviewModule(placement: Extract<PreviewPlacement, "side" | "center">) {
    const isCenter = placement === "center";
    const savedFileAnnotations = brainAnnotations.filter((annotation) => annotation.fileId === activeBrainFile?.id);
    const documentMarkPrompt = documentAnnotationActive && documentAnnotationPendingMark ? {
      instruction: documentAnnotationInstruction,
      busy: documentAnnotationBusy,
      page: documentAnnotationCandidate ? annotationPageNumber(documentAnnotationCandidate) ?? undefined : undefined,
      onInstructionChange: setDocumentAnnotationInstruction,
      onSubmit: () => { void sendPendingDocumentMark(); },
      onClear: clearPendingDocumentMark
    } : null;

    return (
      <section className={isCenter ? "preview-center-module" : "preview-column"}>
        <header className={isCenter ? "preview-expanded-header" : "preview-header"}>
          {artifactTabs.length && !isCenter ? (
            <div className="artifact-tab-strip" role="tablist" aria-label="打开的文件">
              {artifactTabs.map((tab) => {
                const selected = (searchFilePreview?.tabPath || searchFilePreview?.path) === tab.tabPath;
                const extension = String(tab.name || tab.tabPath).split(".").pop()?.toUpperCase() || "FILE";
                return <button type="button" role="tab" aria-selected={selected} className={`artifact-tab${selected ? " active" : ""}`} key={tab.tabPath} onClick={() => selectArtifactTab(tab)}>
                  <i>{extension.slice(0, 4)}</i>
                  <span>{tab.name || tab.tabPath}</span>
                  <strong role="button" aria-label={`关闭 ${tab.name || tab.tabPath}`} onClick={(event) => { event.stopPropagation(); closeArtifactTab(tab.tabPath); }}>×</strong>
                </button>;
              })}
              <button type="button" className="artifact-tab-add" aria-label="返回文件列表" title="返回文件列表" onClick={() => { setSearchFilePreview(null); setPreviewMode("files"); setPreviewPlacement("side"); void api?.queueWorkspaceScan(); }}><SidebarIcon name="folder" /></button>
            </div>
          ) : previewMode !== "empty" ? (
            <button type="button" className="side-panel-tab" onClick={() => { setPreviewMode("empty"); setPreviewPlacement("hidden"); setSearchFilePreview(null); }}>
              <span>{previewMode === "workspace" ? searchFilePreview?.name || selectedWorkspace?.name || "项目" : previewMode === "review" ? "审查" : previewMode === "terminal" ? "终端" : previewMode === "browser" ? "浏览器" : previewMode === "files" ? "文件" : "侧边聊天"}</span>
              <strong aria-hidden="true">×</strong>
            </button>
          ) : <span />}
          {renderPreviewHeaderActions(isCenter ? "expanded" : "sidebar")}
        </header>
        {searchFilePreview ? (
          <section className="search-file-preview">
            <header>
              <div>
                <strong>{searchFilePreview.name}</strong>
                <span>{searchFilePreview.path}</span>
              </div>
              <div className="artifact-file-actions">
                {!searchFilePreview.loading && !searchFilePreview.error && !searchFilePreview.binary ? (
                  <NovelTtsButton
                    className="artifact-tts"
                    text={String(searchFilePreview.content || "")}
                    sourceText={String(searchFilePreview.content || "")}
                    synthesizer={api?.synthesizeNovelSpeech}
                    canceller={api?.cancelNovelSpeech}
                    onStatus={setChatStatus}
                    onFollow={(target) => applyTtsFollow("preview", undefined, target)}
                  />
                ) : null}
                {!searchFilePreview.loading && !searchFilePreview.error ? (
                  <em>{String(searchFilePreview.kind || searchFilePreview.language || "FILE").toUpperCase()} · {Math.max(1, Math.ceil(searchFilePreview.size / 1024))} KB</em>
                ) : null}
                <button type="button" className="artifact-icon-button" title="刷新" aria-label="刷新预览" onClick={() => {
                  setPreviewFileMenu(false);
                  setHtmlPreviewRefreshToken((token) => token + 1);
                  openLocalFilePreview(searchFilePreview.tabPath || searchFilePreview.path, searchFilePreview.line ? { line: searchFilePreview.line, endLine: searchFilePreview.endLine } : undefined);
                }}>
                  <SidebarIcon name="refresh" />
                </button>
                <button type="button" className="artifact-icon-button" title="下载副本" aria-label="下载副本" onClick={async () => {
                  setPreviewFileMenu(false);
                  try {
                    if (!selectedWorkspace?.id) throw new Error("当前工作区不可用。");
                    const result = await api?.performWorkspaceFileAction?.({ workspaceId: selectedWorkspace.id, filePath: searchFilePreview.path, action: "save-as" });
                    if (result?.detail) setChatStatus(result.detail);
                  } catch (error) {
                    setChatStatus(error instanceof Error ? error.message : "文件另存为失败。");
                  }
                }}>
                  <SidebarIcon name="download" />
                </button>
                {/\.(?:docx|xlsx|pptx)$/i.test(String(searchFilePreview.name || searchFilePreview.path || "")) ? (
                  <button type="button" className="artifact-icon-button" title="用 Word / WPS 打开编辑" aria-label="用系统应用打开" onClick={async () => {
                    setPreviewFileMenu(false);
                    try {
                      const result = await api?.openComposerAttachment?.({ path: searchFilePreview.path });
                      if (result && !result.ok) setChatStatus(result.detail || "文件无法打开");
                      else setChatStatus("已在系统应用中打开，可直接编辑表格与排版。");
                    } catch (error) {
                      setChatStatus(error instanceof Error ? error.message : "文件无法打开");
                    }
                  }}>
                    <SidebarIcon name="external-link" />
                  </button>
                ) : null}
                <div className="artifact-more-wrap">
                  <button type="button" className="artifact-icon-button" title="更多操作" aria-label="更多操作" aria-expanded={previewFileMenu} onClick={() => setPreviewFileMenu((current) => !current)}>
                    <SidebarIcon name="more" />
                  </button>
                  {previewFileMenu ? (
                    <div className="artifact-more-menu" role="menu">
                      <button type="button" onClick={async () => {
                        setPreviewFileMenu(false);
                        try {
                          const result = await api?.openComposerAttachment?.({ path: searchFilePreview.path });
                          if (result && !result.ok) setChatStatus(result.detail || "文件无法打开");
                        } catch (error) {
                          setChatStatus(error instanceof Error ? error.message : "文件无法打开");
                        }
                      }}>用系统应用打开</button>
                      <button type="button" onClick={async () => {
                        setPreviewFileMenu(false);
                        try {
                          if (!selectedWorkspace?.id) throw new Error("当前工作区不可用。");
                          const result = await api?.performWorkspaceFileAction?.({ workspaceId: selectedWorkspace.id, filePath: searchFilePreview.path, action: "reveal" });
                          if (result?.detail) setChatStatus(result.detail);
                          else if (result && !result.ok) setChatStatus("无法在文件夹中显示");
                        } catch (error) {
                          setChatStatus(error instanceof Error ? error.message : "无法在文件夹中显示");
                        }
                      }}>在文件夹中显示</button>
                      <button type="button" onClick={async () => {
                        setPreviewFileMenu(false);
                        try {
                          await copyTextToClipboard(searchFilePreview.path);
                          setChatStatus("已复制文件路径。");
                        } catch {
                          setChatStatus("复制路径失败。");
                        }
                      }}>复制路径</button>
                      <button type="button" onClick={async () => {
                        setPreviewFileMenu(false);
                        try {
                          if (!selectedWorkspace?.id) throw new Error("当前工作区不可用。");
                          const result = await api?.performWorkspaceFileAction?.({ workspaceId: selectedWorkspace.id, filePath: searchFilePreview.path, action: "open-vscode" });
                          if (result && !result.ok) setChatStatus(result.detail || "无法用 VS Code 打开");
                        } catch (error) {
                          setChatStatus(error instanceof Error ? error.message : "无法用 VS Code 打开");
                        }
                      }}>用 VS Code 打开</button>
                    </div>
                  ) : null}
                </div>
                <button type="button" className="artifact-icon-button" title="关闭" aria-label="关闭预览" onClick={() => {
                  setPreviewFileMenu(false);
                  const tabPath = searchFilePreview.tabPath || searchFilePreview.path;
                  if (artifactTabs.some((tab: any) => tab.tabPath === tabPath)) {
                    closeArtifactTab(tabPath);
                  } else {
                    setSearchFilePreview(null);
                    setPreviewMode("empty");
                    setPreviewPlacement("hidden");
                  }
                }}>
                  ×
                </button>
              </div>
            </header>
            <DocumentAnnotationLayer
              file={activeBrainFile}
              annotations={brainAnnotations}
              changeSets={brainChangeSets.filter((changeSet) => brainAnnotations.some((annotation) => annotation.fileId === activeBrainFile?.id && annotation.id === changeSet.annotationId))}
              preview={brainChangeSetPreview}
              active={documentAnnotationActive}
              candidate={documentAnnotationCandidate}
              busy={documentAnnotationBusy}
              markingTool={documentMarkingTool}
              markingColor={documentMarkingColor}
              onToggle={() => {
                setDocumentAnnotationActive((current) => !current);
                clearPendingDocumentMark();
              }}
              onMarkingToolChange={setDocumentMarkingTool}
              onMarkingColorChange={setDocumentMarkingColor}
              onSendToChat={sendDocumentAnnotationToChat}
              onPreviewChangeSet={(changeSet) => void previewDocumentChangeSet(changeSet)}
              onReviewChangeSet={(changeSet, status) => void reviewDocumentChangeSet(changeSet, status)}
              onExportChangeSet={(changeSet) => void exportDocumentChangeSet(changeSet)}
            />
            <div className={`search-file-preview-body${documentAnnotationActive ? " document-marking-active" : ""}`}>
            <DocumentMarkPromptProvider value={documentMarkPrompt}>
            {searchFilePreview.loading ? (
              <div className="search-file-preview-state">正在读取文件...</div>
            ) : searchFilePreview.error || searchFilePreview.blankReason || (!searchFilePreview.binary && !searchFilePreview.kind && !String(searchFilePreview.content || "").length && !searchFilePreview.loading) ? (
              <div className="search-file-preview-state error" data-testid="file-preview-blank-state">
                <strong>{searchFilePreview.error || "预览内容为空"}</strong>
                {searchFilePreview.blankReason ? <span>原因代码：{searchFilePreview.blankReason}</span> : null}
                {searchFilePreview.diagnosticId ? <span>诊断编号：{searchFilePreview.diagnosticId}</span> : null}
                <button
                  type="button"
                  className="artifact-retry-button"
                  onClick={() => openLocalFilePreview(
                    searchFilePreview.tabPath || searchFilePreview.path,
                    {
                      ...(searchFilePreview.line ? { line: searchFilePreview.line, endLine: searchFilePreview.endLine } : {}),
                      ...(searchFilePreview.workspaceId ? { workspaceId: searchFilePreview.workspaceId } : {})
                    }
                  )}
                >
                  重试预览
                </button>
              </div>
            ) : searchFilePreview.kind === "pdf" ? (
              <WorkspacePdfViewer
                dataUrl={searchFilePreview.dataUrl}
                annotationActive={documentAnnotationActive}
                markingTool={documentMarkingTool}
                markingColor={documentMarkingColor}
                savedAnnotations={savedFileAnnotations}
                pendingMark={documentAnnotationPendingMark}
                onMarkComplete={(mark) => handlePreviewMark({
                  format: "pdf",
                  rect: mark.rect,
                  viewport: mark.viewport,
                  page: mark.page,
                  transform: { coordinateSpace: "pdf-points", basisWidth: mark.basisWidth, basisHeight: mark.basisHeight, scale: 1 },
                  captureTarget: mark.captureTarget
                })}
              />
            ) : searchFilePreview.kind === "docx" ? (
              <WorkspaceDocxViewer
                html={String(searchFilePreview.html || "")}
                anchors={brainDocumentAnchors}
                annotationActive={documentAnnotationActive}
                markingTool={documentMarkingTool}
                markingColor={documentMarkingColor}
                savedAnnotations={savedFileAnnotations}
                pendingMark={documentAnnotationPendingMark}
                onMarkComplete={({ rect, viewport, host }) => handlePreviewMark({
                  format: "docx",
                  rect,
                  viewport,
                  transform: { coordinateSpace: "pixels", basisWidth: viewport.width, basisHeight: viewport.height, scale: 1 },
                  docxHost: host,
                  captureTarget: host
                })}
              />
            ) : searchFilePreview.kind === "pptx" ? (
              <div className="workspace-artifact-pptx-shell">
                <WorkspaceArtifactViewerHost
                  preview={searchFilePreview}
                  marking={{
                    annotationActive: documentAnnotationActive,
                    markingTool: documentMarkingTool,
                    markingColor: documentMarkingColor,
                    savedAnnotations: savedFileAnnotations,
                    pendingMark: documentAnnotationPendingMark,
                    chatCollapsed: pptxChatCollapsed,
                    onToggleAnnotation: () => setDocumentAnnotationActive((current) => !current),
                    onToggleChat: () => setPptxChatCollapsed((current) => !current),
                    onMarkComplete: ({ rect, viewport, slide, captureTarget }) => handlePreviewMark({
                      format: "pptx",
                      rect,
                      viewport,
                      slide,
                      transform: { coordinateSpace: "slide-emu", basisWidth: 12_192_000, basisHeight: 6_858_000, scale: 1 },
                      captureTarget
                    })
                  }}
                />
              </div>
            ) : searchFilePreview.kind === "html" ? (
              <WorkspaceHtmlViewer
                name={searchFilePreview.name}
                content={String(searchFilePreview.content || "")}
                previewUrl={String(searchFilePreview.previewUrl || "")}
                refreshToken={htmlPreviewRefreshToken}
              />
            ) : searchFilePreview.kind === "image" ? (
              <div className="workspace-artifact-image">
                <img src={String(searchFilePreview.previewUrl || "")} alt={searchFilePreview.name || "image"} />
                <DocumentMarkingLayer
                  active={documentAnnotationActive}
                  tool={documentMarkingTool}
                  color={documentMarkingColor}
                  savedAnnotations={savedFileAnnotations}
                  pendingMark={documentAnnotationPendingMark}
                  onComplete={({ rect, viewport, host }) => handlePreviewMark({
                    format: "image",
                    rect,
                    viewport,
                    transform: { coordinateSpace: "pixels", basisWidth: viewport.width, basisHeight: viewport.height, scale: 1 },
                    captureTarget: host
                  })}
                />
              </div>
            ) : searchFilePreview.kind === "video" ? (
              <WorkspaceVideoViewer
                previewUrl={String(searchFilePreview.previewUrl || "")}
                name={searchFilePreview.name}
              />
            ) : searchFilePreview.kind === "audio" ? (
              <WorkspaceArtifactViewerHost preview={searchFilePreview} />
            ) : searchFilePreview.kind === "spreadsheet" ? (
              <WorkspaceSpreadsheetViewer
                sheets={Array.isArray(searchFilePreview.sheets) ? searchFilePreview.sheets : []}
                name={searchFilePreview.name}
                marking={{
                  annotationActive: documentAnnotationActive,
                  markingTool: documentMarkingTool,
                  markingColor: documentMarkingColor,
                  savedAnnotations: savedFileAnnotations,
                  pendingMark: documentAnnotationPendingMark,
                  onMarkComplete: ({ rect, viewport, sheet, columnCount, rowCount, captureTarget }) => handlePreviewMark({
                    format: "xlsx",
                    rect,
                    viewport,
                    sheet,
                    columnCount,
                    rowCount,
                    transform: {
                      coordinateSpace: "sheet-grid",
                      basisWidth: Math.max(columnCount, 26),
                      basisHeight: Math.max(rowCount, 50),
                      scale: 1
                    },
                    captureTarget
                  })
                }}
              />
            ) : searchFilePreview.binary ? (
              <div className="search-file-preview-state">这是二进制文件，无法以文本方式预览。</div>
            ) : isMarkdownPreviewFile(searchFilePreview) ? (
              <>
                {searchFilePreview.truncated ? (
                  <div className="search-file-preview-notice">文件较大，仅显示前 512 KB。</div>
                ) : null}
                <div className="workspace-artifact-markdown" data-testid="workspace-markdown-preview">
                  <MarkdownMessage
                    content={String(searchFilePreview.content || "")}
                    workspaceId={selectedWorkspace?.id}
                    onOpenLocalFile={openLocalFilePreview}
                  />
                </div>
              </>
            ) : (
              <>
                {searchFilePreview.truncated ? (
                  <div className="search-file-preview-notice">文件较大，仅显示前 512 KB。</div>
                ) : null}
                <div className="workspace-artifact-text-shell">
                  <pre><code>{(() => {
                  const contentLines = String(searchFilePreview.content || "").split("\n");
                  const textMarks = activeTextAnnotationFormat && activeBrainFile
                    ? renderTextLineMarks({ annotations: savedFileAnnotations, fileId: activeBrainFile.id, format: activeTextAnnotationFormat })
                    : [];
                  return contentLines.map((line: string, index: number) => {
                    const lineNumber = index + 1;
                    const citationSelected = Boolean(searchFilePreview.line)
                      && lineNumber >= searchFilePreview.line
                      && lineNumber <= (searchFilePreview.endLine || searchFilePreview.line);
                    const ttsSelected = ttsFollow?.scope === "preview"
                      && lineNumber >= ttsFollow.line
                      && lineNumber <= ttsFollow.endLine;
                    const lineMark = textMarks.find((mark) => mark.line === lineNumber);
                    const className = [
                      "preview-line",
                      citationSelected ? "selected" : "",
                      ttsSelected ? "tts-active" : "",
                      lineMark?.tool === "highlight" ? "document-marking-line highlight" : "",
                      lineMark?.tool === "select-rect" ? "document-marking-line select-rect" : ""
                    ].filter(Boolean).join(" ");
                    return (
                      <span
                        className={className}
                        data-preview-line={lineNumber}
                        key={lineNumber}
                        style={lineMark ? ({ ["--mark-color" as string]: lineMark.color } as React.CSSProperties) : undefined}
                      >
                        <i>{lineNumber}</i>{line}{index < contentLines.length - 1 ? "\n" : ""}
                      </span>
                    );
                  });
                })()}</code></pre>
                  {activeTextAnnotationFormat ? (
                    <DocumentMarkingLayer
                      active={documentAnnotationActive}
                      tool={documentMarkingTool}
                      color={documentMarkingColor}
                      savedAnnotations={savedFileAnnotations}
                      pendingMark={documentAnnotationPendingMark}
                      onComplete={({ rect, viewport, host }) => handlePreviewMark({
                        format: activeTextAnnotationFormat,
                        rect,
                        viewport,
                        transform: { coordinateSpace: "pixels", basisWidth: viewport.width, basisHeight: viewport.height, scale: 1 },
                        lines: String(searchFilePreview.content || "").split("\n"),
                        captureTarget: host
                      })}
                    />
                  ) : null}
                </div>
              </>
            )}
            </DocumentMarkPromptProvider>
            </div>
          </section>
        ) : renderPreviewPanel(openLocalFilePreview)}</section>
    );
  }

function renderExtensionsModule() {
    if (!selectedExtension) {
      return <section className="extensions-page"><div className="extensions-empty">暂无已安装扩展</div></section>;
    }

    return (
      <section className="extensions-page prototype">
        <header className="extensions-page-toolbar">
          <div className="task-thread-title">
            <h1>扩展</h1>
            <p>集成能力预览；尚未连接凭据存储和服务端 API。</p>
          </div>
          <button type="button" disabled title="真实扩展安装尚未接入">预览功能</button>
        </header>

        <div className="extensions-page-content">
          <section className="extensions-list-pane">
            <div className="extensions-pane-head">
              <div>
                <h2>可预览</h2>
                <span>{extensions.length} 个集成样例</span>
              </div>
              <button type="button" disabled title="真实扩展添加尚未接入">暂未开放</button>
            </div>
            <div className="extensions-table" role="table" aria-label="已安装扩展">
              <div className="extensions-table-row head" role="row">
                <span>扩展</span>
                <span>版本</span>
                <span>状态</span>
                <span>启用</span>
              </div>
              {extensions.map((extension: any) => (
                <div
                  key={extension.id}
                  className={`extensions-table-row${extension.id === selectedExtension.id ? " active" : ""}`}
                  role="row"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedExtensionId(extension.id);
                    setExtensionNotice("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelectedExtensionId(extension.id);
                  }}
                >
                  <span><strong>{extension.name}</strong><em>{extension.summary}</em></span>
                  <span>v{extension.version}</span>
                  <span><i className={`extension-status ${extension.enabled ? "enabled" : "disabled"}`}>{extension.enabled ? "Enabled" : "Disabled"}</i></span>
                  <span>
                    <button
                      className={`extension-switch${extension.enabled ? " active" : ""}`}
                      type="button"
                      role="switch"
                      aria-checked={extension.enabled}
                      aria-label={`${extension.enabled ? "禁用" : "启用"}${extension.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        const next = extensions.map((item: any) => item.id === extension.id ? { ...item, enabled: !item.enabled } : item);
                        persistExtensions(next, `${extension.name}已${extension.enabled ? "禁用" : "启用"}`);
                      }}
                    ><span /></button>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="extensions-detail-pane">
            <div className="extensions-pane-head">
              <div>
                <h2>扩展详情</h2>
                <span>{extensionNotice || "配置权限与连接信息"}</span>
              </div>
              <i className={`extension-detail-state ${selectedExtension.enabled ? "enabled" : "disabled"}`}>
                {selectedExtension.enabled ? "已启用" : "已禁用"}
              </i>
            </div>
            <div className="extensions-detail-form">
              <label>
                <span>名称</span>
                <input value={selectedExtension.name} onChange={(event) => updateSelectedExtension({ name: event.target.value })} />
              </label>
              <label>
                <span>说明</span>
                <textarea rows={3} value={selectedExtension.summary} onChange={(event) => updateSelectedExtension({ summary: event.target.value })} />
              </label>
              <div className="extensions-detail-grid">
                <label>
                  <span>版本</span>
                  <input value={selectedExtension.version} onChange={(event) => updateSelectedExtension({ version: event.target.value })} />
                </label>
                <label>
                  <span>作用域 / Project</span>
                  <input value={selectedExtension.project} onChange={(event) => updateSelectedExtension({ project: event.target.value })} placeholder="NEWBRAIN 或 #channel" />
                </label>
              </div>
              <label>
                <span>权限</span>
                <input
                  value={selectedExtension.permissions.join(", ")}
                  onChange={(event) => updateSelectedExtension({ permissions: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
                  placeholder="repo:read, issues:write"
                />
              </label>
              <div className="extension-permission-list">
                {selectedExtension.permissions.map((permission: string) => <i key={permission}>{permission}</i>)}
              </div>
              <label>
                <span>Base URL</span>
                <input value={selectedExtension.baseUrl} onChange={(event) => updateSelectedExtension({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
              </label>
              <label>
                <span>访问令牌</span>
                <input type="password" value={selectedExtension.token} onChange={(event) => updateSelectedExtension({ token: event.target.value })} placeholder="Token" autoComplete="off" />
              </label>
              <div className="extensions-detail-actions">
                <button
                  type="button"
                  disabled={extensions.length <= 1}
                  onClick={() => {
                    const next = extensions.filter((extension: any) => extension.id !== selectedExtension.id);
                    persistExtensions(next, "扩展已卸载");
                    setSelectedExtensionId(next[0]?.id ?? "");
                  }}
                >卸载</button>
                <button type="button" onClick={() => updateSelectedExtension({}, true)}>保存配置</button>
              </div>
            </div>
          </section>
        </div>
      </section>
    );
  }
function renderSkillsModule() {
    const resolveSkillVisualKey = (name: string) => {
      const key = String(name || "").toLowerCase();
      if (/browser|web|chrome/.test(key)) return "browser";
      if (/excel|sheet|table|sql|db|数据/.test(key)) return "excel";
      if (/image|vision|图/.test(key)) return "image";
      if (/ppt|演示/.test(key)) return "ppt";
      if (/pdf/.test(key)) return "pdf";
      if (/docs|doc|文档|写作|write/.test(key)) return "docs";
      if (/auto|定时|巡检|扫描|schedule/.test(key)) return "automation";
      if (/install|zip|claw|安装/.test(key)) return "installer";
      if (/review|审核|检查/.test(key)) return "review";
      if (/plugin|插件/.test(key)) return "plugin";
      return "skill";
    };
    const skillVisualTone = (name: string) => {
      const map: Record<string, string> = {
        browser: "tone-blue",
        excel: "tone-green",
        image: "tone-rose",
        ppt: "tone-rose",
        pdf: "tone-rose",
        docs: "tone-amber",
        automation: "tone-amber",
        installer: "tone-green",
        review: "tone-green",
        plugin: "tone-violet",
        skill: "tone-violet",
        db: "tone-blue"
      };
      return map[resolveSkillVisualKey(name)] || "tone-blue";
    };
    const renderCapabilityVisual = (name: string, large = false) => {
      const key = resolveSkillVisualKey(name);
      const paths: Record<string, any> = {
        browser: (<><path d="M21.54 15H17a2 2 0 0 0-2 2v4.54" /><path d="M7 3.34V5a3 3 0 0 0 3 3 2 2 0 0 1 2 2c0 1.1.9 2 2 2s2-.9 2-2 .9-2 2-2h3.17" /><path d="M11 21.95V18a2 2 0 0 0-2-2 2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05" /><circle cx="12" cy="12" r="10" /></>),
        excel: (<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18M3 15h18M9 9v12M15 9v12" /></>),
        image: (<><rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></>),
        docs: (<><path d="M12 7v14M16 12h2M16 8h2M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3zM6 12h2M6 8h2" /></>),
        plugin: (<><path d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2" /><rect x="14" y="2" width="8" height="8" rx="1" /></>),
        automation: (<><path d="M4 14a1 1 0 0 1-.8-1.6l9.9-10.2a.5.5 0 0 1 .9.4l-1.9 6A1 1 0 0 0 13 10h7a1 1 0 0 1 .8 1.6l-9.9 10.2a.5.5 0 0 1-.9-.4l1.9-6A1 1 0 0 0 11 14z" /></>),
        ppt: (<><path d="M2 3h20M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3m4 18 5-5 5 5" /></>),
        skill: (<><path d="m21.6 3.6-1.2-1.2a1.2 1.2 0 0 0-1.8 0L2.4 18.6a1.2 1.2 0 0 0 0 1.8l1.2 1.2a1.2 1.2 0 0 0 1.8 0L21.6 5.4a1.2 1.2 0 0 0 0-1.8M14 7l3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9" /></>),
        installer: (<><path d="M12 22v-9M15.2 2.2a1.7 1.7 0 0 1 1.6 0L21 4.6a1.9 1.9 0 0 1 0 3.3L8.8 14.8a1.7 1.7 0 0 1-1.6 0L3 12.4a1.9 1.9 0 0 1 0-3.3zM20 13v3.9a2.1 2.1 0 0 1-1.1 1.8l-6 3.1a1.9 1.9 0 0 1-1.8 0l-6-3.1A2.1 2.1 0 0 1 4 16.9V13" /></>),
        pdf: (<><path d="M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.7.7l3.6 3.6A2.4 2.4 0 0 1 20 8v6M14 2v5a1 1 0 0 0 1 1h5m-6 12 2 2 4-4" /></>),
        review: (<><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><circle cx="12" cy="12" r="3" /><path d="m16 16-1.9-1.9" /></>)
      };
      return (
        <span className={`skill-visual ${skillVisualTone(name)}${large ? " large" : ""}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{paths[key] || paths.skill}</svg>
        </span>
      );
    };
    const skills = featureConfig.skills;
    const query = skillSearchText.trim().toLowerCase();
    const installedSkills = skills
      .filter((skill: any) => RESEARCH_WRITING_PRODUCT_ENABLED || skill.name !== RESEARCH_WRITING_SKILL)
      .filter((skill: any) => (skill.status ?? "enabled") !== "recommended");
    const visibleInstalled = installedSkills
      .filter((skill: any) => {
        if (skillStatusFilter === "enabled") return (skill.status ?? "enabled") === "enabled";
        if (skillStatusFilter === "disabled") return (skill.status ?? "enabled") === "disabled";
        return true;
      })
      .filter((skill: any) => {
        if (!query) return true;
        return [skill.name, skill.summary, skill.source, skill.scope, skill.path].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
      })
      .slice()
      .sort((a: any, b: any) => {
        if (skillSortMode === "status") {
          const ae = (a.status ?? "enabled") === "enabled" ? 1 : 0;
          const be = (b.status ?? "enabled") === "enabled" ? 1 : 0;
          return be - ae || String(a.name || "").localeCompare(String(b.name || ""));
        }
        return String(a.name || "").localeCompare(String(b.name || ""));
      });

    const clawhubVisible = clawhubResults
      .filter((item: any) => {
        if (!query) return true;
        const hay = [item.displayName, item.slug, item.summary, item.ownerHandle].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(query);
      })
      .slice()
      .sort((a: any, b: any) => String(a.displayName || a.slug || "").localeCompare(String(b.displayName || b.slug || "")));

    const list = skillsTab === "installed" ? visibleInstalled : clawhubVisible;
    const pageSize = 6;
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    const page = Math.min(skillCatalogPage, pages);
    const paged = list.slice((page - 1) * pageSize, page * pageSize);
    const selectedSkill = installedSkills.find((skill: any) => skill.id === skillDetailModalId) ?? null;
    const directClawhubAllowed = desktopPreferences?.market?.directClawhubAllowed === true;

    async function persistSkillUpdate(skill: any, nextStatus: string) {
      if (!api?.updateFeatureItem) return;
      const nextConfig = await api.updateFeatureItem({
        kind: "skills",
        id: skill.id,
        item: {
          name: skill.name ?? "",
          summary: skill.summary ?? "",
          status: nextStatus,
          source: skill.source ?? "",
          scope: skill.scope ?? "",
          path: skill.path ?? ""
        }
      });
      setFeatureConfig(nextConfig);
      if (typeof setChatStatus === "function") setChatStatus(`${skill.name} 已${nextStatus === "enabled" ? "启用" : "停用"}`);
    }

    async function toggleSkill(skill: any) {
      const nextStatus = (skill.status ?? "enabled") === "enabled" ? "disabled" : "enabled";
      try {
        await persistSkillUpdate(skill, nextStatus);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }

    async function uninstallSkill(skill: any) {
      if (!api?.deleteFeatureItem) return;
      const confirmed = window.confirm(`卸载后，“${skill.name}”将不能在对话中使用。`);
      if (!confirmed) return;
      try {
        const nextConfig = await api.deleteFeatureItem({ kind: "skills", id: skill.id });
        setFeatureConfig(nextConfig);
        if (typeof setChatStatus === "function") setChatStatus(`${skill.name} 已卸载`);
        if (skillDetailModalId === skill.id) setSkillDetailModalId("");
        setSkillMenuId("");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }

    async function exportSkillZip(skill: any) {
      if (!api?.exportOpenClawSkillZip) {
        setErrorMessage("当前桌面版本尚未启用技能 zip 备份。");
        return;
      }
      try {
        const result = await api.exportOpenClawSkillZip({ skillId: skill.id, skillName: skill.name });
        if (!result?.ok) {
          if (typeof setChatStatus === "function") setChatStatus("已取消技能 zip 备份");
          return;
        }
        if (typeof setChatStatus === "function") {
          setChatStatus(`已备份 ${result.skillName} → ${result.zipPath}（${result.fileCount} 个文件）`);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }

    function openCreatorChat(invocation: string, draft = "") {
      setSelectedSidebarRow("feature:new-chat");
      setErrorMessage?.("");
      setSearchFilePreview(null);
      setActiveFeature("new-chat");
      setNewThreadScope("chat");
      setChatUsesProject?.(false);
      setIsComposingNewThread(true);
      setSelectedThreadId("");
      setQuestion(draft);
      setSelectedComposerSkill(null);
      setComposerSkillContext(invocation);
      setSelectedComposerTools([]);
      setComposerModes([]);
      setPreviewMode("empty");
      setPreviewPlacement("hidden");
      if (typeof setChatStatus === "function") setChatStatus(`已进入 ${invocation}`);
    }

    function startNewSkill() {
      openCreatorChat("Skill Creator", "帮我创建一个可复用技能：");
    }

    function trySkillInChat(skill: any) {
      openCreatorChat(skill.name, `在当前对话中试用技能：${skill.name}`);
      selectComposerSkill(skill);
    }

    async function installClawHubRef(ref: string) {
      const skillRef = String(ref || "").trim();
      if (!skillRef) return;
      if (desktopPreferences?.market?.directClawhubAllowed !== true) {
        setErrorMessage("ClawHub 直连已关闭。请在设置 → 配置中开启，或使用本地 zip 导入。");
        return;
      }
      if (!api?.installOpenClawSkillFromClawHub) {
        setErrorMessage("当前桌面版本尚未启用 ClawHub 安装。");
        return;
      }
      const confirmed = window.confirm(`即将安装社区技能 ${skillRef}。\n\n脚本不会自动执行；请确认已了解风险后再继续。`);
      if (!confirmed) return;
      setClawhubBusy(true);
      setClawhubInstallingRef(skillRef);
      try {
        const result = await api.installOpenClawSkillFromClawHub({ ref: skillRef, acknowledgeRisk: true, force: true });
        const nextConfig = await api.getFeatureConfig();
        setFeatureConfig(nextConfig);
        if (typeof setChatStatus === "function") setChatStatus(`已安装 OpenClaw 技能：${result?.skill?.name || skillRef}`);
        setSkillsTab("installed");
        setSkillCatalogPage(1);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setClawhubBusy(false);
        setClawhubInstallingRef("");
      }
    }

    async function importSkillZipToProject() {
      if (!api?.importSkillZipToProject) {
        setErrorMessage("当前桌面版本还不能把压缩包导入项目。");
        return;
      }
      if (!selectedWorkspace?.path || selectedWorkspace.id === INTERNAL_CHAT_WORKSPACE_ID) {
        setErrorMessage("请先在左侧打开一个本地项目，再导入技能压缩包。");
        return;
      }
      const confirmed = window.confirm(`即将把技能压缩包导入项目「${selectedWorkspace.name || "当前项目"}」。\n\n文件会放到该项目的 .newbrain/skills，脚本不会自动执行。`);
      if (!confirmed) return;
      setClawhubBusy(true);
      try {
        const result = await api.importSkillZipToProject({
          workspaceId: selectedWorkspace.id,
          acknowledgeRisk: true,
          force: true
        });
        if (!result) {
          if (typeof setChatStatus === "function") setChatStatus("已取消项目技能导入");
          return;
        }
        const nextConfig = await api.getFeatureConfig();
        setFeatureConfig(nextConfig);
        if (typeof setChatStatus === "function") setChatStatus(`已导入项目技能：${result.skill?.name || ""}`);
        setSkillsTab("installed");
        setSkillCatalogPage(1);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setClawhubBusy(false);
      }
    }

    async function installOpenClawZip() {
      if (!api?.selectAndInstallOpenClawSkill) {
        setErrorMessage("当前桌面版本尚未启用 OpenClaw zip 安装。");
        return;
      }
      const confirmed = window.confirm("即将从本地 zip 安装 OpenClaw 技能。\n\n脚本不会自动执行；请确认已了解风险后再继续。");
      if (!confirmed) return;
      setClawhubBusy(true);
      try {
        const result = await api.selectAndInstallOpenClawSkill({ acknowledgeRisk: true, force: true });
        if (!result) {
          if (typeof setChatStatus === "function") setChatStatus("已取消 zip 安装");
          return;
        }
        const nextConfig = await api.getFeatureConfig();
        setFeatureConfig(nextConfig);
        if (typeof setChatStatus === "function") setChatStatus(`已从 zip 安装技能：${result.skill?.name}`);
        setSkillsTab("installed");
        setSkillCatalogPage(1);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setClawhubBusy(false);
      }
    }

    const resultMeta = list.length
      ? `显示 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, list.length)}，共 ${list.length} 项`
      : "0 个结果";

    return (
      <section className="capability-catalog skills-page">
        <header className="catalog-heading">
          <div>
            <span className="catalog-kicker">CAPABILITY LIBRARY</span>
            <h1>技能</h1>
            <p>管理可复用的专业工作流，并控制它们在对话中的可用状态。</p>
          </div>
          <button className="catalog-create" type="button" onClick={startNewSkill}>＋ 新建技能</button>
        </header>
        <section className="catalog-surface">
          <div className="catalog-toolbar">
            <div className="catalog-viewbar">
              <div className="catalog-tabs">
                <button className={skillsTab === "installed" ? "active" : ""} type="button" onClick={() => { setSkillsTab("installed"); setSkillCatalogPage(1); }}>已安装</button>
                <button className={skillsTab === "recommended" ? "active" : ""} type="button" onClick={() => { setSkillsTab("recommended"); setSkillCatalogPage(1); }}>可安装</button>
              </div>
              <div className="inline-actions" style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button type="button" data-testid="open-experts-marketplace" onClick={() => { setSelectedSidebarRow("feature:experts"); setActiveFeature("experts"); }}>安装专家包</button>
                <button type="button" data-testid="import-skill-zip-to-project" disabled={clawhubBusy} onClick={() => void importSkillZipToProject()}>{clawhubBusy ? "处理中…" : "导入到项目"}</button>
                {skillsTab === "recommended" ? (
                  <button type="button" disabled={clawhubBusy} onClick={() => void installOpenClawZip()}>{clawhubBusy && !clawhubInstallingRef ? "处理中…" : "从 zip 安装"}</button>
                ) : null}
              </div>
            </div>
            <div className={`catalog-filterbar${skillsTab === "recommended" ? " is-recommended" : ""}`}>
              <label className="catalog-search"><span>⌕</span><input value={skillSearchText} onChange={(event) => { setSkillSearchText(event.target.value); setSkillCatalogPage(1); }} placeholder="搜索名称或能力说明" /></label>
              {skillsTab === "installed" ? (
                <select className="catalog-select" value={skillStatusFilter} onChange={(event) => { setSkillStatusFilter(event.target.value as any); setSkillCatalogPage(1); }} aria-label="技能状态">
                  <option value="all">全部状态</option>
                  <option value="enabled">已启用</option>
                  <option value="disabled">已停用</option>
                </select>
              ) : null}
              <select className="catalog-select" value={skillSortMode} onChange={(event) => setSkillSortMode(event.target.value as any)} aria-label="技能排序">
                <option value="name">按名称排序</option>
                <option value="status">按状态排序</option>
              </select>
              <button className="catalog-icon-button" type="button" title="刷新" onClick={() => void runAction(() => api!.queueWorkspaceScan())} disabled={!api}>↻</button>
            </div>
          </div>
          <div className="catalog-result-bar"><span>{resultMeta}</span><span>每页 {pageSize} 项</span></div>
          {skillsTab === "recommended" ? (
            !directClawhubAllowed ? (
              <div className="empty-state"><div><strong>ClawHub 直连已关闭</strong>仅支持本地 zip 导入。可在设置 → 配置中开启。</div></div>
            ) : (
              <div className="discovery-grid skill-discovery-grid">
                {paged.length ? paged.map((item: any, index: number) => {
                  const ref = item.ownerHandle ? `@${item.ownerHandle}/${item.slug}` : item.slug;
                  const installing = clawhubInstallingRef === ref;
                  return (
                    <article className="discovery-card skill-discovery-card" key={`${ref}-${index}`}>
                      <header>
                        {renderCapabilityVisual(item.displayName || item.slug)}
                        <div><h3>{item.displayName || item.slug}</h3><small>专业工作流</small></div>
                      </header>
                      <p>{item.summary || ref}</p>
                      <div className="discovery-tags"><span>官方推荐</span><span>对话可用</span></div>
                      <footer>
                        <span>OpenClaw</span>
                        <button className="catalog-row-action" type="button" disabled={clawhubBusy} onClick={() => void installClawHubRef(ref)}>{installing ? "安装中…" : "安装"}</button>
                      </footer>
                    </article>
                  );
                }) : <div className="empty-state"><div><strong>{clawhubBusy ? "正在加载…" : "暂无推荐技能"}</strong>{clawhubBusy ? "" : "可从 zip 安装"}</div></div>}
              </div>
            )
          ) : (
            <div className="skill-grid">
              {paged.length ? paged.map((skill: any, index: number) => {
                const enabled = (skill.status ?? "enabled") === "enabled";
                const open = skillMenuId === skill.id;
                return (
                  <article className="skill-row" key={skill.id ?? `${skill.name}-${index}`}>
                    {renderCapabilityVisual(skill.name)}
                    <span className="skill-copy">
                      <strong>{skill.name}</strong>
                      <p>{skill.summary || "暂无描述"}</p>
                      <small>工作区技能 · 可在对话中调用</small>
                    </span>
                    <span className="skill-actions">
                      <button className={`switch ${enabled ? "on" : ""}`} type="button" aria-label={enabled ? "停用技能" : "启用技能"} onClick={() => void toggleSkill(skill)} />
                      <button className="catalog-more" type="button" aria-label={`管理${skill.name}`} onClick={() => setSkillMenuId(open ? "" : skill.id)}>•••</button>
                      {open ? (
                        <div className="catalog-menu-popover" role="menu">
                          <button type="button" onClick={() => { setSkillDetailModalId(skill.id); setSkillMenuId(""); }}>详情</button>
                          <button type="button" onClick={() => { setSkillMenuId(""); void exportSkillZip(skill); }}>备份 zip</button>
                          <button type="button" onClick={() => { setSkillMenuId(""); trySkillInChat(skill); }}>在对话中试用</button>
                          <button type="button" className="danger" onClick={() => { setSkillMenuId(""); void uninstallSkill(skill); }}>卸载</button>
                        </div>
                      ) : null}
                    </span>
                  </article>
                );
              }) : <div className="empty-state"><div><strong>未找到技能</strong>调整关键词或状态筛选</div></div>}
            </div>
          )}
          <footer className="catalog-pagination">
            <span>第 {page} / {pages} 页</span>
            <div>
              <button type="button" disabled={page <= 1} onClick={() => setSkillCatalogPage((current) => Math.max(1, current - 1))} aria-label="上一页">←</button>
              <button type="button" disabled={page >= pages} onClick={() => setSkillCatalogPage((current) => Math.min(pages, current + 1))} aria-label="下一页">→</button>
            </div>
          </footer>
        </section>

        {selectedSkill ? (
          <div className="catalog-modal-backdrop" role="presentation" onClick={() => setSkillDetailModalId("")}>
            <section className="catalog-modal wide" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <header className="catalog-modal-head">
                <h2>详情</h2>
                <button type="button" className="icon-btn" aria-label="关闭" onClick={() => setSkillDetailModalId("")}>×</button>
              </header>
              <div className="catalog-modal-body">
                <div className="skill-detail-head">
                  {renderCapabilityVisual(selectedSkill.name, true)}
                  <div>
                    <h2>{selectedSkill.name} <span>Skill</span></h2>
                    <p>{selectedSkill.summary || "暂无描述"}</p>
                  </div>
                  <div className="skill-actions">
                    <button className={`switch ${(selectedSkill.status ?? "enabled") === "enabled" ? "on" : ""}`} type="button" onClick={() => void toggleSkill(selectedSkill)} />
                    <button className="catalog-row-action danger-text" type="button" onClick={() => void uninstallSkill(selectedSkill)}>卸载</button>
                  </div>
                </div>
                <div className="skill-instructions">
                  <h3>{selectedSkill.name} 使用说明</h3>
                  <p>来源：{selectedSkill.source || "local"} · 作用域：{selectedSkill.scope || "global"} · 路径：{selectedSkill.path || "未配置"}</p>
                  <ol>
                    <li>读取当前对话及用户明确提供的文件。</li>
                    <li>按照技能定义执行稳定、可复用的工作流。</li>
                    <li>遇到缺失信息时先说明具体缺口。</li>
                    <li>输出结果后给出验证状态和可继续操作的文件。</li>
                  </ol>
                </div>
              </div>
              <footer className="catalog-modal-foot">
                <button type="button" onClick={() => setSkillDetailModalId("")}>关闭</button>
                <button className="catalog-create" type="button" onClick={() => { setSkillDetailModalId(""); trySkillInChat(selectedSkill); }}>在对话中试用</button>
              </footer>
            </section>
          </div>
        ) : null}
      </section>
    );
  }
function renderPluginsModule() {
    const pluginCatalog = [
      { id: "plugin-git-console", name: "Git Console", summary: "内置 Git 工作区助手，用于查看状态、分支和仓库操作。", version: "内置", source: "NewBrain", capabilities: ["git", "workspace"], category: "精选", color: "emerald", bundled: true, tags: ["内置", "精选"], published: "", calls: "", success: "", latency: "" },
      { id: "plugin-shell-runner", name: "Shell Runner", summary: "内置命令执行器，支持审批模式下运行 shell 命令。", version: "内置", source: "NewBrain", capabilities: ["shell", "approval"], category: "精选", color: "orange", bundled: true, tags: ["内置", "精选"], published: "", calls: "", success: "", latency: "" },
      ...builtinPluginCatalog.map((plugin) => ({ ...plugin, version: "1.0.0", source: "NewBrain", bundled: true, tags: ["内置", plugin.category].filter(Boolean), published: "", calls: "", success: "", latency: "" })),
      ...repositoryPlugins.map((plugin) => ({
        ...plugin,
        tags: [plugin.source, plugin.category, plugin.executionKind].filter(Boolean),
        published: plugin.published || plugin.updatedAt || "",
        calls: plugin.calls || plugin.installCount || "",
        success: plugin.success || "",
        latency: plugin.latency || "",
        workspaceCalls: plugin.workspaceCalls || "",
        workspaceSuccess: plugin.workspaceSuccess || "",
        workspaceLatency: plugin.workspaceLatency || "",
        detail: plugin.detail || plugin.summary
      }))
    ];
    const installedIds = new Set((featureConfig.plugins ?? []).map((plugin: any) => plugin.id));
    const categories = ["全部", "自动推荐", ...[...new Set(pluginCatalog.map((plugin) => plugin.category || "其他"))].filter((item) => item && item !== "全部")];
    let visiblePlugins = pluginCatalog
      .map((plugin) => ({ ...plugin, installed: Boolean(plugin.installed || plugin.bundled || installedIds.has(plugin.id)) }))
      .filter((plugin) => pluginMarketTab === "all" || plugin.installed)
      .filter((plugin) => pluginCategoryFilter === "全部" || pluginCategoryFilter === "自动推荐" || (plugin.category || "其他") === pluginCategoryFilter)
      .filter((plugin) => {
        if (pluginVendorFilter === "全部来源") return true;
        if (pluginVendorFilter === "由 NewBrain 构建" || pluginVendorFilter === "由 OpenAI 构建") return plugin.bundled || plugin.source === "NewBrain" || String(plugin.tags || []).includes("官方");
        return String(plugin.source || "").includes(pluginVendorFilter.split(" ")[0]);
      })
      .filter((plugin) => {
        const query = pluginSearchQuery.trim().toLowerCase();
        if (!query) return true;
        return [plugin.name, plugin.summary, plugin.category, plugin.source, ...(plugin.capabilities || []), ...(plugin.tags || [])].some((value) => String(value).toLowerCase().includes(query));
      });
    visiblePlugins = visiblePlugins.slice().sort((a: any, b: any) => {
      if (pluginSortMode === "name") return String(a.name).localeCompare(String(b.name));
      if (pluginSortMode === "installed") return Number(b.installed) - Number(a.installed) || String(a.name).localeCompare(String(b.name));
      return String(b.calls || b.version || "").localeCompare(String(a.calls || a.version || "")) || String(a.name).localeCompare(String(b.name));
    });
    const discovery = pluginMarketTab === "all";
    const pageSize = discovery ? 6 : 4;
    const pages = Math.max(1, Math.ceil(visiblePlugins.length / pageSize));
    const page = Math.min(pluginCatalogPage, pages);
    const paged = visiblePlugins.slice((page - 1) * pageSize, page * pageSize);
    const selectedPluginRaw = pluginCatalog.find((plugin) => plugin.id === pluginDetailModalId) ?? null;
    const selectedPlugin = selectedPluginRaw
      ? { ...selectedPluginRaw, installed: Boolean(selectedPluginRaw.installed || selectedPluginRaw.bundled || installedIds.has(selectedPluginRaw.id)) }
      : null;
    const emptyCopy = pluginMarketTab === "installed" ? "暂无已安装的插件，请您先在全部中进行插件的安装" : "没有匹配的插件，请更换分类或搜索词";
    const resultMeta = visiblePlugins.length
      ? `显示 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, visiblePlugins.length)}，共 ${visiblePlugins.length} 项`
      : "0 个结果";

    function openCreatorChat(invocation: string, draft = "") {
      setSelectedSidebarRow("feature:new-chat");
      setErrorMessage?.("");
      setSearchFilePreview(null);
      setActiveFeature("new-chat");
      setNewThreadScope("chat");
      setChatUsesProject?.(false);
      setIsComposingNewThread(true);
      setSelectedThreadId("");
      setQuestion(draft);
      setSelectedComposerSkill(null);
      setComposerSkillContext(invocation);
      setSelectedComposerTools([]);
      setComposerModes([]);
      setPreviewMode("empty");
      setPreviewPlacement("hidden");
      if (typeof setChatStatus === "function") setChatStatus(`已进入 ${invocation}`);
    }

    function startNewPlugin() {
      openCreatorChat("Plugin Creator", "help me create a plugin");
    }

    async function installCatalogPlugin(plugin: any) {
      if (plugin.bundled) return;
      const isUpgrade = plugin.repository && plugin.installState === "update_available";
      if (!isUpgrade && installedIds.has(plugin.id)) return;
      if (plugin.repository && api?.installRepositoryPlugin) {
        try {
          if (typeof setChatStatus === "function") setChatStatus(isUpgrade ? `正在升级 ${plugin.name}…` : `正在安装 ${plugin.name}…`);
          await api.installRepositoryPlugin({ pluginKey: plugin.pluginKey, version: plugin.version });
          await loadRepositoryPlugins();
          if (api.getFeatureConfig) setFeatureConfig(await api.getFeatureConfig());
          if (typeof setChatStatus === "function") setChatStatus(isUpgrade ? `${plugin.name} 已升级，历史数据已保留。` : `${plugin.name} 已安装，技能已同步到 Composer。`);
        } catch (error) {
          if (typeof setChatStatus === "function") setChatStatus(error instanceof Error ? error.message : String(error));
        }
        return;
      }
      if (typeof setChatStatus === "function") {
        setChatStatus(`${plugin.name} 暂无可激活的插件 manifest，未执行安装。请使用“新建插件”在对话中创建。`);
      }
    }

    async function setCatalogPluginEnabled(plugin: any, enabled: boolean) {
      if (!plugin.repository || !api?.setRepositoryPluginEnabled) return;
      try {
        await api.setRepositoryPluginEnabled({ pluginKey: plugin.pluginKey, enabled });
        await loadRepositoryPlugins();
        if (api.getFeatureConfig) setFeatureConfig(await api.getFeatureConfig());
      } catch (error) {
        if (typeof setChatStatus === "function") setChatStatus(error instanceof Error ? error.message : String(error));
      }
    }

    async function removeCatalogPlugin(plugin: any) {
      if (!plugin.repository || !api?.removeRepositoryPlugin) return;
      const confirmed = window.confirm(`卸载后，对话将不能再调用“${plugin.name}”。`);
      if (!confirmed) return;
      try {
        await api.removeRepositoryPlugin({ pluginKey: plugin.pluginKey });
        await loadRepositoryPlugins();
        if (api.getFeatureConfig) setFeatureConfig(await api.getFeatureConfig());
        if (typeof setChatStatus === "function") setChatStatus(`${plugin.name} 已卸载`);
        setExpandedPluginId("");
        setPluginDetailModalId("");
      } catch (error) {
        if (typeof setChatStatus === "function") setChatStatus(error instanceof Error ? error.message : String(error));
      }
    }

    async function togglePluginAction(plugin: any) {
      if (plugin.bundled) return;
      if (plugin.installed) {
        if (plugin.repository) await removeCatalogPlugin(plugin);
        return;
      }
      await installCatalogPlugin(plugin);
    }

    return (
      <section className="capability-catalog plugins-page">
        <header className="catalog-heading">
          <div>
            <span className="catalog-kicker">INTEGRATION DIRECTORY</span>
            <h1>插件</h1>
            <p>连接外部服务和实时数据源，让对话能够读取、查询和执行操作。</p>
          </div>
          <button className="catalog-create" type="button" onClick={startNewPlugin}>＋ 新建插件</button>
        </header>
        <section className="catalog-surface">
          <div className="catalog-toolbar plugin-catalog-toolbar">
            <div className="catalog-viewbar">
              <div className="catalog-tabs">
                <button className={pluginMarketTab === "all" ? "active" : ""} type="button" onClick={() => { setPluginMarketTab("all"); setPluginCatalogPage(1); setExpandedPluginId(""); }}>插件市场</button>
                <button className={pluginMarketTab === "installed" ? "active" : ""} type="button" onClick={() => { setPluginMarketTab("installed"); setPluginCatalogPage(1); setExpandedPluginId(""); }}>已安装</button>
              </div>
            </div>
            <div className="catalog-filterbar plugin-filterbar">
              <label className="catalog-search"><span>⌕</span><input value={pluginSearchQuery} onChange={(event) => { setPluginSearchQuery(event.target.value); setPluginCatalogPage(1); }} placeholder="搜索插件、分类或提供方" /></label>
              <select className="catalog-select" value={pluginVendorFilter} onChange={(event) => { setPluginVendorFilter(event.target.value); setPluginCatalogPage(1); }} aria-label="插件来源">
                <option>全部来源</option>
                <option>由 NewBrain 构建</option>
                <option>扣子官方</option>
              </select>
              <select className="catalog-select" value={pluginSortMode} onChange={(event) => { setPluginSortMode(event.target.value as any); setPluginCatalogPage(1); }} aria-label="插件排序">
                <option value="popular">按热度排序</option>
                <option value="name">按名称排序</option>
                <option value="installed">已安装优先</option>
              </select>
              <button className="catalog-icon-button" type="button" title="刷新" onClick={() => void loadRepositoryPlugins()}>↻</button>
            </div>
          </div>
          <div className="category-strip" aria-label="插件分类">
            {categories.map((category) => (
              <button key={category} type="button" className={`market-filter${pluginCategoryFilter === category ? " active" : ""}`} onClick={() => { setPluginCategoryFilter(category); setPluginCatalogPage(1); }}>{category}</button>
            ))}
          </div>
          <div className="catalog-result-bar"><span>{resultMeta}</span><span>每页 {pageSize} 项</span></div>
          {repositoryPluginsLoading && !paged.length ? <div className="empty-state">正在加载插件仓库…</div> : null}
          {repositoryPluginError ? <div className="empty-state error">{repositoryPluginError}</div> : null}
          {discovery ? (
            <div className="discovery-grid plugin-discovery-grid">
              {paged.length ? paged.map((plugin: any) => (
                <article className="discovery-card plugin-discovery-card" key={plugin.id}>
                  <header>
                    <span className={`skill-visual tone-${({ emerald: "green", orange: "amber", blue: "blue", violet: "violet", rose: "rose" } as any)[plugin.color] || "blue"}`}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
                    </span>
                    <div><h3>{plugin.name}</h3><small>{plugin.category || "其他"}</small></div>
                    {plugin.installed ? <span className="catalog-status installed">已安装</span> : null}
                  </header>
                  <p>{plugin.summary}</p>
                  <div className="discovery-tags">{(plugin.tags || []).slice(0, 3).map((tag: string) => <span key={tag}>{tag}</span>)}</div>
                  <div className="plugin-market-info">
                    <span><small>适用于</small><b>{plugin.category || "其他"}</b></span>
                    <span><small>所需权限</small><b>网络访问</b></span>
                    <span><small>更新时间</small><b>{String(plugin.published || plugin.version || "—").slice(0, 10)}</b></span>
                  </div>
                  <footer>
                    <span>{plugin.source || "NewBrain"}</span>
                    <div>
                      <button className="catalog-more" type="button" onClick={() => setPluginDetailModalId(plugin.id)}>详情</button>
                      {plugin.bundled ? (
                        <button className="catalog-row-action" type="button" disabled>内置</button>
                      ) : (
                        <button className={`catalog-row-action${plugin.installed ? " danger-text" : ""}`} type="button" onClick={() => void togglePluginAction(plugin)}>
                          {plugin.installState === "update_available" ? "升级" : plugin.installed ? "卸载" : "添加"}
                        </button>
                      )}
                    </div>
                  </footer>
                </article>
              )) : (!repositoryPluginsLoading ? <div className="empty-state"><div><strong>{emptyCopy}</strong></div></div> : null)}
            </div>
          ) : (
            <div className="plugin-list">
              {paged.length ? paged.map((plugin: any) => {
                const expanded = expandedPluginId === plugin.id;
                return (
                  <article className={`plugin-card${expanded ? " expanded" : ""}`} key={plugin.id}>
                    <div className="plugin-summary installed-layout" onClick={() => setExpandedPluginId(expanded ? "" : plugin.id)}>
                      <span className="skill-visual tone-blue">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
                      </span>
                      <div className="plugin-copy">
                        <div className="plugin-title-row"><h3>{plugin.name}</h3><span className="catalog-status installed">已安装</span></div>
                        <p>{plugin.summary}</p>
                        <div className="plugin-meta"><span>{plugin.category || "其他"}</span><span>{plugin.source || "NewBrain"}</span><span>{plugin.version || "—"}</span></div>
                      </div>
                      <div className="plugin-stats">
                        <span><small>本工作区调用</small><b>{plugin.workspaceCalls || plugin.calls || "暂无"}</b></span>
                        <span><small>成功率</small><b>{plugin.workspaceSuccess || plugin.success || "暂无"}</b></span>
                        <span><small>平均延迟</small><b>{plugin.workspaceLatency || plugin.latency || "暂无"}</b></span>
                      </div>
                      <div className="plugin-actions" onClick={(event) => event.stopPropagation()}>
                        {plugin.repository && plugin.installState === "update_available" ? (
                          <button className="catalog-row-action" type="button" onClick={() => void installCatalogPlugin(plugin)}>升级</button>
                        ) : null}
                        {plugin.repository ? (
                          <button className="catalog-row-action" type="button" onClick={() => void setCatalogPluginEnabled(plugin, plugin.installState === "disabled")}>
                            {plugin.installState === "disabled" ? "启用" : "停用"}
                          </button>
                        ) : null}
                        {!plugin.bundled ? (
                          <button className="catalog-row-action danger-text" type="button" onClick={() => void togglePluginAction(plugin)}>卸载</button>
                        ) : null}
                        <button className="catalog-more" type="button" onClick={() => setExpandedPluginId(expanded ? "" : plugin.id)}>{expanded ? "收起" : "详情"}</button>
                      </div>
                    </div>
                    {expanded ? (
                      <div className="plugin-detail">
                        <h4>{plugin.name} 的能力与权限</h4>
                        <p>{plugin.detail || plugin.summary}</p>
                        <div className="discovery-tags">
                          <span>网络访问</span>
                          <span>对话调用</span>
                          <span>{executionKindLabel(plugin.executionKind)}</span>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              }) : <div className="empty-state"><div><strong>{emptyCopy}</strong></div></div>}
            </div>
          )}
          <footer className="catalog-pagination">
            <span>第 {page} / {pages} 页</span>
            <div>
              <button type="button" disabled={page <= 1} onClick={() => { setPluginCatalogPage((current) => Math.max(1, current - 1)); setExpandedPluginId(""); }} aria-label="上一页">←</button>
              <button type="button" disabled={page >= pages} onClick={() => { setPluginCatalogPage((current) => Math.min(pages, current + 1)); setExpandedPluginId(""); }} aria-label="下一页">→</button>
            </div>
          </footer>
        </section>

        {selectedPlugin ? (
          <div className="catalog-modal-backdrop" role="presentation" onClick={() => setPluginDetailModalId("")}>
            <section className="catalog-modal wide" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <header className="catalog-modal-head">
                <h2>{selectedPlugin.name}</h2>
                <button type="button" className="icon-btn" aria-label="关闭" onClick={() => setPluginDetailModalId("")}>×</button>
              </header>
              <div className="catalog-modal-body">
                <p>{selectedPlugin.summary}</p>
                <div className="discovery-tags">{(selectedPlugin.tags || []).map((tag: string) => <span key={tag}>{tag}</span>)}</div>
                <div className="skill-instructions">
                  <h3>能力与权限</h3>
                  <p>{selectedPlugin.detail || selectedPlugin.summary}</p>
                  <p>提供方：{selectedPlugin.source || "NewBrain"} · 版本 {selectedPlugin.version || "—"}</p>
                </div>
              </div>
              <footer className="catalog-modal-foot">
                <button type="button" onClick={() => setPluginDetailModalId("")}>关闭</button>
                {!selectedPlugin.bundled ? (
                  <button className={`catalog-create${selectedPlugin.installed ? " danger" : ""}`} type="button" onClick={() => { setPluginDetailModalId(""); void togglePluginAction(selectedPlugin); }}>
                    {selectedPlugin.installed ? "卸载插件" : "添加插件"}
                  </button>
                ) : null}
              </footer>
            </section>
          </div>
        ) : null}
      </section>
    );
  }
function renderMcpModule() {
    const servers = mcpServers;
    const filteredServers = servers.filter((server: any) => {
      const query = mcpSearchQuery.trim().toLowerCase();
      if (!query) return true;
      return [server.name, server.transport, server.command, server.args, server.url]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
    const visibleServers = filteredServers.length > 0 ? filteredServers : servers;
    const selectedServer = visibleServers.find((server: any) => server.id === editingMcpId) ?? visibleServers[0];
    const draft = editingMcpId ? mcpDraft : selectedServer ?? mcpDraft;
    const selectedHealth = selectedServer ? mcpHealth[selectedServer.id] : undefined;
    const selectedInspection = selectedServer ? mcpInspection[selectedServer.id] : undefined;
    const selectedTools = selectedServer
      ? mcpDiscoveredTools.filter((tool: any) => tool.serverId === selectedServer.id)
      : [];
    const selectedWindow = desktopWindows.find((windowItem: any) => {
      const key = `${windowItem.processId}:${windowItem.title}`;
      return key === selectedDesktopWindowKey;
    }) ?? desktopWindows[0];

    async function refreshDesktopWindows() {
      if (!api?.windowControl?.list) {
        setWindowControlMessage("当前系统不支持本机窗口开箱操控（仅 Windows）。");
        return;
      }
      setWindowControlBusy(true);
      try {
        const windows = await api.windowControl.list();
        const list = Array.isArray(windows) ? windows : [];
        setDesktopWindows(list);
        if (list[0]) setSelectedDesktopWindowKey(`${list[0].processId}:${list[0].title}`);
        setWindowControlMessage(list.length ? `已发现 ${list.length} 个可操作窗口。` : "未发现可操作窗口。");
      } catch (error) {
        setWindowControlMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setWindowControlBusy(false);
      }
    }

    async function activateSelectedWindow() {
      if (!selectedWindow || !api?.windowControl?.activate) return;
      setWindowControlBusy(true);
      try {
        await api.windowControl.activate({
          processId: selectedWindow.processId,
          processName: selectedWindow.processName,
          windowTitle: selectedWindow.title
        });
        setWindowControlMessage(`已聚焦：${selectedWindow.title || selectedWindow.processName}`);
      } catch (error) {
        setWindowControlMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setWindowControlBusy(false);
      }
    }

    return (
      <section className="mcp-page prototype software-link-page">
        <header className="mcp-page-toolbar">
          <div className="mcp-page-title">
            <h1>软件联动</h1>
            <p>开箱控制任意 Windows 窗口；无需先配置 MCP。MCP 仅作为高级扩展。</p>
          </div>
        </header>

        <div className="software-link-main">
          <section className="software-link-card">
            <div className="software-link-card-head">
              <div>
                <h2>本机窗口</h2>
                <span>{windowControlSupported ? "列表 / 聚焦 / 输入 / 截屏" : "当前平台占位"}</span>
              </div>
              <button type="button" disabled={!windowControlSupported || windowControlBusy} onClick={() => void refreshDesktopWindows()}>
                {windowControlBusy ? "刷新中…" : "刷新窗口列表"}
              </button>
            </div>
            {!windowControlSupported ? (
              <p className="software-link-empty">macOS / Ubuntu 暂不提供本机窗口开箱操控；请在 Windows 桌面版使用。</p>
            ) : (
              <>
                <div className="software-window-list" role="list">
                  {desktopWindows.length === 0 ? (
                    <p className="software-link-empty">点击「刷新窗口列表」发现当前桌面上的应用窗口。</p>
                  ) : desktopWindows.map((windowItem: any) => {
                    const key = `${windowItem.processId}:${windowItem.title}`;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="listitem"
                        className={`software-window-item${key === selectedDesktopWindowKey ? " active" : ""}`}
                        onClick={() => setSelectedDesktopWindowKey(key)}
                      >
                        <strong>{windowItem.title || windowItem.processName || "未命名窗口"}</strong>
                        <em>{windowItem.processName} · PID {windowItem.processId}</em>
                      </button>
                    );
                  })}
                </div>
                <div className="software-link-actions">
                  <button type="button" className="primary" disabled={!selectedWindow || windowControlBusy} onClick={() => void activateSelectedWindow()}>
                    测试聚焦
                  </button>
                  <span>{windowControlMessage}</span>
                </div>
              </>
            )}
          </section>

          <details className="software-link-advanced" open={mcpAdvancedOpen} onToggle={(event) => setMcpAdvancedOpen((event.target as HTMLDetailsElement).open)}>
            <summary>高级：MCP 服务器</summary>
            <div className="mcp-page-content prototype">
              <section className="mcp-list-pane">
                <div className="mcp-pane-head">
                  <div>
                    <h2>服务器列表</h2>
                    <span>{visibleServers.length} / {servers.length} 个服务器</span>
                  </div>
                  <button type="button" onClick={() => resetMcpDraft()}>新建</button>
                </div>
                <div className="mcp-table" role="table" aria-label="MCP 服务器列表">
                  <div className="mcp-table-row head" role="row">
                    <span>名称</span>
                    <span>地址</span>
                    <span>状态</span>
                    <span>工具</span>
                  </div>
                  {visibleServers.map((server: any, index: number) => {
                    const health = mcpHealth[server.id];
                    const tools = mcpDiscoveredTools.filter((tool: any) => tool.serverId === server.id);
                    const active = (editingMcpId && editingMcpId === server.id) || (!editingMcpId && index === 0);
                    const endpoint = server.transport === "sse" ? server.url : server.command || "local";
                    return (
                      <button key={server.id} type="button" role="row" className={`mcp-table-row${active ? " active" : ""}`} onClick={() => loadMcpDraft(server)}>
                        <span><strong>{server.name}</strong><em>{server.transport}</em></span>
                        <span>{endpoint}</span>
                        <span><i className={`mcp-status ${health?.ok ? "ok" : server.enabled ? "pending" : "disabled"}`}>{health?.ok ? "OK" : server.enabled ? "待检测" : "Disabled"}</i></span>
                        <span>{tools.length || mcpInspection[server.id]?.tools?.length || "?"}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
              <section className="mcp-detail-pane">
                <div className="mcp-pane-head">
                  <div>
                    <h2>服务器详情</h2>
                    <span>{draft?.name || "添加一个 MCP 服务器"}</span>
                  </div>
                  <button type="button" disabled={!selectedServer || testingMcpId === selectedServer.id} onClick={() => selectedServer && void handleTestMcpServer(selectedServer)}>
                    {selectedServer && testingMcpId === selectedServer.id ? "测试中" : "测试连接"}
                  </button>
                </div>
                <div className="mcp-detail-form">
                  <div className="mcp-detail-grid">
                    <label>
                      <span>名称</span>
                      <input value={draft?.name ?? ""} onChange={(event) => setMcpDraft((current: any) => ({ ...current, name: event.target.value }))} placeholder="node-repl" />
                    </label>
                    <label>
                      <span>传输方式</span>
                      <select value={draft?.transport ?? "stdio"} onChange={(event) => setMcpDraft((current: any) => ({ ...current, transport: event.target.value }))}>
                        <option value="stdio">stdio</option>
                        <option value="sse">sse</option>
                      </select>
                    </label>
                  </div>
                  {(draft?.transport ?? "stdio") === "stdio" ? (
                    <div className="mcp-detail-grid">
                      <label><span>启动命令</span><input value={draft?.command ?? ""} onChange={(event) => setMcpDraft((current: any) => ({ ...current, command: event.target.value }))} placeholder="node" /></label>
                      <label><span>参数</span><input value={draft?.args ?? ""} onChange={(event) => setMcpDraft((current: any) => ({ ...current, args: event.target.value }))} placeholder="server.mjs" /></label>
                    </div>
                  ) : (
                    <label><span>服务地址</span><input value={draft?.url ?? ""} onChange={(event) => setMcpDraft((current: any) => ({ ...current, url: event.target.value }))} placeholder="http://127.0.0.1:9000" /></label>
                  )}
                  <label><span>环境变量</span><textarea value={draft?.env ?? ""} onChange={(event) => setMcpDraft((current: any) => ({ ...current, env: event.target.value }))} rows={4} placeholder="KEY=value" /></label>
                  <div className="mcp-state-strip">
                    <span className={`mcp-status ${selectedHealth?.ok ? "ok" : "pending"}`}>{selectedHealth?.ok ? "Connected" : "未检测"}</span>
                    <strong>{selectedHealth?.detail || "测试连接后显示服务器状态"}</strong>
                  </div>
                  <div className="mcp-capabilities">
                    <span>能力与工具</span>
                    <div>
                      {(selectedTools.length > 0 ? selectedTools : selectedInspection?.tools ?? []).map((tool: any) => (
                        <button key={tool.id ?? tool.name} type="button" onClick={() => tool.id && handleInsertMcpTool(tool)}>{tool.name}</button>
                      ))}
                      {selectedTools.length === 0 && !(selectedInspection?.tools?.length) ? <em>读取能力后显示工具列表</em> : null}
                    </div>
                  </div>
                  <div className="mcp-detail-actions">
                    <button type="button" disabled={!selectedServer} onClick={() => selectedServer && void handleInspectMcpServer(selectedServer)}>读取能力</button>
                    <button type="button" disabled={!selectedServer} onClick={() => selectedServer && void handleToggleMcpServer(selectedServer.id)}>{selectedServer?.enabled ? "停用" : "启用"}</button>
                    <button type="button" disabled={!selectedServer} onClick={() => selectedServer && void handleDeleteMcpServer(selectedServer.id)}>移除</button>
                    <button className="primary" type="button" onClick={() => void handleSaveMcpServer()}>{editingMcpId ? "保存服务器" : "添加服务器"}</button>
                  </div>
                </div>
              </section>
            </div>
          </details>
        </div>
      </section>
    );
  }
function renderAutomationModule() {
    const automationItems = featureConfig.automations.length > 0
      ? featureConfig.automations
      : [
          {
            id: "daily-workspace-scan",
            title: "每日工作区扫描",
            trigger: "每天启动后检查当前项目文件树和运行记录",
            action: "workspace_scan",
            intervalMinutes: "1440",
            status: "scheduled"
          },
          {
            id: "git-status-watch",
            title: "Git 状态巡检",
            trigger: "每 30 分钟读取一次当前工作区变更",
            action: "git_status",
            intervalMinutes: "30",
            status: "idle"
          },
          {
            id: "thread-follow-up",
            title: "线程跟进提醒",
            trigger: "对长时间未推进的对话给出后续建议",
            action: "thread_follow_up",
            intervalMinutes: "120",
            status: "paused"
          }
        ];
    const actionLabels: Record<string, string> = {
      workspace_scan: "工作区扫描",
      git_status: "Git 状态",
      thread_follow_up: "线程跟进"
    };
    const statusLabels: Record<string, string> = {
      scheduled: "运行中",
      running: "执行中",
      idle: "待命",
      paused: "已暂停"
    };
    const activeCount = automationItems.filter((item: any) => item.status === "scheduled" || item.status === "running").length;

    return (
      <section className="automation-page">
        <aside className="automation-filter-panel" aria-label="自动化筛选">
          {[
            ["全部自动化", automationItems.length],
            ["运行中", activeCount],
            ["待命", automationItems.filter((item: any) => item.status === "idle").length],
            ["已暂停", automationItems.filter((item: any) => item.status === "paused").length],
            ["工作区", automationItems.filter((item: any) => item.action === "workspace_scan").length],
            ["Git", automationItems.filter((item: any) => item.action === "git_status").length]
          ].map(([label, count], index) => (
            <button key={label} className={index === 0 ? "active" : ""} type="button">
              <span aria-hidden="true">{index === 0 ? "◔" : "○"}</span>
              <strong>{label}</strong>
              <em>{count}</em>
            </button>
          ))}
        </aside>

        <main className="automation-workspace">
          <header className="automation-head">
            <div>
              <h1>自动化</h1>
              <p>把重复的项目扫描、状态检查和线程跟进交给 NewBrain 定时执行。</p>
            </div>
            <button type="button" onClick={() => resetFeatureDraft("automations")}>
              + 新自动化
            </button>
          </header>

          <section className="automation-create-card">
            <div className="automation-create-copy">
              <strong>{editingFeatureId ? "编辑自动化" : "创建自动化"}</strong>
              <span>配置名称、触发说明、执行动作和循环间隔。</span>
            </div>
            <div className="automation-form-grid">
              <label>
                <span>名称</span>
                <input
                  value={automationDraft.title}
                  onChange={(event) => setAutomationDraft((current: any) => ({ ...current, title: event.target.value }))}
                  placeholder="自动化名称"
                />
              </label>
              <label>
                <span>动作</span>
                <select
                  value={automationDraft.action}
                  onChange={(event) => setAutomationDraft((current: any) => ({ ...current, action: event.target.value }))}
                >
                  <option value="workspace_scan">工作区扫描</option>
                  <option value="git_status">Git 状态</option>
                  <option value="thread_follow_up">线程跟进</option>
                </select>
              </label>
              <label>
                <span>间隔分钟</span>
                <input
                  value={automationDraft.intervalMinutes}
                  onChange={(event) =>
                    setAutomationDraft((current: any) => ({ ...current, intervalMinutes: event.target.value }))
                  }
                  placeholder="30"
                />
              </label>
              <label className="automation-trigger-field">
                <span>触发说明</span>
                <textarea
                  value={automationDraft.trigger}
                  onChange={(event) => setAutomationDraft((current: any) => ({ ...current, trigger: event.target.value }))}
                  placeholder="描述什么时候执行、执行前要检查什么"
                  rows={3}
                />
              </label>
            </div>
            <div className="automation-create-actions">
              <button type="button" onClick={() => resetFeatureDraft("automations")}>
                清空
              </button>
              <button className="primary" type="button" onClick={() => void saveFeature("automations")}>
                {editingFeatureId ? "保存自动化" : "新增自动化"}
              </button>
            </div>
          </section>

          <section className="automation-list-section">
            <div className="automation-section-title">
              <h2>任务列表</h2>
              <span>{automationItems.length} 个自动化</span>
            </div>
            <div className="automation-list">
              {automationItems.map((item: any, index: number) => (
                <button
                  key={item.id ?? `${item.title}-${index}`}
                  className="automation-item"
                  type="button"
                  onClick={() => loadFeatureDraft("automations", item)}
                >
                  <span className={`automation-status-dot ${item.status ?? "idle"}`} aria-hidden="true" />
                  <span className="automation-item-main">
                    <strong>{item.title}</strong>
                    <em>{item.trigger || "暂无触发说明"}</em>
                  </span>
                  <span className="automation-action-chip">{actionLabels[item.action] ?? item.action ?? "工作区扫描"}</span>
                  <span className={`automation-status-chip ${item.status ?? "idle"}`}>
                    {statusLabels[item.status] ?? item.status ?? "待命"}
                  </span>
                  <span className="automation-interval">{item.intervalMinutes ?? "-"} 分钟</span>
                </button>
              ))}
            </div>
          </section>
        </main>
      </section>
    );
  }

function renderAutomationPrototypeModule() {
    const automationItems = featureConfig.automations ?? [];
    const scheduleLabel = (item: any) => {
      if (item.dailyTime) return `每天 ${item.dailyTime}`;
      if (item.schedule === "hourly") return "每小时";
      if (item.schedule === "daily") return "每天";
      if (item.schedule === "weekly") return "每周";
      if (item.intervalMinutes) return `每 ${item.intervalMinutes} 分钟`;
      return item.schedule || item.trigger || "未配置计划";
    };
    const statusKey = (item: any) => {
      if (item.status === "paused" || item.status === "idle") return "paused";
      if (item.status === "running" || automationRunPendingId === item.id) return "running";
      if (item.status === "scheduled") return "enabled";
      return "completed";
    };
    const statusText = (item: any) => {
      const key = statusKey(item);
      if (key === "running") return "执行中";
      return key === "enabled" ? "运行中" : key === "paused" ? "已暂停" : "已完成";
    };
    const visibleItems = automationItems
      .filter((item: any) => {
        const query = automationSearchQuery.trim().toLowerCase();
        if (!query) return true;
        return [item.title, item.trigger, item.prompt, item.action, item.schedule, item.status].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
      })
      .filter((item: any) => {
        if (automationStatusFilter === "all") return true;
        if (automationStatusFilter === "enabled") return statusKey(item) === "enabled";
        if (automationStatusFilter === "paused") return statusKey(item) === "paused";
        return statusKey(item) === "completed";
      })
      .slice()
      .sort((a: any, b: any) => {
        if (automationSortMode === "name") return String(a.title || "").localeCompare(String(b.title || ""));
        if (automationSortMode === "result") {
          const ar = Number(Boolean(a.unread || a.hasNewResult || a.lastError));
          const br = Number(Boolean(b.unread || b.hasNewResult || b.lastError));
          return br - ar || String(a.title || "").localeCompare(String(b.title || ""));
        }
        return Number(statusKey(b) === "enabled") - Number(statusKey(a) === "enabled") || String(a.title || "").localeCompare(String(b.title || ""));
      });
    const pageSize = 5;
    const pages = Math.max(1, Math.ceil(visibleItems.length / pageSize));
    const page = Math.min(automationCatalogPage, pages);
    const paged = visibleItems.slice((page - 1) * pageSize, page * pageSize);
    const selected = automationItems.find((item: any) => item.id === automationDetailModalId) ?? null;
    const resultMeta = visibleItems.length
      ? `显示 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, visibleItems.length)}，共 ${visibleItems.length} 项`
      : "0 个结果";

    const suggestions = [
      { group: "信息汇总", name: "每日简报", time: "工作日 8:00", desc: "汇总日历、重要未读消息和当天优先事项", prompt: "请创建一个工作日早上 8 点运行的每日简报，汇总日历、重要未读消息和当天优先事项。" },
      { group: "项目管理", name: "每周回顾", time: "每周五 16:00", desc: "整理本周项目进展、风险和下周计划", prompt: "请创建一个每周五下午 4 点运行的周报，汇总本周项目进展、风险和下周计划。" },
      { group: "持续监测", name: "跟进监控", time: "工作日 9:00", desc: "检查指定信息源并标记需要关注的更新", prompt: "请创建一个工作日上午 9 点运行的跟进监控，检查指定信息源并标记需要关注的更新。" }
    ];

    function openCreatorChat(invocation: string, draft = "") {
      setSelectedSidebarRow("feature:new-chat");
      setErrorMessage?.("");
      setSearchFilePreview(null);
      setActiveFeature("new-chat");
      setNewThreadScope("chat");
      setChatUsesProject?.(false);
      setIsComposingNewThread(true);
      setSelectedThreadId("");
      setQuestion(draft);
      setSelectedComposerSkill(null);
      setComposerSkillContext(invocation);
      setSelectedComposerTools([]);
      setComposerModes([]);
      setPreviewMode("empty");
      setPreviewPlacement("hidden");
      if (typeof setChatStatus === "function") setChatStatus(`已进入 ${invocation}`);
    }

    function startNewAutomation(draft = "请帮我创建一个自动化任务：", options?: { materialize?: boolean }) {
      openCreatorChat("Automation Creator", draft);
      if (options?.materialize && draft && draft !== "请帮我创建一个自动化任务：") {
        void materializeCreatorFromChat(draft, "Automation Creator");
      }
    }

    async function persistAutomation(item: any, patch: Record<string, string>) {
      if (!api?.updateFeatureItem) throw new Error("当前版本不能更新自动化任务。");
      const nextConfig = await api.updateFeatureItem({
        kind: "automations",
        id: item.id,
        item: {
          title: item.title ?? "",
          trigger: item.trigger ?? "",
          prompt: item.prompt ?? item.trigger ?? "",
          status: item.status ?? "scheduled",
          action: item.action ?? "workspace_scan",
          intervalMinutes: item.intervalMinutes != null ? String(item.intervalMinutes) : "",
          dailyTime: item.dailyTime ?? "",
          schedule: item.schedule ?? "",
          runtime: item.runtime ?? "",
          model: item.model ?? "",
          reasoning: item.reasoning ?? "",
          workspaceId: item.workspaceId ?? "",
          threadId: item.threadId ?? "",
          ...patch
        }
      });
      setFeatureConfig(nextConfig);
    }

    async function toggleAutomation(item: any) {
      const nextStatus = statusKey(item) === "paused" ? "scheduled" : "paused";
      try {
        await persistAutomation(item, { status: nextStatus });
        if (typeof setChatStatus === "function") setChatStatus(nextStatus === "paused" ? "任务已暂停" : "任务已开启");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }

    async function runAutomationNow(item: any) {
      if (!item?.id || automationRunPendingId === item.id) return;
      const prompt = String(item.prompt || item.trigger || "").trim();
      if (!item.workspaceId || !item.threadId) {
        setErrorMessage("这个任务还没有绑定对话线程，无法在会话里执行。");
        return;
      }
      if (!prompt) {
        setErrorMessage("这个任务没有可执行的指令。");
        return;
      }
      setAutomationRunPendingId(item.id);
      setAutomationMenuId("");
      setAutomationDetailModalId("");
      setErrorMessage("");
      setIsComposingNewThread(false);
      setActiveFeature("new-chat");
      setSelectedSidebarRow(`chat:${item.workspaceId}:${item.threadId}`);
      if (typeof selectWorkspaceThread === "function") {
        selectWorkspaceThread(item.workspaceId, item.threadId, { force: true });
      }
      if (typeof setChatStatus === "function") setChatStatus(`“${item.title || "自动化任务"}”正在对话中执行`);
      try {
        const outcome = await askModel({
          question: prompt,
          images: [],
          tools: [],
          skill: null,
          skillContext: "",
          modes: [],
          keepComposer: true,
          targetWorkspaceId: item.workspaceId,
          targetThreadId: item.threadId
        });
        if (outcome === "sent") {
          await persistAutomation(item, { status: "record_run" });
          if (api?.getFeatureConfig) setFeatureConfig(await api.getFeatureConfig());
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setAutomationRunPendingId((current) => current === item.id ? "" : current);
      }
    }

    async function deleteAutomation(item: any) {
      if (!api?.deleteFeatureItem) return;
      const confirmed = window.confirm(`确定删除“${item.title}”吗？此操作无法撤销。`);
      if (!confirmed) return;
      try {
        const nextConfig = await api.deleteFeatureItem({ kind: "automations", id: item.id });
        setFeatureConfig(nextConfig);
        if (typeof setChatStatus === "function") setChatStatus("自动化任务已删除");
        setAutomationDetailModalId("");
        setAutomationMenuId("");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }

    return (
      <section className="capability-catalog automation-page scheduled-page">
        <header className="catalog-heading">
          <div>
            <span className="catalog-kicker">AUTOMATION CONTROL</span>
            <h1>自动化</h1>
            <p>集中管理定时任务、持续监测和自动执行结果。</p>
          </div>
          <button className="catalog-create create-automation" type="button" onClick={() => startNewAutomation()}>＋ 新建自动化</button>
        </header>
        <section className="catalog-surface automation-surface">
          <div className="automation-catalog-toolbar">
            <div className="catalog-viewbar automation-viewbar">
              <div className="automation-filters">
                {([["all", "全部"], ["enabled", "运行中"], ["paused", "已暂停"], ["completed", "已完成"]] as const).map(([key, label]) => (
                  <button key={key} type="button" className={automationStatusFilter === key ? "active" : ""} onClick={() => { setAutomationStatusFilter(key); setAutomationCatalogPage(1); }}>{label}</button>
                ))}
              </div>
            </div>
            <div className="catalog-filterbar automation-filterbar">
              <label className="catalog-search"><span>⌕</span><input value={automationSearchQuery} onChange={(event) => { setAutomationSearchQuery(event.target.value); setAutomationCatalogPage(1); }} placeholder="搜索任务名称、计划或指令" /></label>
              <select className="catalog-select" value={automationSortMode} onChange={(event) => { setAutomationSortMode(event.target.value as any); setAutomationCatalogPage(1); }} aria-label="自动化排序">
                <option value="next">运行中优先</option>
                <option value="name">按名称排序</option>
                <option value="result">有新结果优先</option>
              </select>
            </div>
          </div>
          <div className="catalog-result-bar"><span>{resultMeta}</span><span>每页 {pageSize} 项</span></div>
          <div className="automation-table-head"><span>任务</span><span>运行计划</span><span>最近运行</span><span>状态</span><span></span></div>
          <div className="scheduled-list">
            {paged.length ? paged.map((item: any) => {
              const key = statusKey(item);
              const open = automationMenuId === item.id;
              const unread = Boolean(item.unread || item.hasNewResult);
              return (
                <article className={`scheduled-task${unread ? " unread" : ""}`} key={item.id} onClick={() => setAutomationDetailModalId(item.id)}>
                  <div className="scheduled-copy">
                    <h3>{item.title || "未命名自动化"}{unread ? <span>新结果</span> : null}</h3>
                    <p>{item.prompt || item.trigger || "对话创建"}</p>
                  </div>
                  <div className="scheduled-timing">
                    <small>运行计划</small>
                    <strong>{scheduleLabel(item)}</strong>
                    <p>{item.nextRunAt ? `下次 ${new Date(item.nextRunAt).toLocaleString()}` : "待调度"}</p>
                  </div>
                  <div className="scheduled-result">
                    <small>最近运行</small>
                    <strong>{item.lastError ? "失败" : item.lastRunAt ? "成功" : "尚未运行"}</strong>
                    <p>{item.lastRunAt ? new Date(item.lastRunAt).toLocaleString() : "—"}</p>
                  </div>
                  <span className={`scheduled-state ${key}`}><i></i>{statusText(item)}</span>
                  <span className="task-menu">
                  <button className="catalog-row-action" type="button" data-testid="automation-run-now" onClick={(event) => { event.stopPropagation(); void runAutomationNow(item); }}>{automationRunPendingId === item.id || item.status === "running" ? "执行中" : "立即执行"}</button>
                  <button className="task-menu-btn" type="button" aria-label="更多操作" onClick={(event) => { event.stopPropagation(); setAutomationMenuId(open ? "" : item.id); }}>•••</button>
                  {open ? (
                    <div className="catalog-menu-popover" role="menu" onClick={(event) => event.stopPropagation()}>
                      <button type="button" onClick={(event) => { event.stopPropagation(); void runAutomationNow(item); }}>立即执行</button>
                      <button type="button" onClick={() => { setAutomationMenuId(""); void toggleAutomation(item); }}>{key === "paused" ? "开启任务" : "暂停任务"}</button>
                      <button type="button" onClick={() => { setAutomationMenuId(""); startNewAutomation(`请帮我修改自动化任务“${item.title}”。当前计划：${scheduleLabel(item)}。当前指令：${item.prompt || item.trigger || ""}`); }}>在对话中编辑</button>
                      <button type="button" onClick={() => { setAutomationMenuId(""); setAutomationDetailModalId(item.id); }}>查看详情</button>
                      <button type="button" className="danger" onClick={() => { setAutomationMenuId(""); void deleteAutomation(item); }}>删除</button>
                    </div>
                  ) : null}
                  </span>
                </article>
              );
            }) : <div className="automation-empty"><div><strong>没有匹配的任务</strong>调整筛选条件或在对话中创建新任务。</div></div>}
          </div>
          <footer className="catalog-pagination">
            <span>第 {page} / {pages} 页</span>
            <div>
              <button type="button" disabled={page <= 1} onClick={() => setAutomationCatalogPage((current) => Math.max(1, current - 1))} aria-label="上一页">←</button>
              <button type="button" disabled={page >= pages} onClick={() => setAutomationCatalogPage((current) => Math.min(pages, current + 1))} aria-label="下一页">→</button>
            </div>
          </footer>
        </section>

        <section className="automation-suggestions">
          <header>
            <div><span className="catalog-kicker">STARTER TEMPLATES</span><h2>从模板开始</h2></div>
            <p>选择模板后，将进入对话继续确认时间与数据源。</p>
          </header>
          <div className="automation-template-grid">
            {suggestions.map((item) => (
              <article className="automation-template-card" key={item.name}>
                <span>{item.group}</span>
                <h3>{item.name}</h3>
                <p>{item.desc}</p>
                <footer>
                  <small>{item.time}</small>
                  <button type="button" onClick={() => startNewAutomation(item.prompt, { materialize: true })}>使用模板</button>
                </footer>
              </article>
            ))}
          </div>
        </section>

        {selected ? (
          <div className="catalog-modal-backdrop" role="presentation" onClick={() => setAutomationDetailModalId("")}>
            <section className="catalog-modal wide" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <header className="catalog-modal-head">
                <h2>{selected.title || "未命名自动化"}</h2>
                <button type="button" className="icon-btn" aria-label="关闭" onClick={() => setAutomationDetailModalId("")}>×</button>
              </header>
              <div className="catalog-modal-body">
                <div className="automation-detail-summary" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12, marginBottom: 16 }}>
                  <div><small>运行计划</small><strong style={{ display: "block" }}>{scheduleLabel(selected)}</strong></div>
                  <div><small>下次运行</small><strong style={{ display: "block" }}>{selected.nextRunAt ? new Date(selected.nextRunAt).toLocaleString() : "待调度"}</strong></div>
                  <div><small>最近运行</small><strong style={{ display: "block" }}>{selected.lastRunAt ? new Date(selected.lastRunAt).toLocaleString() : "尚未运行"}</strong></div>
                  <div><small>运行结果</small><strong style={{ display: "block" }}>{selected.lastError || (selected.lastRunAt ? "成功" : "—")}</strong></div>
                </div>
                <div>
                  <strong style={{ fontSize: 13 }}>任务指令</strong>
                  <p style={{ color: "#656d78", lineHeight: 1.6 }}>{selected.prompt || selected.trigger || "暂无指令"}</p>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                  <div>
                    <strong>任务状态</strong>
                    <div style={{ color: "#656d78", fontSize: 12 }}>{statusKey(selected) === "paused" ? "已暂停，不会自动运行" : "已开启，将按计划继续运行"}</div>
                  </div>
                  <button className={`switch ${statusKey(selected) === "paused" ? "" : "on"}`} type="button" onClick={() => void toggleAutomation(selected)} />
                </div>
              </div>
              <footer className="catalog-modal-foot">
                <button type="button" className="danger" onClick={() => void deleteAutomation(selected)}>删除</button>
                <button type="button" onClick={() => setAutomationDetailModalId("")}>关闭</button>
                <button className="catalog-create" type="button" data-testid="automation-detail-run-now" onClick={() => void runAutomationNow(selected)}>{automationRunPendingId === selected.id || selected.status === "running" ? "执行中" : "立即执行"}</button>
                <button className="catalog-create" type="button" onClick={() => { setAutomationDetailModalId(""); startNewAutomation(`请帮我修改自动化任务“${selected.title}”。当前计划：${scheduleLabel(selected)}。当前指令：${selected.prompt || selected.trigger || ""}`); }}>在对话中编辑</button>
              </footer>
            </section>
          </div>
        ) : null}
      </section>
    );
  }

function closeSearchDialog() {
    setShowSearchDialog(false);
    setSelectedSearchIndex(0);
  }

function selectSearchTarget(workspaceId?: string, threadId?: string, filePath?: string) {
    setIsComposingNewThread(false);
    if (workspaceId) {
      setSelectedWorkspaceId(workspaceId);
    }
    if (threadId) {
      setSelectedThreadId(threadId);
      setUnreadThreadIds((current) => {
        const next = new Set(current);
        next.delete(threadId);
        return next;
      });
    }
    if (filePath) {
      openLocalFilePreview(filePath, workspaceId ? { workspaceId } : undefined);
    } else {
      setSearchFilePreview(null);
    }
    setActiveFeature("new-chat");
    closeSearchDialog();
  }

function renderSearchDialogLegacy() {
    if (!showSearchDialog) {
      return null;
    }

    const hasQuery = searchQuery.trim().length > 0;
    const searchItems = hasQuery ? projectSearchResults(searchResults, visibleWorkspaceCatalog) : recentProjectThreads;

    return (
      <div className="search-dialog-layer" role="presentation" onMouseDown={closeSearchDialog}>
        <section className="search-dialog" role="dialog" aria-modal="true" aria-label="搜索项目线程" onMouseDown={(event) => event.stopPropagation()}>
          <div className="search-dialog-input">
            <span aria-hidden="true">⌕</span>
            <input
              autoFocus
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  closeSearchDialog();
                }
              }}
              placeholder="搜索项目线程"
            />
          </div>

          <div className="search-dialog-section-title">{hasQuery ? "搜索结果" : "近期项目线程"}</div>
          <div className="search-dialog-list">
            {searchItems.length > 0 ? (
              searchItems.map((item: any, index: number) => {
                const workspace = hasQuery
                  ? visibleWorkspaceCatalog.find((entry: any) => entry.id === item.workspaceId)
                  : item.workspace;
                const thread = hasQuery ? null : item.thread;
                const titleText = hasQuery ? item.title : thread.title;
                const workspaceName = hasQuery ? workspace?.name ?? item.detail ?? "" : workspace.name;
                const detailText = hasQuery ? `${formatSearchKind(item.kind)} · ${item.detail}` : formatRelativeTimeLabel(thread.updatedAt);

                return (
                  <button
                    key={hasQuery ? item.id : thread.id}
                    className="search-dialog-result"
                    type="button"
                    onClick={() => selectSearchTarget(hasQuery ? item.workspaceId : workspace.id, hasQuery ? item.threadId : thread.id)}
                  >
                    <span className="search-result-radio" aria-hidden="true" />
                    <span className="search-result-main">
                      <strong>{titleText}</strong>
                      <em>{detailText}</em>
                    </span>
                    <span className="search-result-project">{workspaceName}</span>
                    <kbd>Ctrl+{index + 1}</kbd>
                  </button>
                );
              })
            ) : (
              <div className="search-dialog-empty">{hasQuery ? "没有找到匹配的项目线程" : "暂无近期项目线程"}</div>
            )}
          </div>
        </section>
      </div>);
  }

function renderSearchDialog() {
    if (!showSearchDialog) return null;

    const hasQuery = searchQuery.trim().length > 0;
    const currentThreadIndex = recentProjectThreads.findIndex(({ thread }: any) => thread.id === selectedThread?.id);
    const navigateThread = (offset: number) => {
      if (recentProjectThreads.length === 0) return;
      const nextIndex = (Math.max(0, currentThreadIndex) + offset + recentProjectThreads.length) % recentProjectThreads.length;
      const next = recentProjectThreads[nextIndex];
      selectSearchTarget(next.workspace.id, next.thread.id);
    };
    const commandGroups: any[] = [
      {
        label: "推荐",
        items: [
          { id: "new-chat", label: "新对话", shortcut: "Ctrl+N", icon: "edit", run: startNewChat },
          { id: "open-folder", label: "打开文件夹", shortcut: "Ctrl+O", icon: "folder-open", run: () => void addExistingProject({ brainWorkspaceKey: selectedBrainWorkspaceKey }) },
          { id: "settings", label: "设置", shortcut: "Ctrl+,", icon: "settings", run: () => { setActiveFeature("settings"); setActiveSettingsSection("account"); } },
          { id: "search-files", label: "搜索文件", shortcut: "Ctrl+P", icon: "search", keepOpen: true, run: () => setSearchQuery("file:") }
        ]
      },
      {
        label: "对话",
        items: [
          { id: "quick-chat", label: "新建快速对话", shortcut: "Ctrl+Alt+N", icon: "edit", run: startNewChat },
          {
            id: "archive-chat",
            label: "归档聊天",
            shortcut: "Ctrl+Shift+A",
            icon: "archive",
            disabled: !selectedWorkspace || !selectedThread,
            run: () => void handleThreadMenuAction("archive", selectedWorkspace, selectedThread)
          },
          {
            id: "toggle-project",
            label: "切换项目展开状态",
            shortcut: "Ctrl+Alt+P",
            icon: "pin",
            disabled: !selectedWorkspace,
            run: () => setExpandedWorkspaceIds((current) => {
              const next = new Set(current);
              if (next.has(selectedWorkspace.id)) next.delete(selectedWorkspace.id);
              else next.add(selectedWorkspace.id);
              return next;
            })
          }
        ]
      },
      {
        label: "导航",
        items: [
          { id: "previous-chat", label: "上一个对话", shortcut: "Ctrl+Shift+[", icon: "chevron-right", run: () => navigateThread(-1) },
          { id: "next-chat", label: "下一个对话", shortcut: "Ctrl+Shift+]", icon: "chevron-right", run: () => navigateThread(1) }
        ]
      }
    ];
    const commandItems = commandGroups.flatMap((group) => group.items);
    const visibleProjectSearchResults = projectSearchResults(searchResults, visibleWorkspaceCatalog);
    const actionableItems: any[] = hasQuery ? visibleProjectSearchResults : commandItems;
    const executeItem = (index: number) => {
      const item = actionableItems[index];
      if (!item || item.disabled) return;
      if (hasQuery) {
        selectSearchTarget(item.workspaceId, item.threadId, item.filePath);
      } else {
        item.run();
        if (!item.keepOpen) closeSearchDialog();
      }
    };

    return (
      <div className="search-dialog-layer" role="presentation" onMouseDown={closeSearchDialog}>
        <section className="search-dialog command-palette" role="dialog" aria-modal="true" aria-label="搜索聊天或执行操作" onMouseDown={(event) => event.stopPropagation()}>
          <div className="search-dialog-input">
            <SidebarIcon name="search" />
            <input
              autoFocus
              type="search"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSelectedSearchIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") closeSearchDialog();
                else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelectedSearchIndex((current) => Math.min(current + 1, Math.max(0, actionableItems.length - 1)));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedSearchIndex((current) => Math.max(0, current - 1));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  executeItem(selectedSearchIndex);
                }
              }}
              placeholder="搜索聊天或执行操作"
            />
          </div>
          <div className="search-dialog-list">
            {!hasQuery ? commandGroups.map((group) => (
              <div className="search-command-group" key={group.label}>
                <div className="search-dialog-section-title">{group.label}</div>
                {group.items.map((item: any) => {
                  const index = commandItems.findIndex((entry) => entry.id === item.id);
                  return (
                    <button
                      key={item.id}
                      className={`search-command-item${selectedSearchIndex === index ? " selected" : ""}`}
                      type="button"
                      disabled={item.disabled}
                      onMouseEnter={() => setSelectedSearchIndex(index)}
                      onClick={() => executeItem(index)}
                    >
                      <SidebarIcon name={item.icon} />
                      <span>{item.label}</span>
                      <kbd>{item.shortcut}</kbd>
                    </button>
                  );
                })}
              </div>
            )) : visibleProjectSearchResults.length > 0 ? visibleProjectSearchResults.map((item: any, index: number) => {
              const workspace = visibleWorkspaceCatalog.find((entry: any) => entry.id === item.workspaceId);
              return (
                <button
                  key={item.id}
                  className={`search-dialog-result${selectedSearchIndex === index ? " selected" : ""}`}
                  type="button"
                  onMouseEnter={() => setSelectedSearchIndex(index)}
                  onClick={() => executeItem(index)}
                >
                  <span className="search-result-radio" aria-hidden="true" />
                  <span className="search-result-main">
                    <strong>{item.title}</strong>
                    <em>{formatSearchKind(item.kind)} · {item.detail}</em>
                  </span>
                  <span className="search-result-project">{workspace?.name ?? ""}</span>
                  <kbd>Enter</kbd>
                </button>
              );
            }) : (
              <div className="search-dialog-empty">没有找到匹配的项目、聊天或文件</div>
            )}
          </div>
        </section>
      </div>
    );
  }

function renderMobileModule() {
    const isWaiting = mobilePairing.status === "waiting";
    const isConnected = mobilePairing.status === "connected";
    return (
      <main className="mobile-connect-page">
        <section className="mobile-connect-copy">
          <div className="mobile-connect-copy-inner">
            <h1>{isConnected ? "手机已连接到这台电脑" : "将你的手机连接到这台电脑"}</h1>
            <p>{isConnected ? "项目与聊天状态正在通过局域网实时同步" : "通过手机或其他设备继续与 NewBrain 协作"}</p>

            {!isWaiting && !isConnected ? (
              <>
                <div className="mobile-benefits">
                  <div><SidebarIcon name="mobile" /><span><strong>继续上次未完成的任务</strong><small>在桌面端继续执行任何 NewBrain 聊天或项目</small></span></div>
                  <div><SidebarIcon name="chat" /><span><strong>实时掌握动态</strong><small>任务完成或需要您关注时及时查看状态</small></span></div>
                  <div><SidebarIcon name="automation" /><span><strong>开启新体验</strong><small>从手机访问当前项目和聊天进度</small></span></div>
                </div>
                <button
                  className="mobile-primary-action"
                  type="button"
                  onClick={async () => setMobilePairing(await api.startMobilePairing())}
                >
                  开始设置
                </button>
              </>
            ) : (
              <div className={`mobile-pairing-card ${isConnected ? "connected" : ""}`}>
                <div className="mobile-pairing-state">
                  <span className="mobile-status-dot" />
                  <div>
                    <strong>{isConnected ? "设备已连接" : "等待手机连接"}</strong>
                    <small>{isConnected ? mobilePairing.deviceName : "请在同一 Wi-Fi 下打开以下地址"}</small>
                  </div>
                </div>
                {!isConnected ? (
                  <>
                    <label>
                      <span>配对地址</span>
                      <div><input readOnly value={mobilePairing.url} /><button type="button" onClick={() => writeClipboard(mobilePairing.url)}>复制</button></div>
                    </label>
                    <div className="mobile-pairing-code"><span>配对码</span><strong>{mobilePairing.code}</strong></div>
                    <small>手机打开地址后需输入此配对码才能连接。链接将在 {new Date(mobilePairing.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} 失效</small>
                  </>
                ) : null}
                <button
                  className="mobile-secondary-action"
                  type="button"
                  onClick={async () => setMobilePairing(await api.stopMobilePairing())}
                >
                  {isConnected ? "断开设备" : "取消配对"}
                </button>
              </div>
            )}

            <p className="mobile-security-note">
              NewBrain 仅在当前局域网中共享项目和聊天状态。请仅连接您拥有且信任的设备，临时令牌到期后会自动失效。
            </p>
          </div>
        </section>
        <section className="mobile-device-stage">
          <div className="mobile-phone">
            <div className="mobile-phone-speaker" />
            <div className="mobile-phone-screen">
              <div className="mobile-phone-status"><b>9:41</b><span>● ◔ ▰</span></div>
              <div className="mobile-phone-toolbar">
                <button type="button" onClick={() => void api.getMobilePairingStatus()}>☰</button>
                <button type="button" onClick={() => void api.getMobilePairingStatus()}>•••</button>
              </div>
              <h2>NewBrain</h2>
              <div className="mobile-desktop-status"><i />{isConnected ? "已连接此电脑" : "等待连接"}</div>
              <h3>项目</h3>
              <div className="mobile-project-list">
                {visibleWorkspaceCatalog.slice(0, 4).map((workspace: any) => (
                  <button
                    type="button"
                    key={workspace.id}
                    onClick={() => {
                      setSelectedWorkspaceId(workspace.id);
                      setActiveFeature("new-chat");
                    }}
                  >
                    <SidebarIcon name="folder" /><span>{workspace.name}</span><b>›</b>
                  </button>
                ))}
              </div>
              <h3>项目线程</h3>
              <div className="mobile-chat-list">
                {recentProjectThreads.slice(0, 5).map(({ workspace, thread }: any) => (
                  <button
                    type="button"
                    key={`${workspace.id}:${thread.id}`}
                    onClick={() => {
                      setSelectedWorkspaceId(workspace.id);
                      setSelectedThreadId(thread.id);
                      setIsComposingNewThread(false);
                      setActiveFeature("new-chat");
                    }}
                  >
                    <span>{thread.title}</span>{thread.status === "running" ? <i className="thread-running-dot" /> : null}
                  </button>
                ))}
              </div>
              <div className="mobile-phone-actions">
                <button type="button" onClick={() => setShowSearchDialog(true)}><SidebarIcon name="search" />搜索聊天</button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveFeature("new-chat");
                    setNewThreadScope("chat");
                    setIsComposingNewThread(true);
                    setQuestion("");
                  }}
                >
                  <SidebarIcon name="edit" />聊天
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

function renderWorkspaceModules() {
    if (isSettingsFeature) {
      return renderSettingsWorkspace();
    }

    const brainToolsCentered = activeFeature === "new-chat" && brainResourcePlacement === "center" && previewPlacement !== "side";
    const brainToolsSide = activeFeature === "new-chat" && brainResourcePlacement === "side" && previewPlacement !== "side";
    const showCenterPreview = previewPlacement === "center" && previewMode !== "empty" && activeFeature === "new-chat";
    // Full-page features must win over an active thread selection; otherwise Holon/专家/技能
    // opened while a chat row is selected would silently keep showing chat.
    const useMarketplaceExpert = async (expert: { id?: string; displayName?: string; defaultInitPrompt?: string; quickPrompts?: string[]; installed?: boolean; enabled?: boolean }) => {
      const expertId = String(expert?.id || "").trim();
      if (!expertId || !api?.addWorkspaceThread || !api.activateWorkspaceThread || !window.newbrain?.summonExpert) {
        throw new Error("当前版本还不能在对话中使用专家。");
      }
      if (!expert.installed && window.newbrain.installExpert) {
        await window.newbrain.installExpert({ expertId });
      }
      if (expert.enabled === false && window.newbrain.setExpertEnabled) {
        await window.newbrain.setExpertEnabled({ expertId, enabled: true });
      }
      const workspaceId = INTERNAL_CHAT_WORKSPACE_ID;
      const sceneKeys = ["quant", "game", "video", "music", "data", "software", "document", "explore"];
      const sceneKey = sceneKeys.includes(selectedBrainWorkspaceKey) ? selectedBrainWorkspaceKey : "explore";
      const prompt = String(expert.defaultInitPrompt || expert.quickPrompts?.[0] || `请以「${expert.displayName || expertId}」的专业方式处理我接下来的任务。`).trim();
      const existingIds = new Set(
        (normalizeWorkspaceCatalog(workspaceCatalog).find((item) => item.id === workspaceId)?.threads || []).map((thread) => thread.id)
      );
      const nextCatalog = normalizeWorkspaceCatalog(await api.addWorkspaceThread({
        workspaceId,
        title: String(expert.displayName || expertId).slice(0, 36),
        summary: prompt.slice(0, 180),
        scope: "chat",
        brainWorkspaceKey: sceneKey
      }));
      setWorkspaceCatalog(nextCatalog);
      const thread = nextCatalog.find((item) => item.id === workspaceId)?.threads?.find((item) =>
        item.scope === "chat" && !existingIds.has(item.id)
      );
      if (!thread?.id) throw new Error("专家对话没有创建成功。");
      const snapshot = await api.activateWorkspaceThread({ workspaceId, threadId: thread.id });
      if (snapshot && typeof syncSnapshot === "function") syncSnapshot(snapshot, thread.id);
      await window.newbrain.summonExpert({ threadId: thread.id, expertId, userConfirmed: true });
      setSelectedSidebarRow(`chat:${workspaceId}:${thread.id}`);
      setSelectedWorkspaceId(workspaceId);
      setSelectedThreadId(thread.id);
      setIsComposingNewThread(false);
      setNewThreadScope("chat");
      setChatUsesProject?.(false);
      setActiveFeature("new-chat");
      setQuestion(prompt);
      if (questionRef) questionRef.current = prompt;
      composerTextareaRef.current?.setValue?.(prompt);
      setChatStatus(`已启用专家「${expert.displayName || expertId}」。发送后会按该专家处理。`);
      setErrorMessage("");
    };

    const fullPageFeature = ["extensions", "skills", "plugins", "experts", "automation", "mcp", "holon"].includes(activeFeature);
    const mainModule = fullPageFeature
      ? (
        activeFeature === "extensions"
          ? renderExtensionsModule()
          : activeFeature === "skills"
            ? renderSkillsModule()
            : activeFeature === "plugins"
              ? renderPluginsModule()
              : activeFeature === "automation"
                ? renderAutomationPrototypeModule()
                : activeFeature === "mcp"
                    ? renderMcpModule()
                    : activeFeature === "holon"
                      ? <HolonWorkspace threadId={selectedThread?.id} />
                      : activeFeature === "experts"
                        ? <ExpertsMarketplace key={selectedBrainWorkspaceKey} workspaceKey={selectedBrainWorkspaceKey} onUseExpert={useMarketplaceExpert} />
                        : renderChatModule()
      )
      : renderChatModule();

    return (
      <>
        {location.hostname === "localhost" || location.protocol === "file:" ? (
          <>
            <button type="button" hidden data-testid="e2e-open-file-preview" onClick={openE2EFilePreview} />
            <button
              type="button"
              hidden
              data-testid="e2e-request-shell-approval"
              onClick={async () => {
                const nextSnapshot = await api.queueShellCommand("Set-Content -LiteralPath 'approval-e2e.txt' -Value 'APPROVAL_E2E_OK'");
                setSnapshot(nextSnapshot);
              }}
            />
          </>
        ) : null}
        {renderSidebarModule()}
        {mainModule}
        {/* 七场景右侧专业面板：不依赖必须已选中 BRAIN 对话；仅在打开通用文件侧栏时临时让位。
            Expand (.center) keeps chat + Tools side-by-side (hide left nav only). */}
        {brainToolsCentered ? renderBrainResourcePanel("center") : null}
        {brainToolsSide ? renderBrainResourcePanel("side") : null}
        {/* Residual expand after 收起 — workspace-frame host so empty home / new-chat (hidden topbar) and no-project still show panel-right. */}
        {activeFeature === "new-chat" && brainResourcePlacement === "hidden" && previewPlacement !== "side" ? (
          <button
            type="button"
            className="preview-icon-button preview-panel-toggle brain-tools-restore-toggle"
            title="显示工具侧栏"
            aria-label="显示工具侧栏"
            data-testid="brain-tools-restore-toggle"
            onClick={() => setBrainResourcePlacement("side")}
          >
            <span className="preview-panel-glyph visible"><SidebarIcon name="panel-right" /></span>
          </button>
        ) : null}
        {previewPlacement === "side" && activeFeature === "new-chat" ? renderPreviewModule("side") : null}
        {showCenterPreview ? renderPreviewModule("center") : null}
        {renderSearchDialog()}
        {workspaceFileMenu && selectedWorkspace?.id ? <LocalFileContextMenu
          menu={workspaceFileMenu}
          workspaceId={selectedWorkspace.id}
          onClose={() => setWorkspaceFileMenu(null)}
        /> : null}
        {imagePreview && typeof document !== "undefined" ? createPortal(
          <div className="image-preview-overlay" role="dialog" aria-modal="true" onMouseDown={() => setImagePreview(null)}>
            <div className="image-preview-shell" onMouseDown={(event) => event.stopPropagation()}>
              <header>
                <strong>{imagePreview.name}</strong>
                <div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!api?.openComposerAttachment) return;
                      const result = await api.openComposerAttachment({ path: imagePreview.path });
                      if (!result.ok) setChatStatus(result.detail || "附件无法打开");
                    }}
                  >
                    用系统打开
                  </button>
                  <button type="button" aria-label="关闭预览" onClick={() => setImagePreview(null)}>×</button>
                </div>
              </header>
              <img src={imagePreview.url} alt={imagePreview.name} />
            </div>
          </div>,
          document.body
        ) : null}
        {typeof document !== "undefined" && appUpdateApplied ? createPortal(
          <AppUpdateDialog
            mode="success"
            applied={appUpdateApplied}
            notes={appUpdateApplied.notes}
            onAcknowledgeSuccess={() => dismissAppliedAppUpdate?.()}
          />,
          document.body
        ) : null}
        {typeof document !== "undefined" && (appUpdateProgress || appUpdateDiscoverOpen) ? createPortal(
          <AppUpdateDialog
            mode={appUpdateProgress ? "progress" : "discover"}
            currentVersion={appUpdateStatus?.currentVersion || appUpdateProgress?.currentVersion}
            latestVersion={appUpdateStatus?.latestVersion || appUpdateProgress?.latestVersion}
            notes={appUpdateStatus?.notes || appUpdateProgress?.notes}
            progress={appUpdateProgress}
            busy={Boolean(appUpdateBusy)}
            onClose={() => dismissAppUpdateProgress?.()}
            onLater={() => {
              dismissAppUpdateProgress?.();
              dismissAppUpdateDiscover?.();
              setDismissedAppUpdateVersion(String(appUpdateStatus?.latestVersion || ""));
            }}
            onSkip={() => {
              void skipDesktopAppUpdate?.();
              dismissAppUpdateProgress?.();
              dismissAppUpdateDiscover?.();
              setDismissedAppUpdateVersion(String(appUpdateStatus?.latestVersion || ""));
            }}
            onUpdateNow={() => void startDesktopAppUpdate?.()}
            onRestartNow={() => void applyDesktopAppUpdate?.()}
          />,
          document.body
        ) : null}
        {shouldShowAppUpdateAutoPrompt({
          available: Boolean(appUpdateStatus?.available),
          latestVersion: appUpdateStatus?.latestVersion,
          busy: Boolean(appUpdateBusy),
          dismissedVersion: dismissedAppUpdateVersion,
          skippedVersion: appUpdateStatus?.skippedVersion,
          progressVisible: Boolean(appUpdateProgress || appUpdateDiscoverOpen || appUpdateApplied),
          staged: Boolean(appUpdateStatus?.staged)
        }) && typeof document !== "undefined" ? createPortal(
          <div className="app-update-auto-prompt" role="status" aria-live="polite">
            <div className="app-update-auto-prompt-body">
              <strong>发现新版本 {appUpdateStatus.latestVersion}</strong>
              <span>一键更新，下载完成后重启即可生效；聊天与项目数据会保留。</span>
            </div>
            <div className="app-update-auto-prompt-actions">
              <button
                type="button"
                className="primary"
                disabled={Boolean(appUpdateBusy)}
                onClick={() => void startDesktopAppUpdate?.()}
              >
                更新
              </button>
              <button
                type="button"
                aria-label="稍后提醒"
                onClick={() => setDismissedAppUpdateVersion(String(appUpdateStatus.latestVersion || ""))}
              >
                稍后
              </button>
            </div>
          </div>,
          document.body
        ) : null}
      </>
    );
  }

  return renderWorkspaceModules();
}
