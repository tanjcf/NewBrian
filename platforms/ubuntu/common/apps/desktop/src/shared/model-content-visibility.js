const PRIVATE_PLANNING_PATTERN = /(?:the user\s+(?:is asking|wants|asked|has asked|requested|is requesting|input request has been created)|the request\s+(?:is asking|requires)|analyzing the (?:request|user request)|now i need to\b|i (?:now )?need to\b|i should\b|i'm executing|i (?:will|must) (?:now )?wait for the user|wait for the user to (?:choose|select|respond)|let me\b|now let me\b|(?:just )?respond very (?:briefly|simply)|wait for actual instructions|should respond very simply|your previous reply had no|no user-visible|english self-talk|step\s+\d+\s*:|目标状态是\s*(?:paused|active|idle|blocked)|phase\s*是\s*(?:paused|active|idle|blocked)|可能是因为之前|现在(?:在)?\s*(?:paused|active|idle|blocked)\s*状态|用户(?:已经)?确认了大纲|确认了提纲|当前(?:的)?可用工具|可用工具(?:列表|包括|有)|工具列表|缺少\s*(?:web\.|官方)|没有\s*web\.(?:search|read)_official|MANDATORY\s+OFFICIAL|official-evidence|先检查(?:一下)?(?:当前)?(?:可用)?工具列表)/i;

const PROCESS_DIAGNOSTIC_PATTERN = /^(?:Chinese chars:|total non-whitespace|The \d+字 target:|本轮使用\s*Skill[：:]|正在调用工具|正在分析用户请求|上一轮未产出可见回复)/i;

const USER_OUTPUT_MARKERS = ["同志们", "各位", "尊敬的", "## 写作提纲", "写作提纲", "提纲", "正文", "已完成", "你好", "您好", "嗨"];
const CLEAR_USER_OUTPUT_PATTERN = /^(?:#{1,3}\s*)?(?:同志们|各位|尊敬的|标题|正文|提纲|方案|报告|通知|讲话稿|总结|答复|以下是|已完成|本轮使用\s*Skill|你好|您好|嗨)/;

export function containsPrivatePlanningNarration(content) {
  return PRIVATE_PLANNING_PATTERN.test(content);
}

/** Collects private planning / chain-of-thought blocks that must not stay in answer content. */
export function extractPrivatePlanningNarration(content) {
  const source = String(content ?? "").replace(/\r\n?/g, "\n").trim();
  if (!source) return "";
  const planningBlocks = [];
  for (const rawBlock of source.split(/\n{2,}/)) {
    const block = rawBlock.trim();
    if (!block) continue;
    if (PROCESS_DIAGNOSTIC_PATTERN.test(block) || containsPrivatePlanningNarration(block)) {
      planningBlocks.push(block);
    }
  }
  return planningBlocks.join("\n\n").trim();
}

export class ModelStreamVisibilityGate {
  buffered = "";
  state = "probing";

  push(delta) {
    if (!delta) return {};
    if (this.state === "visible") return { delta };
    if (this.state === "suppressed") return { suppressed: true, delta };
    this.buffered += delta;
    if (containsPrivatePlanningNarration(this.buffered)) {
      const leaked = this.buffered;
      this.state = "suppressed";
      this.buffered = "";
      return { suppressed: true, delta: leaked };
    }
    if (CLEAR_USER_OUTPUT_PATTERN.test(this.buffered.trimStart()) || this.buffered.length >= 160) {
      this.state = "visible";
      const visible = this.buffered;
      this.buffered = "";
      return { delta: visible };
    }
    return {};
  }

  finish(hasToolCalls) {
    if (hasToolCalls) {
      // Codex keeps an already accepted user-facing commentary item beside the
      // following tool activity. Only private/probing text is suppressed.
      if (this.state === "visible") {
        this.state = "suppressed";
        this.buffered = "";
        return { suppressed: false };
      }
      const leaked = this.buffered;
      this.state = "suppressed";
      this.buffered = "";
      return leaked ? { suppressed: true, delta: leaked } : { suppressed: true };
    }
    if (this.state === "probing") {
      this.state = "visible";
      const visible = this.buffered;
      this.buffered = "";
      return visible ? { delta: visible } : {};
    }
    return { suppressed: this.state === "suppressed" };
  }
}

function normalizedBlockKey(block) {
  return block.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function recoverUserFacingTail(block) {
  const positions = USER_OUTPUT_MARKERS.map((marker) => block.indexOf(marker)).filter((index) => index >= 0);
  return positions.length ? block.slice(Math.min(...positions)).trim() : "";
}

/**
 * True when sanitized content still has a user-facing answer (e.g. short greeting).
 * Used by empty-visible detection so mixed English self-talk + Chinese reply is not
 * falsely treated as an empty assistant turn.
 */
export function hasUserVisibleAssistantContent(content) {
  return Boolean(sanitizeVisibleModelContent(content));
}

/** Removes tool/skill narration and repeated process blocks from persisted or historical assistant output. */
export function sanitizeVisibleModelContent(content) {
  const source = String(content ?? "").replace(/\r\n?/g, "\n").trim();
  if (!source) return "";

  const seen = new Set();
  const visibleBlocks = [];
  for (const rawBlock of source.split(/\n{2,}/)) {
    const block = rawBlock.trim();
    if (!block) continue;
    if (PROCESS_DIAGNOSTIC_PATTERN.test(block)) continue;
    if (containsPrivatePlanningNarration(block)) {
      const tail = recoverUserFacingTail(block);
      if (!tail) continue;
      const tailKey = normalizedBlockKey(tail);
      if (!seen.has(tailKey)) {
        seen.add(tailKey);
        visibleBlocks.push(tail);
      }
      continue;
    }
    const key = normalizedBlockKey(block);
    if (seen.has(key)) continue;
    seen.add(key);
    visibleBlocks.push(block);
  }
  // Single-line mixes (no blank line) still appear from flash-tier models.
  if (!visibleBlocks.length && containsPrivatePlanningNarration(source)) {
    const tail = recoverUserFacingTail(source);
    if (tail && !containsPrivatePlanningNarration(tail)) return tail;
  }
  return visibleBlocks.join("\n\n").trim();
}
