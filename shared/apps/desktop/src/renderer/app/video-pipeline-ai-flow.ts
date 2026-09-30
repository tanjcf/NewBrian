/**
 * Video pipeline prompt routing: distinguish AI instruction prompts from literal
 * dialogue lines so UI regenerate actions go through BRAIN chat Auto / tools
 * instead of feeding instruction text into TTS as spoken content.
 */

export type VideoPipelineAiKind = "narration" | "video" | "general";

export type VideoPipelineAiRequest = {
  kind: VideoPipelineAiKind;
  question: string;
  shotId?: string;
  shotIndex?: number;
};

export type VideoPipelineAiContext = {
  projectId?: string;
  shotIndex: number;
  shotId: string;
  shotTitle?: string;
  canvasSize: string;
  kind: VideoPipelineAiKind;
  userPrompt: string;
  /** Optional current literal line (for narration rewrite tasks). */
  currentLine?: string;
  /** Optional current visual prompt (for video rewrite tasks). */
  currentVisualPrompt?: string;
};

/** Imperative AI / rewrite instructions that must NOT be spoken as TTS. */
const AI_INSTRUCTION_RE =
  /(?:给.{0,12}(?:写|生成|做)|写(?:个|一[个段篇]|段|篇)?|生成|转换成?|转为|转成|请(?:帮|为)?|帮我|重新生成|改写|润色|扩写|续写|提示词|prompt|然后|并且|再(?:把|将)|TTS|语音|配音|旁白文案|背景旁白|文生|图生)/i;

/** Meta verbs that mark the whole field as a task brief, not spoken line. */
const AI_TASK_META_RE =
  /(?:写个|写一段|写一篇|转换成语音|转成语音|生成旁白|生成台词|生成配音|按提示词|更新生成|重新生成|帮我(?:写|生成|做)|请帮我)/i;

export function looksLikeAiInstructionPrompt(text: string | undefined | null): boolean {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  if (AI_TASK_META_RE.test(trimmed)) return true;
  if (AI_INSTRUCTION_RE.test(trimmed) && (trimmed.length > 16 || /[，。；：、]/.test(trimmed) || trimmed.includes("\n"))) {
    return true;
  }
  // Multi-clause Chinese instruction often uses commas / "然后".
  if (trimmed.length >= 12 && /然后|接着|再|并/.test(trimmed) && /写|生成|转换|旁白|语音|视频/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Short spoken dialogue suitable for direct TTS.
 * Instruction-like text always returns false.
 */
export function looksLikeLiteralDialogueLine(text: string | undefined | null): boolean {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  if (looksLikeAiInstructionPrompt(trimmed)) return false;
  if (trimmed.length > 220) return false;
  if (/\n/.test(trimmed) && trimmed.split(/\n/).filter(Boolean).length > 4) return false;
  return true;
}

export function buildVideoPipelineAgentQuestion(ctx: VideoPipelineAiContext): string {
  const shotLabel = `镜 ${ctx.shotIndex + 1}${ctx.shotTitle ? `「${ctx.shotTitle}」` : ""}`;
  const kindLabel =
    ctx.kind === "narration"
      ? "旁白 / 配音"
      : ctx.kind === "video"
        ? "镜头视频生成"
        : "视频流水线任务";

  const lines = [
    "【视频流水线 · 交给对话 Auto 处理】",
    `工程：${ctx.projectId || "（未绑定）"}`,
    `镜头：${shotLabel}（id=${ctx.shotId}）`,
    `画幅：${ctx.canvasSize}`,
    `任务类型：${kindLabel}`,
    "",
    "用户指令：",
    ctx.userPrompt.trim(),
    ""
  ];

  if (ctx.kind === "narration") {
    if (ctx.currentLine?.trim() && ctx.currentLine.trim() !== ctx.userPrompt.trim()) {
      lines.push(`当前本镜台词（可参考，勿把上方指令原文当台词朗读）：${ctx.currentLine.trim()}`, "");
    }
    lines.push(
      "请走 BRAIN 正常 Auto / Skill / 工具流程：",
      "1) 若指令是「写旁白/背景旁白」等，先写出可朗读的旁白台词并写回本镜 line；",
      "2) 再调用配音/语音工具（如 video.audio.speech，必须传 shotIndex）生成本镜旁白音频并挂到 A 轨；",
      "3) 禁止把整段「写旁白然后转换成语音」类指令原文直接送去 TTS；禁止省略 shotIndex 导致旁白无镜头归属。"
    );
  } else if (ctx.kind === "video") {
    if (ctx.currentVisualPrompt?.trim() && ctx.currentVisualPrompt.trim() !== ctx.userPrompt.trim()) {
      lines.push(`当前视觉提示词（可参考）：${ctx.currentVisualPrompt.trim()}`, "");
    }
    lines.push(
      "请走 BRAIN 正常 Auto / Skill / 工具流程：",
      `1) 调用 video_generate 或 video.shot.generate 为本镜生成真实视频（size=${ctx.canvasSize}）；`,
      "2) 下载并登记到工程 media/clips，更新分镜 ready/clip；",
      "3) 若指令同时要求旁白，先写台词再调语音工具，勿把指令原文当 TTS 内容。"
    );
  } else {
    lines.push("请走 BRAIN 正常 Auto / Skill / 工具流程完成上述指令，优先使用视频场景已注册工具。");
  }

  return lines.join("\n");
}
