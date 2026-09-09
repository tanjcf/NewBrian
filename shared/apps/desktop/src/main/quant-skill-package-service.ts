import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { assertUserSkillWriteAllowed } from "./user-skill-write-guard.js";

export type QuantSkillPackageInput = {
  skillId: string;
  title: string;
  symbol: string;
  strategyId: "trend-following" | "mean-reversion";
};

type QuantSkillAsset = QuantSkillPackageInput & {
  schemaVersion: 1;
  managedBy: "newbrain.quant";
  createdAt: string;
};

const validSkillId = (value: string) => /^[a-z0-9][a-z0-9_-]{1,63}$/.test(value);
const isRecoverableQuantAsset = (asset: Record<string, unknown>, skillId: string): boolean => (
  asset.managedBy === undefined
  && asset.skillId === skillId
  && asset.simulationOnly === true
  && typeof asset.symbol === "string"
  && /^[0-9A-Za-z._-]{1,32}$/.test(asset.symbol)
  && (asset.strategyId === "trend-following" || asset.strategyId === "mean-reversion")
);

export class QuantSkillPackageService {
  private readonly workspacePath: string;
  private readonly skillsRoot: string;

  constructor(workspacePath: string) {
    const resolved = resolve(workspacePath);
    if (!resolved) throw new TypeError("workspacePath is required");
    this.workspacePath = resolved;
    this.skillsRoot = join(resolved, ".newbrain", "skills");
  }

  private target(skillId: string): string {
    const id = skillId.trim();
    if (!validSkillId(id)) throw new TypeError("skillId must be a stable lowercase identifier");
    const target = resolve(this.skillsRoot, id);
    if (!target.startsWith(`${resolve(this.skillsRoot)}${sep}`)) throw new TypeError("skillId resolves outside the Skill root");
    return target;
  }

  async create(input: QuantSkillPackageInput): Promise<{ created: boolean; relativePath: string }> {
    const skillId = input.skillId.trim();
    const title = input.title.trim();
    const symbol = input.symbol.trim();
    if (!title) throw new TypeError("title is required");
    if (!/^[0-9A-Za-z._-]{1,32}$/.test(symbol)) throw new TypeError("symbol is invalid");
    if (input.strategyId !== "trend-following" && input.strategyId !== "mean-reversion") throw new TypeError("strategyId is invalid");
    const target = this.target(skillId);
    const relativePath = `.newbrain/skills/${skillId}`;
    try {
      const current = JSON.parse(await readFile(join(target, "asset.json"), "utf8")) as Partial<QuantSkillAsset>;
      assertUserSkillWriteAllowed({
        targetPath: skillId,
        exists: true,
        managedBy: current.managedBy ?? null,
        policy: "quant"
      });
      return { created: false, relativePath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    await mkdir(this.skillsRoot, { recursive: true });
    const staging = join(this.skillsRoot, `.tmp-${skillId}-${randomUUID()}`);
    const asset: QuantSkillAsset = { ...input, skillId, title, symbol, schemaVersion: 1, managedBy: "newbrain.quant", createdAt: new Date().toISOString() };
    const markdown = [
      "---",
      `name: ${skillId}`,
      `description: ${title}，使用 ${symbol} 真实历史行情执行 ${input.strategyId} 模拟策略；不连接真实券商。`,
      "---",
      "",
      `# ${title}`,
      "",
      `标的：${symbol}`,
      `策略：${input.strategyId}`,
      "",
      "通过 quant.market.query 查询真实行情，通过 quant.strategy.run 将模拟成交写入本 Skill 的独立组合账本。",
      "所有交易仅为模拟，不连接或操作真实券商账户。",
      ""
    ].join("\n");
    const usage = [
      `# ${title} 使用说明`,
      "",
      `- 查询标的：${symbol}`,
      `- 策略信号：${input.strategyId}`,
      `- 组合标识：${skillId}`,
      "- 行情必须来自 Spring → AKShare 工具结果。",
      "- 创建、回测和删除都必须同步右侧量化 tools。",
      ""
    ].join("\n");
    try {
      await mkdir(join(staging, "skill"), { recursive: true });
      await mkdir(join(staging, "knowledge"), { recursive: true });
      await writeFile(join(staging, "asset.json"), `${JSON.stringify(asset, null, 2)}\n`, "utf8");
      await writeFile(join(staging, "skill", "SKILL.md"), markdown, "utf8");
      await writeFile(join(staging, "knowledge", "usage.md"), usage, "utf8");
      await rename(staging, target);
      return { created: true, relativePath };
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async remove(skillId: string): Promise<{ removed: boolean; relativePath: string }> {
    const id = skillId.trim();
    const target = this.target(id);
    const relativePath = `.newbrain/skills/${id}`;
    let asset: Record<string, unknown>;
    try {
      asset = JSON.parse(await readFile(join(target, "asset.json"), "utf8")) as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { removed: false, relativePath };
      throw error;
    }
    const managed = asset.managedBy === "newbrain.quant";
    const migratableLegacy = asset.name === id && asset.type === "quant" && asset.simulationOnly === true;
    // Older/model-edited tool assets can lose only the ownership marker while
    // retaining the full quantitative identity. Never migrate an explicit
    // foreign owner or a generic user Skill.
    const recoverableQuantAsset = isRecoverableQuantAsset(asset, id);
    if (!managed && !migratableLegacy && !recoverableQuantAsset) throw new Error(`Refusing to remove unmanaged Skill: ${id}`);
    await rm(target, { recursive: true, force: false });
    return { removed: true, relativePath };
  }
}
