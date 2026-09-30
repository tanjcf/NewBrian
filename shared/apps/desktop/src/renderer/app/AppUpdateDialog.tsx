import type { ReactNode } from "react";
import {
  formatAppUpdateSuccessLine,
  formatAppUpdateVersionLine,
  resolveAppUpdateProgressLabel,
  resolveAppUpdateProgressTitle,
  type AppUpdateProgressPhase
} from "./app-update-progress-copy";

export type AppUpdateDialogMode = "discover" | "progress" | "success";

export interface AppUpdateDialogProgress {
  phase: AppUpdateProgressPhase;
  percent: number;
  detail?: string;
  latestVersion?: string;
  currentVersion?: string;
  notes?: string;
  installMode?: "silent" | "wizard" | "patch" | "nsis";
}

export interface AppUpdateDialogProps {
  mode: AppUpdateDialogMode;
  currentVersion?: string;
  latestVersion?: string;
  notes?: string;
  progress?: AppUpdateDialogProgress | null;
  applied?: { fromVersion: string; toVersion: string; notes: string } | null;
  busy?: boolean;
  onClose?: () => void;
  onLater?: () => void;
  onSkip?: () => void;
  onUpdateNow?: () => void;
  onRestartNow?: () => void;
  onAcknowledgeSuccess?: () => void;
}

function NotesBlock({ notes }: { notes?: string }) {
  const text = String(notes || "").trim();
  if (!text) return null;
  return (
    <div className="app-update-notes">
      <strong>更新内容</strong>
      <div className="app-update-notes-body">{text}</div>
    </div>
  );
}

/** Cockpit-style single modal for discover / download / ready / success. */
export function AppUpdateDialog(props: AppUpdateDialogProps): ReactNode {
  const {
    mode,
    currentVersion,
    latestVersion,
    notes,
    progress,
    applied,
    busy,
    onClose,
    onLater,
    onSkip,
    onUpdateNow,
    onRestartNow,
    onAcknowledgeSuccess
  } = props;

  if (mode === "success" && applied) {
    return (
      <div className="app-update-dialog-backdrop" role="presentation" onMouseDown={() => onAcknowledgeSuccess?.()}>
        <section
          className="app-update-dialog app-update-dialog-success"
          role="dialog"
          aria-modal="true"
          aria-label="更新成功"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="app-update-dialog-head">
            <strong>更新成功!</strong>
            <button type="button" className="app-update-dialog-close" aria-label="关闭" onClick={() => onAcknowledgeSuccess?.()}>
              ×
            </button>
          </header>
          <p className="app-update-version-hero">v{applied.toVersion}</p>
          <p>{formatAppUpdateSuccessLine(applied)}</p>
          <NotesBlock notes={applied.notes || notes} />
          <div className="app-update-dialog-actions">
            <button type="button" className="primary" onClick={() => onAcknowledgeSuccess?.()}>
              我知道了
            </button>
          </div>
        </section>
      </div>
    );
  }

  const phase = progress?.phase;
  const isDownloading =
    phase === "preparing" || phase === "downloading" || phase === "verifying";
  const isReady = phase === "ready" || Boolean(progress && progress.phase === "ready");
  const isError = phase === "error";
  const showProgressBar = Boolean(progress) && !isError && phase !== "success";
  const title = progress
    ? resolveAppUpdateProgressTitle(progress)
    : "发现新版本";
  const version = String(progress?.latestVersion || latestVersion || "").trim();
  const current = String(progress?.currentVersion || currentVersion || "").trim();
  const bodyNotes = String(progress?.notes || notes || "").trim();

  return (
    <div
      className="app-update-dialog-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (isError || phase === "done") onClose?.();
      }}
    >
      <section
        className="app-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="app-update-dialog-head">
          <strong>{title}</strong>
          <button
            type="button"
            className="app-update-dialog-close"
            aria-label="关闭"
            onClick={() => (isReady || mode === "discover" ? onLater?.() : onClose?.())}
          >
            ×
          </button>
        </header>

        {version ? <p className="app-update-version-hero">v{version}</p> : null}
        <p>{formatAppUpdateVersionLine({ currentVersion: current, latestVersion: version })}</p>

        {isReady ? (
          <div className="app-update-ready-banner" role="status">
            {resolveAppUpdateProgressLabel({
              phase: "ready",
              latestVersion: version
            })}
          </div>
        ) : null}

        {showProgressBar && isDownloading ? (
          <div className="app-update-progress-row">
            <div className="app-update-progress-track" aria-hidden="true">
              <i style={{ width: `${Math.max(0, Math.min(100, Number(progress?.percent) || 0))}%` }} />
            </div>
            <span>
              {resolveAppUpdateProgressLabel({
                phase: progress?.phase || "downloading",
                detail: `${progress?.detail || ""} ${Math.round(Number(progress?.percent) || 0)}%`,
                latestVersion: version
              })}
            </span>
            <button
              type="button"
              className="app-update-cancel-download"
              aria-label="取消下载"
              onClick={() => onLater?.()}
            >
              ×
            </button>
          </div>
        ) : null}

        {isError ? <p className="app-update-error">{progress?.detail}</p> : null}

        <NotesBlock notes={bodyNotes} />

        <div className="app-update-dialog-actions">
          {mode === "discover" && !progress ? (
            <>
              <button type="button" onClick={() => onLater?.()}>
                取消
              </button>
              <button type="button" onClick={() => onSkip?.()}>
                跳过此版本
              </button>
              <button
                type="button"
                className="primary"
                disabled={Boolean(busy)}
                onClick={() => onUpdateNow?.()}
              >
                立即更新
              </button>
            </>
          ) : null}

          {isDownloading ? (
            <>
              <button type="button" onClick={() => onLater?.()}>
                稍后
              </button>
              <button type="button" className="primary" disabled>
                下载中...
              </button>
            </>
          ) : null}

          {isReady ? (
            <>
              <button type="button" onClick={() => onLater?.()}>
                稍后
              </button>
              <button type="button" onClick={() => onSkip?.()}>
                跳过此版本
              </button>
              <button
                type="button"
                className="primary"
                disabled={Boolean(busy)}
                onClick={() => onRestartNow?.()}
              >
                立即重启
              </button>
            </>
          ) : null}

          {isError && !isReady ? (
            <>
              <button type="button" onClick={() => onClose?.()}>
                知道了
              </button>
              {typeof onUpdateNow === "function" ? (
                <button
                  type="button"
                  className="primary"
                  disabled={Boolean(busy)}
                  onClick={() => onUpdateNow()}
                >
                  立即更新
                </button>
              ) : null}
            </>
          ) : null}

          {phase === "done" && !isReady && !isError ? (
            <button type="button" className="primary" onClick={() => onClose?.()}>
              知道了
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
