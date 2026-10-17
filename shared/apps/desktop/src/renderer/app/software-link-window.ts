export interface SoftwareLinkWindowRef {
  processId?: number;
  processName?: string;
  title?: string;
  handle?: number;
}

export interface SoftwareLinkActivatePlan {
  ok: true;
  selectKey: string;
  activate: {
    processId: number;
    processName: string;
    handle: number;
  };
  message: string;
}

/** Clicking a listed window focuses that HWND. The visible title is not the lookup key. */
export function planSoftwareLinkActivate(windowItem: SoftwareLinkWindowRef): SoftwareLinkActivatePlan | { ok: false; message: string } {
  const processId = Number(windowItem.processId);
  const handle = Number(windowItem.handle);
  const processName = String(windowItem.processName ?? "").trim();
  const title = String(windowItem.title ?? "").trim();
  if (!Number.isInteger(processId) || processId <= 0 || !Number.isInteger(handle) || handle <= 0) {
    return { ok: false, message: "没有可联动的窗口。" };
  }
  return {
    ok: true,
    selectKey: `${processId}:${title}`,
    activate: { processId, processName, handle },
    message: `已聚焦：${title || processName}`
  };
}
