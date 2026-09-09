export declare const ARTIFACT_PROTOCOL_SCHEME: "newbrain-artifact";
export declare const ARTIFACT_PROTOCOL_HOST: "preview";
export declare const ARTIFACT_PROTOCOL_MAX_BYTES: number;

export function isHtmlArtifactPath(filePath: string): boolean;
export function isHtmlArtifactExtension(extension: string): boolean;
export function buildWorkspaceArtifactPreviewUrl(workspaceId: string, relativePath: string): string;
export function parseWorkspaceArtifactPreviewUrl(requestUrl: string): { workspaceId: string; relativePath: string } | null;
export function mimeTypeForArtifactPath(filePath: string): string;
/** Sniff audio MIME from the first bytes of a file (mp3/wav/ogg/…). */
export function sniffAudioMimeFromBytes(head: ArrayBufferView | ArrayLike<number> | null | undefined): string;
/** Prefer sniffed audio MIME over a mismatched extension for protocol responses. */
export function resolveArtifactMimeType(
  filePath: string,
  headBytes?: ArrayBufferView | ArrayLike<number> | null
): string;
export function isAudioArtifactExtension(extension: string): boolean;
export function firstAudioArtifactExtension(...paths: string[]): string;
export function isAudioArtifactCandidate(...paths: string[]): boolean;
export function isAudioArtifactPath(filePath: string): boolean;
export function isImageArtifactPath(filePath: string): boolean;
export function isImageArtifactExtension(extension: string): boolean;
export function isVideoArtifactPath(filePath: string): boolean;
export function isVideoArtifactExtension(extension: string): boolean;
export function parseByteRangeHeader(
  rangeHeader: string | null | undefined,
  totalSize: number
): { start: number; end: number } | null;
export function artifactProtocolResponseHeaders(
  mimeType: string,
  extra?: Record<string, string>
): Record<string, string>;
