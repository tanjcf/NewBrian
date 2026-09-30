import brandIcon from "../assets/newbrain-icon-256.png";
import type { DesktopBootstrapStatusState } from "./desktop-model";

interface AuthLoadingScreenProps {
  bootstrapState: string;
  errorMessage: string;
}

interface BootstrapBlockingScreenProps {
  bootstrapState: string;
  desktopBootstrapStatus: DesktopBootstrapStatusState;
  errorMessage: string;
  isRetryingCondaBootstrap: boolean;
  onRetryCondaBootstrap: () => void;
}

export function AuthLoadingScreen({ bootstrapState, errorMessage }: AuthLoadingScreenProps) {
  return (
    <main className="codex-shell login-shell">
      <section className="login-stage">
        <div className="login-panel login-panel-loading">
          <img src={brandIcon} alt="" width={56} height={56} style={{ borderRadius: 14 }} />
          <strong>正在检查登录状态...</strong>
          <span>{bootstrapState}</span>
          {errorMessage ? <div className="login-error-banner">{errorMessage}</div> : null}
        </div>
      </section>
    </main>
  );
}

export function BootstrapBlockingScreen({
  bootstrapState,
  desktopBootstrapStatus,
  errorMessage,
  isRetryingCondaBootstrap,
  onRetryCondaBootstrap
}: BootstrapBlockingScreenProps) {
  return (
    <main className="codex-shell login-shell">
      <section className="login-stage">
        <div className="login-panel login-panel-loading">
          <img src={brandIcon} alt="" width={56} height={56} style={{ borderRadius: 14 }} />
          <strong>正在初始化本地开发环境...</strong>
          <span>{desktopBootstrapStatus.overall.message || bootstrapState}</span>
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              height: 10,
              borderRadius: 999,
              background: "rgba(15, 23, 42, 0.08)",
              overflow: "hidden",
              marginTop: 16
            }}
          >
            <div
              style={{
                width: `${desktopBootstrapStatus.overall.progressPercent}%`,
                height: "100%",
                background: "linear-gradient(90deg, #0f766e 0%, #0ea5e9 100%)",
                transition: "width 180ms ease"
              }}
            />
          </div>
          <span>
            {desktopBootstrapStatus.overall.completedTasks}/{desktopBootstrapStatus.overall.totalTasks} 已完成
          </span>
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              marginTop: 14,
              textAlign: "left",
              display: "grid",
              gap: 10
            }}
          >
            {(desktopBootstrapStatus.tasks.length > 0
              ? desktopBootstrapStatus.tasks
              : [{ id: "conda", label: "Conda 环境", status: "pending" as const }]
            ).map((task) => (
              <div
                key={task.id}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "rgba(255, 255, 255, 0.72)",
                  border: "1px solid rgba(15, 23, 42, 0.08)"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    fontSize: 13,
                    fontWeight: 600
                  }}
                >
                  <span>{task.label}</span>
                  <span>
                    {task.status === "ready"
                      ? "已完成"
                      : task.status === "running"
                        ? "进行中"
                        : task.status === "manual_required"
                          ? "需手动处理"
                          : "等待中"}
                  </span>
                </div>
                {task.detail ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: "rgba(15, 23, 42, 0.68)" }}>{task.detail}</div>
                ) : null}
              </div>
            ))}
          </div>
          {desktopBootstrapStatus.conda.status === "manual_required" ? (
            <button type="button" onClick={onRetryCondaBootstrap} disabled={isRetryingCondaBootstrap}>
              {isRetryingCondaBootstrap ? "正在重试..." : "重新初始化 Conda"}
            </button>
          ) : null}
          {errorMessage ? <div className="login-error-banner">{errorMessage}</div> : null}
        </div>
      </section>
    </main>
  );
}
