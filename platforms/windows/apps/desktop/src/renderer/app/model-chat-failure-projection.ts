export interface FailedAssistantProjectionInput {
  content?: string;
  reasoningSummary?: string;
}

export function projectModelChatFailure(
  message: FailedAssistantProjectionInput,
  errorMessage: string,
  livePartial = ""
) {
  const currentContent = String(message.content || "");
  const partialContent = String(livePartial || "");
  const preservedContent = currentContent.trim().length >= partialContent.trim().length
    ? currentContent
    : partialContent;
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
