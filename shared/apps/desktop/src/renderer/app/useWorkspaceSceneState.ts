import { useCallback, useEffect, useRef, useState } from "react";
import type { BrainWorkspaceKey } from "@codex-forge/protocol";

const UI_STATE_SECTION = "_ui_state";

/** Persists JSON UI state in revisioned workspace sections (survives app restart). */
export function useWorkspaceSceneState<T extends Record<string, unknown>>(
  projectId: string | undefined,
  workspaceKey: BrainWorkspaceKey,
  defaults: T
) {
  const [state, setStateInternal] = useState<T>(defaults);
  const revisionRef = useRef(0);
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);

  const setState = useCallback((updater: T | ((current: T) => T)) => {
    setStateInternal((current) => (typeof updater === "function" ? (updater as (value: T) => T)(current) : updater));
  }, []);

  useEffect(() => {
    hydratedRef.current = false;
    setHydrated(false);
    if (!projectId || !window.newbrain?.getBrainWorkspaceSection) {
      setStateInternal(defaults);
      hydratedRef.current = true;
      setHydrated(true);
      return;
    }
    let active = true;
    void window.newbrain.getBrainWorkspaceSection({ projectId, workspaceKey, sectionKey: UI_STATE_SECTION })
      .then((section) => {
        if (!active) return;
        try {
          const parsed = JSON.parse(section.content || "{}") as Partial<T>;
          setStateInternal({ ...defaults, ...parsed });
          revisionRef.current = section.revision;
        } catch {
          setStateInternal(defaults);
        }
      })
      .catch(() => { if (active) setStateInternal(defaults); })
      .finally(() => {
        if (!active) return;
        hydratedRef.current = true;
        setHydrated(true);
      });
    return () => { active = false; };
  }, [projectId, workspaceKey]);

  useEffect(() => {
    if (!hydratedRef.current || !projectId || !window.newbrain?.saveBrainWorkspaceSection) return;
    const timer = window.setTimeout(() => {
      void window.newbrain.saveBrainWorkspaceSection({
        projectId,
        workspaceKey,
        sectionKey: UI_STATE_SECTION,
        content: JSON.stringify(state, null, 2),
        expectedRevision: revisionRef.current
      }).then((section) => { revisionRef.current = section.revision; }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [state, projectId, workspaceKey]);

  return { state, setState, hydrated };
}
