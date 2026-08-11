import { extname } from "node:path";

interface ArtifactRenderInput {
  targetPath: string;
  kind?: string;
}

interface ArtifactRenderResult extends Record<string, unknown> {
  ok: boolean;
}

export interface DesktopArtifactPreviewDependencies {
  renderBase: (input: ArtifactRenderInput) => Promise<ArtifactRenderResult>;
  resolveFile: (targetPath: string) => Promise<{ targetPath: string; relativePath: string }>;
  extractText: (targetPath: string, extension: string) => Promise<string>;
}

/** Adds bounded desktop text previews to canonical artifact validation/rendering results. */
export class DesktopArtifactPreviewService {
  private readonly dependencies: DesktopArtifactPreviewDependencies;

  constructor(dependencies: DesktopArtifactPreviewDependencies) {
    this.dependencies = dependencies;
  }

  async render(input: ArtifactRenderInput) {
    const base = await this.dependencies.renderBase(input);
    if (!base.ok) return base;
    const { targetPath, relativePath } = await this.dependencies.resolveFile(input.targetPath);
    const extension = extname(targetPath).toLowerCase();
    if (![".pdf", ".docx", ".xlsx", ".txt", ".md", ".json", ".csv", ".tsv"].includes(extension)) {
      return base;
    }
    const preview = await this.dependencies.extractText(targetPath, extension);
    return {
      ...base,
      targetPath: relativePath,
      preview: preview.slice(0, 12_000),
      previewTruncated: preview.length > 12_000,
      renderMode: extension === ".xlsx"
        ? "spreadsheet-text"
        : extension === ".pdf"
          ? "pdf-text"
          : extension === ".docx"
            ? "document-text"
            : "text"
    };
  }
}
