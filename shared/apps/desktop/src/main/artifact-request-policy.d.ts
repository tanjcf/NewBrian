export function requestsPdfFile(content: string): boolean;
export function requestsOutputArtifact(content: string): boolean;
export function requestedArtifactSatisfied(content: string, artifacts: Array<{ path: string; size: number }>): boolean;
export function requestedArtifactTargetPath(content: string, format: "pdf" | "docx" | "xlsx" | "pptx", options?: { government?: boolean }): string;
export function requestedArtifactFormats(content: string): Array<"pdf" | "docx" | "xlsx" | "pptx">;
