export class JsonStringFieldStream {
  private source = "";
  private emitted = "";
  private readonly fieldName: string;

  constructor(fieldName: string) {
    this.fieldName = fieldName;
  }

  push(delta: string): string {
    this.source += delta;
    const marker = new RegExp(`"${this.fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"`).exec(this.source);
    if (!marker) return "";
    const start = marker.index + marker[0].length;
    let escaped = false;
    let end = start;
    for (; end < this.source.length; end += 1) {
      const character = this.source[end];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') break;
    }
    let raw = this.source.slice(start, end);
    if (escaped) raw = raw.slice(0, -1);
    let decoded = "";
    while (raw) {
      try {
        decoded = JSON.parse(`"${raw}"`);
        break;
      } catch {
        raw = raw.slice(0, -1);
      }
    }
    if (!decoded || !decoded.startsWith(this.emitted)) return "";
    const next = decoded.slice(this.emitted.length);
    this.emitted = decoded;
    return next;
  }
}
