function tokenize(value) {
  return [...new Set(String(value || "").toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])];
}

function makeId() {
  return `memory-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export class MemoryIndex {
  constructor(input = {}) {
    this.maxRecords = Math.max(10, input.maxRecords ?? 100);
    this.records = new Map();
  }

  hydrate(records = []) {
    this.records.clear();
    for (const record of records) this.upsert(record);
    return this.list();
  }

  upsert(input) {
    const summary = String(input.summary || "").replace(/\s+/g, " ").trim();
    if (!summary) throw new Error("Memory summary is required.");
    const record = {
      id: input.id || makeId(),
      scope: ["workspace", "session", "user"].includes(input.scope) ? input.scope : "session",
      summary: summary.slice(0, 2_000),
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: Number(input.usageCount || 0),
      lastUsedAt: input.lastUsedAt || null,
      terms: tokenize(summary)
    };
    this.records.set(record.id, record);
    this.prune();
    return this.publicRecord(record);
  }

  list() {
    return [...this.records.values()]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .map((record) => this.publicRecord(record));
  }

  search(query, input = {}) {
    const terms = tokenize(query);
    if (!terms.length) return this.list().slice(0, input.limit ?? 5);
    const now = Date.now();
    const results = [...this.records.values()].map((record) => {
      const overlap = terms.filter((term) => record.terms.some((candidate) =>
        candidate === term || candidate.includes(term) || term.includes(candidate))).length;
      const ageDays = Math.max(0, (now - Date.parse(record.updatedAt)) / 86_400_000);
      const recency = 1 / (1 + ageDays / 30);
      return { record, score: overlap * 10 + recency + Math.min(record.usageCount, 20) * 0.05 };
    }).filter((item) => item.score >= 10)
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit ?? 5);
    const usedAt = new Date().toISOString();
    for (const item of results) {
      item.record.usageCount += 1;
      item.record.lastUsedAt = usedAt;
    }
    return results.map((item) => ({ ...this.publicRecord(item.record), score: item.score }));
  }

  rememberExchange(input) {
    const request = String(input.user || "").replace(/\s+/g, " ").trim();
    const response = String(input.assistant || "").replace(/\s+/g, " ").trim();
    if (!request || !response) return null;
    const summary = `用户目标：${request.slice(0, 500)}；处理结果：${response.slice(0, 900)}`;
    const duplicate = [...this.records.values()].find((record) => record.summary === summary);
    if (duplicate) return this.publicRecord(duplicate);
    return this.upsert({ scope: input.scope || "session", summary });
  }

  prune() {
    if (this.records.size <= this.maxRecords) return;
    const removable = [...this.records.values()].sort((left, right) => {
      if (left.usageCount !== right.usageCount) return left.usageCount - right.usageCount;
      return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
    });
    while (this.records.size > this.maxRecords) this.records.delete(removable.shift().id);
  }

  publicRecord(record) {
    const { terms: _terms, updatedAt: _updatedAt, ...publicRecord } = record;
    return { ...publicRecord };
  }
}
