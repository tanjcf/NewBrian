import { ipcMain, type WebContents } from "electron";
import { desktopIpcChannels, type ModelChatInput } from "@codex-forge/protocol";
import { parseModelChatInput } from "./model-chat-contract.js";

interface ModelChatIpcServices {
  chat: (caller: { sender: WebContents }, input: ModelChatInput) => Promise<unknown>;
}

/** Registers the streaming model entry point behind a bounded input contract. */
export function registerModelChatIpcHandlers(services: ModelChatIpcServices) {
  ipcMain.handle(desktopIpcChannels.model.chat, (event, input: unknown) =>
    services.chat({ sender: event.sender }, parseModelChatInput(input)));
}
