export interface RequestedLengthRange {
  min: number;
  max: number;
}

export const MAX_GOVERNMENT_WRITING_CHARACTERS = 50_000;

function boundedLength(value: number) {
  return Math.max(1, Math.min(MAX_GOVERNMENT_WRITING_CHARACTERS, Math.round(value)));
}

export function countGovernmentWritingCharacters(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#*_>`~|\-]+/g, "")
    .replace(/\s+/g, "")
    .length;
}

export function parseRequestedLengthRange(text: string): RequestedLengthRange | null {
  const normalized = text.replace(/，/g, ",");
  const explicit = normalized.match(/(\d{2,6})\s*(?:至|到|[-–—~～])\s*(\d{2,6})\s*字/);
  if (explicit) {
    const left = Number(explicit[1]);
    const right = Number(explicit[2]);
    if (Number.isFinite(left) && Number.isFinite(right) && left > 0 && right >= left) {
      return { min: boundedLength(left), max: boundedLength(right) };
    }
  }
  const upperBound = normalized.match(/(?:不超过|最多)\s*(\d{2,6})\s*字|(\d{2,6})\s*字\s*以内/);
  const upper = Number(upperBound?.[1] || upperBound?.[2] || 0);
  if (upper > 0) return { min: 1, max: boundedLength(upper) };
  const lowerBound = normalized.match(/(?:不少于|至少)\s*(\d{2,6})\s*字/);
  const lower = Number(lowerBound?.[1] || 0);
  if (lower > 0) return { min: boundedLength(lower), max: MAX_GOVERNMENT_WRITING_CHARACTERS };
  const approximate = normalized.match(/(?:约|大约|左右)\s*(\d{2,6})\s*字|(?:(\d{2,6})\s*字\s*左右)/);
  const target = Number(approximate?.[1] || approximate?.[2] || 0);
  if (target > 0) {
    return { min: boundedLength(target * 0.9), max: boundedLength(target * 1.1) };
  }
  const englishApproximate = normalized.match(/(?:approximately|about|around)\s*(\d{2,6})[-\s]*(?:Chinese[-\s]*)?characters?/i);
  const englishTarget = Number(englishApproximate?.[1] || 0);
  if (englishTarget > 0) {
    return { min: boundedLength(englishTarget * 0.9), max: boundedLength(englishTarget * 1.1) };
  }
  const plain = normalized.match(/(?:控制在|篇幅为|正文为)?\s*(\d{2,6})\s*字(?:的|讲话|材料|稿|$)/);
  const plainTarget = Number(plain?.[1] || 0);
  if (plainTarget > 0) {
    return { min: boundedLength(plainTarget * 0.9), max: boundedLength(plainTarget * 1.1) };
  }
  return null;
}

export function isGovernmentWritingLengthAccepted(text: string, range: RequestedLengthRange) {
  const count = countGovernmentWritingCharacters(text);
  return count >= range.min && count <= range.max;
}

export function trimGovernmentWritingToRange(text: string, range: RequestedLengthRange) {
  const source = text.trim();
  if (countGovernmentWritingCharacters(source) <= range.max) return source;
  const segments = source.match(/[^。！？；\n]+[。！？；]?|\n+/g) ?? [source];
  let result = "";
  for (const segment of segments) {
    const candidate = `${result}${segment}`.trim();
    if (countGovernmentWritingCharacters(candidate) > range.max) break;
    result = candidate;
  }
  if (countGovernmentWritingCharacters(result) >= range.min) return result.trim();

  const characters = Array.from(source);
  let clipped = "";
  for (const character of characters) {
    const candidate = `${clipped}${character}`;
    if (countGovernmentWritingCharacters(candidate) > range.max - 1) break;
    clipped = candidate;
  }
  return `${clipped.replace(/[，、：；\s]+$/u, "")}。`.trim();
}

export async function enforceGovernmentWritingLength(input: {
  text: string;
  range: RequestedLengthRange;
  evidenceContext?: string;
  revise: (currentText: string, currentCount: number, attempt: number) => Promise<string>;
  onRevision?: (currentCount: number, attempt: number) => void | Promise<void>;
  maxRevisions?: number;
}) {
  let text = input.text.trim();
  const maxRevisions = Math.max(0, Math.min(3, input.maxRevisions ?? 2));
  for (let attempt = 1; attempt <= maxRevisions && !isGovernmentWritingLengthAccepted(text, input.range); attempt += 1) {
    const currentCount = countGovernmentWritingCharacters(text);
    await input.onRevision?.(currentCount, attempt);
    const revised = (await input.revise(text, currentCount, attempt)).trim();
    if (revised) text = revised;
  }
  if (!isGovernmentWritingLengthAccepted(text, input.range)) {
    const bounded = countGovernmentWritingCharacters(text) > input.range.max
      ? trimGovernmentWritingToRange(text, input.range)
      : text;
    if (isGovernmentWritingLengthAccepted(bounded, input.range)) return bounded;
    const finalCount = countGovernmentWritingCharacters(text);
    throw new Error(`政务写作长度校验未通过：当前 ${finalCount} 字，要求 ${input.range.min}-${input.range.max} 字。请重试生成。`);
  }
  return text;
}
