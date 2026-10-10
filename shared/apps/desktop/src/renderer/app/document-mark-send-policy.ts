/** Decides what the PPT mark prompt send button must do. An empty instruction does nothing; any written instruction is sent to chat. */
export function planDocumentMarkSend(input: {
  instruction: string;
  hasBrainFile: boolean;
  hasProject: boolean;
  hasCandidate: boolean;
  hasAnnotationApi: boolean;
}): { action: "ignore" | "chat" | "annotate-and-chat" } {
  if (!String(input.instruction || "").trim()) return { action: "ignore" };
  if (input.hasBrainFile && input.hasProject && input.hasCandidate && input.hasAnnotationApi) {
    return { action: "annotate-and-chat" };
  }
  return { action: "chat" };
}
