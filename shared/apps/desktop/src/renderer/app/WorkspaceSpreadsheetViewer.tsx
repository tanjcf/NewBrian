import { useMemo, useRef, useState } from "react";
import type { AnnotationMarkingTool, BrainAnnotationDto } from "@codex-forge/protocol";
import type { DocumentRect, DocumentViewport } from "@codex-forge/protocol/document-anchor";
import { DocumentMarkingLayer } from "./DocumentMarkingLayer";

export type SpreadsheetPreviewSheet = {
  name: string;
  headers: string[];
  rows: string[][];
  truncated: boolean;
  totalRows: number;
};

export type SpreadsheetMarkingProps = {
  annotationActive: boolean;
  markingTool: AnnotationMarkingTool;
  markingColor: string;
  savedAnnotations: BrainAnnotationDto[];
  pendingMark: { rect: DocumentRect; tool: AnnotationMarkingTool; color: string } | null;
  onMarkComplete: (input: { rect: DocumentRect; viewport: DocumentViewport; sheet: string; columnCount: number; rowCount: number; captureTarget: HTMLElement }) => void;
};

export function WorkspaceSpreadsheetViewer(props: {
  sheets: SpreadsheetPreviewSheet[];
  name?: string;
  marking?: SpreadsheetMarkingProps;
}) {
  const sheets = Array.isArray(props.sheets) ? props.sheets : [];
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const activeSheet = sheets[Math.min(activeSheetIndex, Math.max(0, sheets.length - 1))] ?? null;
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const summary = useMemo(() => {
    if (!activeSheet) return "空表格";
    const columns = activeSheet.headers.length;
    const rows = activeSheet.totalRows || activeSheet.rows.length;
    return `${columns} 列 · ${rows} 行${activeSheet.truncated ? "（仅显示前 200 行）" : ""}`;
  }, [activeSheet]);

  if (!activeSheet) {
    return <div className="search-file-preview-state">表格预览为空。</div>;
  }

  const columnCount = Math.max(activeSheet.headers.length, 1);
  const rowCount = Math.max(activeSheet.totalRows || activeSheet.rows.length, 1) + 1;
  const sheetName = activeSheet.name || props.name || "表格";

  return (
    <div className="workspace-artifact-spreadsheet-shell" data-testid="workspace-spreadsheet-viewer">
      <div className="workspace-artifact-spreadsheet-toolbar">
        {sheets.length > 1 ? (
          <div className="workspace-artifact-spreadsheet-tabs" role="tablist" aria-label="工作表">
            {sheets.map((sheet, index) => (
              <button
                key={`${sheet.name}-${index}`}
                type="button"
                role="tab"
                aria-selected={index === activeSheetIndex}
                className={`workspace-artifact-spreadsheet-tab${index === activeSheetIndex ? " active" : ""}`}
                onClick={() => setActiveSheetIndex(index)}
              >
                {sheet.name}
              </button>
            ))}
          </div>
        ) : (
          <strong>{sheetName}</strong>
        )}
        <span>{summary}</span>
      </div>
      <div className="workspace-artifact-spreadsheet-table-wrap workspace-artifact-spreadsheet-marking-host" ref={tableWrapRef}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              {activeSheet.headers.map((header, index) => (
                <th key={`${header}-${index}`}>{header || `列 ${index + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeSheet.rows.length ? activeSheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td>{rowIndex + 1}</td>
                {activeSheet.headers.map((_, columnIndex) => (
                  <td key={columnIndex}>{row[columnIndex] ?? ""}</td>
                ))}
              </tr>
            )) : (
              <tr>
                <td colSpan={Math.max(1, activeSheet.headers.length + 1)}>暂无数据行</td>
              </tr>
            )}
          </tbody>
        </table>
        {props.marking ? (
          <DocumentMarkingLayer
            active={props.marking.annotationActive}
            tool={props.marking.markingTool}
            color={props.marking.markingColor}
            savedAnnotations={props.marking.savedAnnotations.filter((annotation) => {
              if (annotation.anchor.format !== "xlsx") return false;
              return annotation.anchor.sheet === sheetName;
            })}
            pendingMark={props.marking.annotationActive ? props.marking.pendingMark : null}
            onComplete={({ rect, viewport: markViewport, host }) => {
              if (!props.marking?.annotationActive) return;
              props.marking.onMarkComplete({
                rect,
                viewport: markViewport,
                sheet: sheetName,
                columnCount,
                rowCount,
                captureTarget: tableWrapRef.current || host
              });
            }}
          />
        ) : null}
      </div>
      {activeSheet.truncated ? (
        <div className="search-file-preview-notice">表格较大，仅显示前 200 行。</div>
      ) : null}
    </div>
  );
}
