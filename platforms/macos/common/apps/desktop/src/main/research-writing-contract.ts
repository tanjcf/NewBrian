import type {
  ResearchWritingExportFormat,
  ResearchWritingExportInput,
  ResearchWritingIntakeInput,
  ResearchWritingPayload,
  ResearchWritingSourceInput
} from "@codex-forge/protocol";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maxLength: number, optional: true): string | undefined;
function text(value: unknown, label: string, maxLength: number, optional?: false): string;
function text(value: unknown, label: string, maxLength: number, optional = false): string | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  if (value.length > maxLength) throw new TypeError(`${label} is too long.`);
  return value;
}

function array(value: unknown, label: string, maxLength: number) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  if (value.length > maxLength) throw new TypeError(`${label} has too many items.`);
  return value;
}

export function parseResearchWritingIntakeInput(value: unknown): ResearchWritingIntakeInput {
  const input = record(value, "Research intake input");
  const answers = array(input.answers, "Research intake answers", 50).map((item, index) => {
    const answer = record(item, `Research intake answer ${index + 1}`);
    return {
      question: text(answer.question, "Research intake question", 1_000),
      answer: text(answer.answer, "Research intake answer", 4_000)
    };
  });
  const attachments = input.attachments === undefined ? undefined : array(input.attachments, "Research intake attachments", 20).map((item, index) => {
    const attachment = record(item, `Research intake attachment ${index + 1}`);
    return {
      name: text(attachment.name, "Attachment name", 512),
      path: text(attachment.path, "Attachment path", 4_096),
      url: text(attachment.url, "Attachment URL", 8_192)
    };
  });
  return {
    userRequest: text(input.userRequest, "Research user request", 8_000, true),
    conversationContext: text(input.conversationContext, "Research conversation context", 8_000, true),
    answers,
    attachments
  };
}

function parseSource(value: unknown, index: number): ResearchWritingSourceInput {
  const source = record(value, `Research source ${index + 1}`);
  return {
    title: text(source.title, "Research source title", 1_000),
    sourceType: text(source.sourceType, "Research source type", 200),
    url: text(source.url, "Research source URL", 8_192, true),
    content: text(source.content, "Research source content", 200_000)
  };
}

export function parseResearchWritingPayload(value: unknown): ResearchWritingPayload {
  const payload = record(value, "Research writing payload");
  return {
    title: text(payload.title, "Research title", 1_000, true),
    body: text(payload.body, "Research body", 1_000_000),
    sources: array(payload.sources, "Research sources", 100).map(parseSource)
  };
}

export function parseResearchWritingExportInput(value: unknown): ResearchWritingExportInput {
  const input = record(value, "Research export input");
  const allowedFormats: ResearchWritingExportFormat[] = ["docx", "txt", "review-docx", "review-txt"];
  if (!allowedFormats.includes(input.format as ResearchWritingExportFormat)) throw new TypeError("Unsupported research export format.");
  return { payload: parseResearchWritingPayload(input.payload), format: input.format as ResearchWritingExportFormat };
}
