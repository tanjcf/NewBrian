import { join } from "node:path";

export type WrittenArtifact = {
  path: string;
  size: number;
  changeType: "created" | "modified";
};

export function collectWrittenArtifacts(events: readonly unknown[]): WrittenArtifact[] {
  const artifacts = new Map<string, WrittenArtifact>();
  for (const candidate of events) {
    const event = candidate as { type?: string; payload?: any };
    const payload = event?.payload;
    const artifact = payload?.result?.artifact;
    const recordsArtifact = payload?.name === "workspace.write_file" || payload?.name === "artifact.create" || payload?.name === "document.create_pdf" || payload?.name === "document.create_docx" || payload?.name === "artifact.inspect";
    if (event?.type !== "tool_result" || !recordsArtifact || payload?.result?.ok !== true) continue;
    if (!artifact || typeof artifact.path !== "string" || typeof artifact.size !== "number") continue;
    if (payload.name === "artifact.inspect" && artifact.size <= 0) continue;
    const prior = artifacts.get(artifact.path);
    artifacts.set(artifact.path, {
      path: artifact.path,
      size: artifact.size,
      changeType: payload.name === "artifact.inspect" && prior
        ? prior.changeType
        : artifact.changeType === "modified" ? "modified" : "created"
    });
  }
  return [...artifacts.values()];
}

export function formatWrittenArtifactSummary(workspacePath: string, artifacts: WrittenArtifact[]): string {
  if (artifacts.length === 0) return "";
  const created = artifacts.filter((item) => item.changeType === "created").length;
  const modified = artifacts.length - created;
  const lines = [
    `### \u6587\u4ef6\u53d8\u66f4`,
    `\u65b0\u5efa ${created} \u4e2a\uff0c\u7f16\u8f91 ${modified} \u4e2a\u3002`
  ];
  for (const artifact of artifacts) {
    const absolutePath = join(workspacePath, artifact.path);
    const label = artifact.changeType === "created" ? "\u65b0\u5efa" : "\u7f16\u8f91";
    lines.push(`- ${label}\uff1a[${artifact.path}](<${absolutePath}>)\uff08${artifact.size} \u5b57\u8282\uff09`);
  }
  return lines.join("\n");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Links model-authored artifact mentions using paths verified by the runtime. */
export function linkWrittenArtifactMentions(content: string, workspacePath: string, artifacts: WrittenArtifact[]) {
  let output = String(content ?? "");
  artifacts.forEach((artifact, artifactIndex) => {
    const absolutePath = join(workspacePath, artifact.path);
    const basename = artifact.path.split(/[\\/]/).at(-1) ?? artifact.path;
    const labels = [...new Set([artifact.path, basename])].sort((left, right) => right.length - left.length);
    labels.forEach((label, labelIndex) => {
      if (!label) return;
      const link = `[${label}](<${absolutePath}>)`;
      const token = `\u0000NEWBRAIN_ARTIFACT_${artifactIndex}_${labelIndex}\u0000`;
      output = output.split(link).join(token);
      const escaped = escapeRegExp(label);
      output = output
        .replace(new RegExp(`\\*\\*${escaped}\\*\\*`, "gu"), token)
        .replace(new RegExp(`__${escaped}__`, "gu"), token)
        .replace(new RegExp("`" + escaped + "`", "gu"), token)
        .replace(new RegExp(`(?<![\\[\\w/\\\\])${escaped}(?!\\]\\()`, "gu"), token);
      output = output.split(token).join(link);
    });
  });
  return output;
}
