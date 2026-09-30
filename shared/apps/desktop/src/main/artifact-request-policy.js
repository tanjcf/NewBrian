function detectRequestedFormats(content) {
  const text = String(content || "")
    .split(/(?<=[，。；;\n])/u)
    .filter((clause) => !/(?:不要|不得|禁止|无需|不需要|不再|避免|do\s+not|don't|must\s+not|without)/iu.test(clause))
    .join("");
  const formats = [];
  if (/(?:\.pdf\b|pdf\s*(?:文件|file)|(?:输出|生成|创建|新建|写入|保存|produce|create|write|save)[\s\S]{0,32}pdf)/i.test(text)) formats.push("pdf");
  if (/(?:\.docx\b|(?:输出|生成|创建|新建|写入|保存|produce|create|write|save)[\s\S]{0,36}(?:word|docx)|(?:word|docx)\s*(?:文件|文档|版本|file|document|version))/i.test(text)) formats.push("docx");
  if (/(?:\.xlsx\b|(?:输出|生成|创建|新建|写入|保存|produce|create|write|save)[\s\S]{0,36}(?:excel|xlsx)|(?:excel|xlsx)\s*(?:文件|表格|工作簿|版本|file|workbook|version))/i.test(text)) formats.push("xlsx");
  if (/(?:\.pptx\b|(?:输出|生成|创建|新建|写入|保存|produce|create|write|save)[\s\S]{0,36}(?:ppt|pptx|powerpoint)|(?:ppt|pptx|powerpoint)\s*(?:文件|演示文稿|版本|file|presentation|version))/i.test(text)) formats.push("pptx");
  return formats;
}

function currentArtifactRequest(content) {
  const text = String(content || "");
  const marker = "当前用户选择或补充：";
  const markerIndex = text.lastIndexOf(marker);
  if (markerIndex < 0) return text;
  const current = text.slice(markerIndex + marker.length).trim();
  return detectRequestedFormats(current).length > 0 ? current : text;
}

export function requestedArtifactFormats(content) {
  return detectRequestedFormats(currentArtifactRequest(content));
}

export function requestsPdfFile(content) {
  return requestedArtifactFormats(content).includes("pdf");
}

export function requestsOutputArtifact(content) {
  const request = currentArtifactRequest(content);
  return requestedArtifactFormats(request).length > 0
    || /\.(?:png|jpe?g|webp|gif|svg|txt|md|json|csv)\b/i.test(request)
    || /(?:输出|生成|创建|保存|create|generate|produce|save)[\s\S]{0,36}(?:图片|文件|image|file|artifact)/i.test(request);
}

function normalizeArtifactPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
}

function explicitArtifactTarget(content, extension) {
  const text = currentArtifactRequest(content);
  const escapedExtension = String(extension || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filePattern = `([^\\r\\n\"'“”‘’<>|:*?]+?\\.${escapedExtension})(?=$|[\\s，。；;、,）)])`;
  const labeled = new RegExp(
    `(?:文件名(?:为|是|叫做?)?|保存为|另存为|命名为|named|save\\s+as)\\s*[：:=]?\\s*[\"'“”‘’]?${filePattern}`,
    "iu"
  ).exec(text)?.[1];
  const quoted = new RegExp(`[\"'“”‘’]([^\"'“”‘’\\r\\n]+\\.${escapedExtension})[\"'“”‘’]`, "iu")
    .exec(text)?.[1];
  const requested = (labeled || quoted)?.trim();
  if (!requested) return null;
  const normalized = requested.replace(/\\/g, "/").replace(/^\.\//, "");
  const relative = normalized.toLowerCase().startsWith("outputs/")
    ? normalized
    : `outputs/${normalized}`;
  if (relative.split("/").some((segment) => segment === "..")) return null;
  return relative.replace(/[\\:*?<>|]/g, "-");
}

export function requestedArtifactSatisfied(content, artifacts) {
  if (!requestsOutputArtifact(content)) return true;
  const verified = artifacts.filter((artifact) => Number(artifact.size) > 0);
  const formats = requestedArtifactFormats(content);
  if (formats.length > 0) {
    return formats.every((format) => {
      const explicitTarget = explicitArtifactTarget(content, format);
      if (explicitTarget) {
        const expected = normalizeArtifactPath(explicitTarget);
        return verified.some((artifact) => normalizeArtifactPath(artifact.path) === expected);
      }
      return verified.some((artifact) => artifact.path.toLowerCase().endsWith(`.${format}`));
    });
  }
  return verified.length > 0;
}

export function requestedArtifactTargetPath(content, format, options = {}) {
  const extension = String(format || "").toLowerCase();
  const text = String(content || "");
  const explicitTarget = explicitArtifactTarget(content, extension);
  if (explicitTarget) return explicitTarget;
  const quoted = [...text.matchAll(/[“\"']([^”\"'\r\n]+\.(?:pdf|docx|xlsx|pptx))[”\"']/gi)]
    .map((match) => match[1])
    .find((name) => name.toLowerCase().endsWith(`.${extension}`));
  if (quoted) return `outputs/${quoted.replace(/[\\/:*?<>|]/g, "-")}`;
  const listed = text
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\d+\s*[.、)]\s*/u, "").trim().replace(/[，。；;]+$/u, ""))
    .find((line) => line.toLowerCase().endsWith(`.${extension}`) && !/[\\/:*?<>|]/u.test(line));
  if (listed) return `outputs/${listed}`;
  if (options.government) {
    const title = text.match(/(?:写|撰写|起草|形成)(?:一篇|一份|一个)?([^，。\r\n]{2,60}(?:发言稿|讲话稿|报告|总结|通知|方案|材料))/u)?.[1]
      ?.replace(/^完整/u, "")
      .trim();
    if (title) return `outputs/${title}-第一版.${extension}`;
  }
  return `outputs/newbrain-output.${extension}`;
}
