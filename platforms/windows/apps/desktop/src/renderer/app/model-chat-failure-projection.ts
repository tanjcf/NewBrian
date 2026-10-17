export interface FailedAssistantProjectionInput {
  content?: string;
  reasoningSummary?: string;
}

function preserveAssistantPartial(message: FailedAssistantProjectionInput, livePartial = "") {
  const currentContent = String(message.content || "");
  const partialContent = String(livePartial || "");
  return currentContent.trim().length >= partialContent.trim().length
    ? currentContent
    : partialContent;
}

export function projectModelChatFailure(
  message: FailedAssistantProjectionInput,
  errorMessage: string,
  livePartial = ""
) {
  const preservedContent = preserveAssistantPartial(message, livePartial);
  const visibleContent = preservedContent.trim()
    ? preservedContent
    : `请求未能完成：${errorMessage}`;
  const existingReasoning = String(message.reasoningSummary || "").trim();
  return {
    content: visibleContent,
    reasoningSummary: existingReasoning
      ? `${existingReasoning}\n\n本轮在完成前发生异常：${errorMessage}`
      : `本轮在完成前发生异常：${errorMessage}`,
    excludeFromModelContext: true as const
  };
}

/** Manual stop keeps any streamed progress and does not invent failure copy. */
export function projectModelChatCancellation(
  message: FailedAssistantProjectionInput,
  livePartial = ""
) {
  return {
    content: preserveAssistantPartial(message, livePartial),
    reasoningSummary: String(message.reasoningSummary || ""),
    excludeFromModelContext: true as const
  };
}
