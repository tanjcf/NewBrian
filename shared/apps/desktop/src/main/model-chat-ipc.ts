import { ipcMain, type WebContents } from "electron";
import { desktopIpcChannels, type ModelChatInput } from "@codex-forge/protocol";
import { parseModelChatInput } from "./model-chat-contract.js";
import { tryHandleDailyBriefingChat } from "./daily-briefing-delivery.js";

interface ModelChatIpcServices {
  chat: (caller: { sender: WebContents }, input: ModelChatInput) => Promise<unknown>;
}

/** Registers the streaming model entry point behind a bounded input contract. */
export function registerModelChatIpcHandlers(services: ModelChatIpcServices) {
  ipcMain.handle(desktopIpcChannels.model.chat, async (event, input: unknown) => {
    const parsed = parseModelChatInput(input);
    try {
      const briefing = await tryHandleDailyBriefingChat({
        workspaceId: parsed.workspaceId,
        threadId: parsed.threadId,
        requestId: parsed.requestId,
        messages: parsed.messages
      });
      if (briefing) return briefing;
    } catch {
      // A briefing lookup failure still has to reach the normal conversation.
    }
    return services.chat({ sender: event.sender }, parsed);
  });
}
