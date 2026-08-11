export declare const ARTIFACT_PROTOCOL_SCHEME: "codecn-artifact";
export declare const ARTIFACT_PROTOCOL_HOST: "preview";
export declare const ARTIFACT_PROTOCOL_MAX_BYTES: number;

export function isHtmlArtifactPath(filePath: string): boolean;
export function isHtmlArtifactExtension(extension: string): boolean;
export function buildWorkspaceArtifactPreviewUrl(workspaceId: string, relativePath: string): string;
export function parseWorkspaceArtifactPreviewUrl(requestUrl: string): { workspaceId: string; relativePath: string } | null;
export function mimeTypeForArtifactPath(filePath: string): string;
export function isImageArtifactPath(filePath: string): boolean;
export function isImageArtifactExtension(extension: string): boolean;
export function isVideoArtifactPath(filePath: string): boolean;
export function isVideoArtifactExtension(extension: string): boolean;
