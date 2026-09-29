import { promises as fs } from "node:fs";
import path from "node:path";

export const COMPANION_MEMORY_SKILL_NAME = "companion-memory";

const FIELDS = ["助手名字", "用户称呼", "城市", "近期在忙", "要记住的事"];
const GREETING = /^(你好|您好|hi|hello|hey|在吗|早上好|晚上好)[!！。.\s]*$/i;

const SKILL_MARKDOWN = `---
name: companion-memory
description: 全局长期设定。第一次见面确认称呼、助手名字、城市，以及要一直记住的项目、习惯和雷区；之后直接沿用。
---

# 长期设定

\`references/memory.md\` 是跨会话保留的档案。程序会在对话后写入，不要用工具修改这个文件。

## 档案还是空的

如果「用户称呼」「城市」「近期在忙」「要记住的事」都还空着，而且这是当前会话里你的第一句回复，用口语把长期设定定下来，不要改成表格或问卷：

- 先说明这几件事定下来之后，就不用每次重新对齐。
- 关于你自己：你还没有名字。请用户直接起一个；如果用户懒得想，你偏向「小满」——意思是事情做到刚刚好、不溢出来。用户觉得别的更好，就改。
- 关于用户，列出这三件，并说明不用一次答全，聊到哪就记到哪：
  - 该怎么称呼用户
  - 用户在哪个城市（之后涉及时间、天气、本地信息时用）
  - 最近在忙什么，以及希望一直记着的事：项目、习惯、雷区都算

## 档案里已经有内容

- 用档案里的称呼。助手名字有填写就用那个名字；还空着就用「小满」，直到用户改口。
- 涉及时间、天气、本地信息时用档案里的城市。
- 已经填写的项目不要再问。只有某一项仍为空，而且当前话题正好相关时，才补问那一项。
- 不要说你在读取技能或写入档案。
`;

function emptyValues() {
  return Object.fromEntries(FIELDS.map((key) => [key, ""]));
}

function clip(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

export function parseCompanionMemory(text) {
  const values = emptyValues();
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^- ([^:：]+)[:：]\s*(.*)$/);
    if (!match || !Object.hasOwn(values, match[1].trim())) continue;
    values[match[1].trim()] = match[2].trim();
  }
  return values;
}

export function renderCompanionMemory(values) {
  const lines = FIELDS.map((key) => `- ${key}: ${values[key] || ""}`);
  return `# 长期设定\n\n${lines.join("\n")}\n`;
}

function take(pattern, source, max) {
  const match = source.match(pattern);
  return match ? clip(match[1], max) : "";
}

export function extractCompanionMemoryUpdate(user, assistant) {
  const source = String(user || "").trim();
  const reply = String(assistant || "");
  const explicit = {};
  const inferred = {};
  if (!source || GREETING.test(source)) return { explicit, inferred };

  const assistantName = take(
    /(?:你就叫|就叫你|叫你|你的名字(?:就)?(?:是|叫))\s*[「『"']?([\u4e00-\u9fa5A-Za-z0-9]{1,12})/,
    source,
    16
  );
  if (assistantName) explicit["助手名字"] = assistantName;
  else if (/小满/.test(source) && /就行|可以用|叫这个|就用|就叫/.test(source)) explicit["助手名字"] = "小满";

  const userName = take(
    /(?:叫我|称呼我|喊我|我叫)\s*[「『"']?([\u4e00-\u9fa5A-Za-z0-9]{1,12})/,
    source,
    16
  );
  if (userName) explicit["用户称呼"] = userName;

  const city = take(
    /(?:我在|住在|人在|城市是|城市在)\s*([\u4e00-\u9fa5A-Za-z]{2,12})/,
    source,
    16
  );
  if (city) explicit["城市"] = city;

  const busy = take(/(?:最近在忙|最近在做|最近忙)[:：]?\s*([^\n。]{2,80})/, source, 120);
  if (busy) explicit["近期在忙"] = busy;

  const remember = take(/(?:请)?记住[:：]?\s*([^\n。]{2,80})/, source, 160)
    || take(/雷区(?:是|为)?[:：]?\s*([^\n。]{2,80})/, source, 160);
  if (remember) explicit["要记住的事"] = remember;

  const opening = /长期设定/.test(reply) && /小满/.test(reply) && /城市/.test(reply);
  if (!opening && source.length <= 24) {
    if (/称呼你|这么称呼|记下.*称呼/.test(reply)) inferred["用户称呼"] = clip(source, 16);
    else if (/哪个城市|你的城市|记下.*城市/.test(reply)) inferred["城市"] = clip(source, 16);
    else if (/记下|记住/.test(reply) && /忙|项目|习惯|雷区/.test(reply)) inferred["近期在忙"] = clip(source, 120);
  }
  return { explicit, inferred };
}

function appendRemember(values, value) {
  const next = clip(value, 240);
  if (!next) return false;
  if (!values["要记住的事"]) {
    values["要记住的事"] = next;
    return true;
  }
  if (values["要记住的事"].includes(next)) return false;
  const merged = clip(`${values["要记住的事"]}；${next}`, 240);
  if (merged === values["要记住的事"]) return false;
  values["要记住的事"] = merged;
  return true;
}

export function applyCompanionMemoryUpdate(values, update) {
  const next = { ...values };
  let changed = false;
  for (const [key, value] of Object.entries(update.explicit || {})) {
    if (!value) continue;
    if (key === "要记住的事") {
      if (appendRemember(next, value)) changed = true;
      continue;
    }
    if (next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  }
  for (const [key, value] of Object.entries(update.inferred || {})) {
    if (!value || next[key]) continue;
    next[key] = value;
    changed = true;
  }
  return { values: next, changed };
}

export async function ensureCompanionMemorySkill(root) {
  const skillRoot = String(root || "").trim();
  if (!skillRoot) return null;
  const dir = path.join(skillRoot, COMPANION_MEMORY_SKILL_NAME);
  const references = path.join(dir, "references");
  await fs.mkdir(references, { recursive: true });
  const skillPath = path.join(dir, "SKILL.md");
  const memoryPath = path.join(references, "memory.md");
  try {
    await fs.access(skillPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await fs.writeFile(skillPath, SKILL_MARKDOWN, "utf8");
  }
  try {
    await fs.access(memoryPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await fs.writeFile(memoryPath, renderCompanionMemory(emptyValues()), "utf8");
  }
  return dir;
}

export async function updateCompanionMemoryFromExchange(roots, input) {
  const update = extractCompanionMemoryUpdate(input?.user ?? input?.userText, input?.assistant ?? input?.assistantText);
  if (!Object.keys(update.explicit).length && !Object.keys(update.inferred).length) return false;
  let changed = false;
  for (const root of roots || []) {
    if (!root) continue;
    const memoryPath = path.join(root, COMPANION_MEMORY_SKILL_NAME, "references", "memory.md");
    let current;
    try {
      current = await fs.readFile(memoryPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const applied = applyCompanionMemoryUpdate(parseCompanionMemory(current), update);
    if (!applied.changed) continue;
    await fs.writeFile(memoryPath, renderCompanionMemory(applied.values), "utf8");
    changed = true;
  }
  return changed;
}
