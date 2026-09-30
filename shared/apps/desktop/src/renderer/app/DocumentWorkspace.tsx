import { useEffect } from "react";

type DocumentView = "project" | "outline" | "body" | "references" | "slides" | "review";

type DocumentWorkspaceProps = {
  activeView: DocumentView;
  files: any[];
  activeFileId: string;
  availableAnchors: any[];
  annotations: any[];
  changeSets: any[];
  preview: any;
  busy: boolean;
  annotationActive: boolean;
  onOpenFiles: () => void;
  onSelectFile: (file: any, openPreview?: boolean) => void;
  onSelectAnchor: (anchor: any) => void;
  onToggleAnnotation: () => void;
  onSendAnnotation: (annotation: any) => void;
  onPreviewChangeSet: (changeSet: any) => void;
  onReviewChangeSet: (changeSet: any, status: "ACCEPTED" | "REJECTED") => void;
  onExportChangeSet: (changeSet: any) => void;
};

function anchorTitle(anchor: any) {
  return String(anchor.selectedText || anchor.text || anchor.objectId || anchor.anchorId || "结构位置").trim();
}

export function DocumentWorkspace(props: DocumentWorkspaceProps) {
  const activeFile = props.files.find((file) => file.id === props.activeFileId);
  useEffect(() => {
    if (!activeFile && props.files[0]) props.onSelectFile(props.files[0], false);
  }, [activeFile, props.files, props.onSelectFile]);
  const fileAnnotations = props.annotations.filter((annotation) => !activeFile || annotation.fileId === activeFile.id);
  const annotationIds = new Set(fileAnnotations.map((annotation) => annotation.id));
  const fileChangeSets = props.changeSets.filter((changeSet) => annotationIds.has(changeSet.annotationId));
  const outlineAnchors = props.availableAnchors.filter((anchor) => /heading|title|paragraph/i.test(String(anchor.objectId || "")) || /^(#{1,6}\s|第[一二三四五六七八九十]+[章节部分])/u.test(anchorTitle(anchor)));
  const referenceAnchors = props.availableAnchors.filter((anchor) => /(https?:\/\/|doi\b|参考文献|来源|引用)/iu.test(anchorTitle(anchor)));
  const slideAnchors = props.availableAnchors.filter((anchor) => anchor.format === "pptx");
  const viewAnchors = props.activeView === "outline" ? outlineAnchors : props.activeView === "references" ? referenceAnchors : props.activeView === "slides" ? slideAnchors : props.availableAnchors;

  return <main className="brain-document-module" data-testid="brain-document-workspace" data-active-view={props.activeView}>
    <header className="brain-video-header"><div><span>文档创作</span><strong>{props.activeView === "project" ? "项目与文件" : props.activeView === "outline" ? "大纲" : props.activeView === "body" ? "正文" : props.activeView === "references" ? "引用" : props.activeView === "slides" ? "PPT" : "审校与导出"}</strong></div><small>{activeFile ? `${activeFile.logicalName} · 版本 ${activeFile.versionNo}` : "尚未选择文档"}</small></header>

    {props.activeView === "project" ? <section className="brain-document-overview"><article><span>项目文档</span><strong>{props.files.length}</strong></article><article><span>结构锚点</span><strong>{props.availableAnchors.length}</strong></article><article><span>待处理标注</span><strong>{fileAnnotations.filter((item) => item.status === "OPEN").length}</strong></article><button type="button" onClick={props.onOpenFiles}>打开通用文件面板</button></section> : null}

      {["outline", "body", "references", "slides"].includes(props.activeView) ? <>
      <section className="brain-document-toolbar"><select aria-label="选择文档" value={activeFile?.id || ""} onChange={(event) => { const file = props.files.find((item) => item.id === event.target.value); if (file) props.onSelectFile(file); }}><option value="">选择文档</option>{props.files.map((file) => <option key={file.id} value={file.id}>{file.logicalName}</option>)}</select><button type="button" disabled={!activeFile} className={props.annotationActive ? "active" : ""} onClick={props.onToggleAnnotation}>{props.annotationActive ? "退出标注模式" : "在中央预览标注"}</button></section>
      {!props.annotationActive ? (
        <section className="brain-document-structure">{viewAnchors.length ? viewAnchors.slice(0, 200).map((anchor) => <button type="button" key={anchor.anchorId} onClick={() => props.onSelectAnchor(anchor)}><strong>{anchorTitle(anchor)}</strong><small>{anchor.objectId || anchor.anchorId}</small></button>) : <div className="brain-resource-empty">当前文档没有可用于该视图的结构锚点，请先选择并解析支持的文件。</div>}</section>
      ) : (
        <p className="brain-document-marking-hint">标注模式已开启。请在中央预览区拖动标记笔框选内容，完成标记后再描述修改要求。</p>
      )}
    </> : null}

    {props.activeView === "review" ? <section className="brain-document-review">
      <header><strong>标注与修改版本</strong><button type="button" disabled={!activeFile && !props.files.length} className={props.annotationActive ? "active" : ""} onClick={props.onToggleAnnotation}>{props.annotationActive ? "退出标注模式" : "在中央预览标注"}</button></header>
      {props.annotationActive ? <p className="brain-document-marking-hint">标注模式已开启。请在中央预览区用标记笔框选内容，标记完成后再描述修改要求。</p> : null}
      {fileAnnotations.map((annotation) => {
        const snapshotUrl = annotation.geometry?.snapshotUrl || "";
        return (
          <article key={annotation.id}>
            <div>
              {snapshotUrl ? (
                <div className="document-annotation-snapshot-thumb" aria-hidden="true">
                  <img src={snapshotUrl} alt="" />
                </div>
              ) : null}
              <strong>{annotation.instruction}</strong>
              <small>{annotation.selectedText?.trim() || "标记区域"} · {annotation.status}</small>
            </div>
            <button type="button" disabled={!annotation.instruction.trim()} title={annotation.instruction.trim() ? "将标记位置、截图与修改要求加入左侧对话" : "请先填写修改要求"} onClick={() => props.onSendAnnotation(annotation)}>加入对话</button>
          </article>
        );
      })}
      {fileChangeSets.map((changeSet) => <article key={changeSet.id}><div><strong>{changeSet.changeSummary}</strong><small>基础版本 {changeSet.baseFileVersion} · {changeSet.status}</small></div><div><button type="button" disabled={props.busy} onClick={() => props.onPreviewChangeSet(changeSet)}>预览</button>{changeSet.status === "PROPOSED" ? <><button type="button" disabled={props.busy} onClick={() => props.onReviewChangeSet(changeSet, "ACCEPTED")}>接受</button><button type="button" disabled={props.busy} onClick={() => props.onReviewChangeSet(changeSet, "REJECTED")}>拒绝</button></> : null}{changeSet.status === "ACCEPTED" ? <button type="button" disabled={props.busy} onClick={() => props.onExportChangeSet(changeSet)}>导出新版本</button> : null}</div></article>)}
      {props.preview ? <pre>{props.preview.previewText || props.preview.diff || JSON.stringify(props.preview, null, 2)}</pre> : null}
      {!fileAnnotations.length && !fileChangeSets.length ? <div className="brain-resource-empty">当前文档还没有标注或修改方案。</div> : null}
    </section> : null}
  </main>;
}
