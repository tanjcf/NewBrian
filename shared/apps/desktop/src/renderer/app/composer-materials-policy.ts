/**
 * Three-tier materials model for Composer:
 * L1 focus attachments (cursor tokens) · L2 workspace folder · L3 data scene.
 * Prevents users from treating chat attachment slots as a data warehouse.
 */

export const COMPOSER_FOCUS_ATTACHMENT_LIMIT = 8;
export const COMPOSER_FOCUS_ATTACHMENT_WARN_AT = 5;

export type ComposerMaterialTier = "focus" | "workspace" | "data";

export type ComposerMaterialsMenuItem = {
  tier: ComposerMaterialTier;
  id: string;
  title: string;
  detail: string;
  testId: string;
};

export const COMPOSER_MATERIALS_MENU_ITEMS: ComposerMaterialsMenuItem[] = [
  {
    tier: "focus",
    id: "focus-files",
    title: "文件和图片",
    detail: "插入到光标处 · 焦点材料（少量关键文件）",
    testId: "composer-materials-focus-files"
  },
  {
    tier: "workspace",
    id: "workspace-folder",
    title: "挂载工作区文件夹",
    detail: "按需读取本地目录 · 不占用焦点附件槽",
    testId: "composer-materials-workspace-folder"
  },
  {
    tier: "data",
    id: "data-scene",
    title: "打开数据场景",
    detail: "万级表格/CSV：导入 · 查询 · 聚合，不走聊天附件",
    testId: "composer-materials-data-scene"
  }
];

export function composerAttachmentAccessLabel(linkMode?: string | null): string {
  return linkMode === "local" ? "本地引用" : "已缓存";
}

export function composerFocusCapacityHint(
  count: number,
  limit = COMPOSER_FOCUS_ATTACHMENT_LIMIT
): string {
  const safeCount = Math.max(0, Math.trunc(Number(count) || 0));
  const safeLimit = Math.max(1, Math.trunc(Number(limit) || COMPOSER_FOCUS_ATTACHMENT_LIMIT));
  if (safeCount <= 0) return "";
  if (safeCount >= safeLimit) {
    return `焦点材料已满（${safeCount}/${safeLimit}）。更多文件请挂载工作区；数万级数据请用数据场景。`;
  }
  if (safeCount >= COMPOSER_FOCUS_ATTACHMENT_WARN_AT) {
    return `焦点材料 ${safeCount}/${safeLimit}。附件是指针不是集装箱；大批量请挂载工作区或改用数据场景。`;
  }
  return `焦点材料 ${safeCount}/${safeLimit}`;
}

export function composerMaterialsTierLabel(tier: ComposerMaterialTier): string {
  if (tier === "workspace") return "工作区材料";
  if (tier === "data") return "大数据";
  return "焦点材料";
}
