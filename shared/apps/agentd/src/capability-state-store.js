import { promises as fs } from "node:fs";
import path from "node:path";

export class CapabilityStateStore {
  constructor({ rootPath }) {
    this.rootPath = path.resolve(rootPath);
    this.eventPath = path.join(this.rootPath, "events.jsonl");
  }

  async append(event) {
    await fs.mkdir(this.rootPath, { recursive: true });
    const record = { schemaVersion: 1, timestamp: new Date().toISOString(), ...event };
    await fs.appendFile(this.eventPath, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  async readEvents() {
    try {
      const content = await fs.readFile(this.eventPath, "utf8");
      return content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
}
