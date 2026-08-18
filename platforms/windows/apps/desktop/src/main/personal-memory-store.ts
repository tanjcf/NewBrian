import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PersonalMemoryRecord = {
  kind: string;
  content: Record<string, unknown>;
  updatedAt: string;
};

export type PersonalMemoryStoreInput = {
  filePath: string;
};

/**
 * Local personal preference/tone store (json file) with optional Hub sync.
 */
export class PersonalMemoryStore {
  private readonly filePath: string;

  constructor(input: PersonalMemoryStoreInput) {
    this.filePath = input.filePath;
  }

  async readAll(): Promise<PersonalMemoryRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { items?: PersonalMemoryRecord[] };
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      return [];
    }
  }

  async upsert(kind: string, content: Record<string, unknown>): Promise<PersonalMemoryRecord> {
    const items = await this.readAll();
    const next: PersonalMemoryRecord = {
      kind,
      content,
      updatedAt: new Date().toISOString()
    };
    const index = items.findIndex((item) => item.kind === kind);
    if (index >= 0) items[index] = next;
    else items.push(next);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ items }, null, 2), "utf8");
    return next;
  }

  /**
   * Push local records to Growth Memory Hub as scope=user.
   */
  async syncToHub(
    upsertMemory: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
  ): Promise<number> {
    const items = await this.readAll();
    let synced = 0;
    for (const item of items) {
      await upsertMemory({
        scope: "user",
        kind: item.kind,
        content: item.content
      });
      synced += 1;
    }
    return synced;
  }
}

export function defaultPersonalMemoryPath(userDataDir: string): string {
  return join(userDataDir, "growth", "personal_memory.json");
}
