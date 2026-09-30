import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import brandIcon from "../assets/newbrain-icon-256.png";
import ceremonyPhoto from "../assets/founding-ceremony-ref.png";

type LoginCeremonyOverlayProps = {
  enabled?: boolean;
  onContinue: () => void;
};

function ceremonyMaxRadius() {
  return Math.hypot(window.innerWidth, window.innerHeight) * 1.25;
}

export function LoginCeremonyOverlay({ enabled = true, onContinue }: LoginCeremonyOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [reveal, setReveal] = useState(0);
  const rafRef = useRef(0);
  const openRef = useRef(false);
  const closingRef = useRef(false);
  const revealRef = useRef(0);

  const setRevealPx = useCallback((px: number) => {
    revealRef.current = px;
    setReveal(px);
  }, []);

  const close = useCallback((after?: () => void) => {
    if (!openRef.current || closingRef.current) return;
    closingRef.current = true;
    cancelAnimationFrame(rafRef.current);
    const startR = Math.max(revealRef.current, ceremonyMaxRadius());
    const start = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = (1 - t) ** 2;
      setRevealPx(startR * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      openRef.current = false;
      closingRef.current = false;
      setVisible(false);
      setRevealPx(0);
      after?.();
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [setRevealPx]);

  const openAt = useCallback(
    (clientX: number, clientY: number) => {
      if (openRef.current || closingRef.current) return;
      openRef.current = true;
      closingRef.current = false;
      cancelAnimationFrame(rafRef.current);
      setOrigin({ x: clientX, y: clientY });
      setRevealPx(0);
      setVisible(true);
      const start = performance.now();
      const duration = 10000;
      const maxR = ceremonyMaxRadius();
      const tick = (now: number) => {
        if (closingRef.current) return;
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - t) ** 3;
        setRevealPx(eased * maxR);
        if (t < 1) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [setRevealPx]
  );

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  useEffect(() => {
    if (!enabled) {
      if (openRef.current) close();
      return;
    }
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number }>).detail;
      if (detail) openAt(detail.x, detail.y);
    };
    window.addEventListener("newbrain-open-login-ceremony", handler as EventListener);
    return () => window.removeEventListener("newbrain-open-login-ceremony", handler as EventListener);
  }, [close, enabled, openAt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && openRef.current) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  if (!enabled || !visible) {
    return null;
  }

  const onContinueClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    close(onContinue);
  };

  return (
    <div
      className="login-ceremony is-on"
      aria-hidden="false"
      style={
        {
          "--cx": `${origin.x}px`,
          "--cy": `${origin.y}px`,
          "--reveal": `${reveal}px`
        } as CSSProperties
      }
    >
      <div className="login-ceremony-bg" />
      <div className="login-ceremony-veil" aria-hidden="true" />
      <div className="login-ceremony-rays" aria-hidden="true" />
      <button type="button" className="login-ceremony-exit" onClick={() => close()}>
        收回
      </button>
      <div className="login-ceremony-stage">
        <figure className="login-ceremony-frame">
          <img
            className="login-ceremony-photo"
            src={ceremonyPhoto}
            alt="开国大典：天安门城楼宣告"
            width={640}
            height={380}
          />
        </figure>
        <p className="login-ceremony-caption">天安门城楼 · 宣告成立</p>
        <section className="login-ceremony-panel">
          <div className="login-ceremony-brand">
            <img src={brandIcon} alt="" width={44} height={44} />
            <h1>新脑子</h1>
          </div>
          <p className="login-ceremony-year">一 九 四 九 · 十 月 一 日</p>
          <button type="button" className="login-ceremony-continue" onClick={onContinueClick}>
            继续登录
          </button>
        </section>
        <p className="login-ceremony-tribute">
          <strong>献礼盛世中华</strong>
          <span>拓科技之界，澎湃新质生产力；</span>
          <span>望美好未来，成就自由全面发展。</span>
        </p>
      </div>
    </div>
  );
}

/** 悬停热点：以旗中心为原点展开 */
export function openLoginCeremonyFromHotspot(target: HTMLElement) {
  try {
    window.sessionStorage.setItem("nd_easter_found", "1");
  } catch {
    // ignore storage failures
  }
  const rect = target.getBoundingClientRect();
  window.dispatchEvent(
    new CustomEvent("newbrain-open-login-ceremony", {
      detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
  );
}

export function openLoginCeremony(clientX: number, clientY: number) {
  window.dispatchEvent(
    new CustomEvent("newbrain-open-login-ceremony", {
      detail: { x: clientX, y: clientY }
    })
  );
}
