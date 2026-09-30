import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type UsageExceptionFeedbackPreview,
  type UsageExceptionFeedbackSubmissionResult
} from "@codex-forge/protocol";
import {
  parseConfirmUsageExceptionFeedbackInput,
  parseCreateUsageExceptionFeedbackPreviewInput
} from "./user-usage-exception-feedback-contract.js";

interface UserUsageExceptionFeedbackIpcServices {
  createPreview: (input: ReturnType<typeof parseCreateUsageExceptionFeedbackPreviewInput>) => Promise<UsageExceptionFeedbackPreview>;
  confirm: (input: ReturnType<typeof parseConfirmUsageExceptionFeedbackInput>) => Promise<UsageExceptionFeedbackSubmissionResult>;
}

/** Register the two narrow feedback capabilities; all trusted context stays in main. */
export function registerUserUsageExceptionFeedbackIpc(services: UserUsageExceptionFeedbackIpcServices) {
  ipcMain.handle(desktopIpcChannels.usageExceptionFeedback.createPreview, (_event, input: unknown) =>
    services.createPreview(parseCreateUsageExceptionFeedbackPreviewInput(input))
  );
  ipcMain.handle(desktopIpcChannels.usageExceptionFeedback.confirm, (_event, input: unknown) =>
    services.confirm(parseConfirmUsageExceptionFeedbackInput(input))
  );
}
