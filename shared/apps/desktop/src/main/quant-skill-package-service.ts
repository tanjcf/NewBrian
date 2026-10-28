import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { assertUserSkillWriteAllowed } from "./user-skill-write-guard.js";
import { validateQuantStrategyRules, type QuantStrategyRules } from "./quant-strategy-rules.ts";

export type QuantSkillPackageInput = {
  skillId: string;
  title: string;
  symbol: string;
  strategyId: string;
  rules?: QuantStrategyRules;
};

type QuantSkillAsset = QuantSkillPackageInput & {
  schemaVersion: 1;
  managedBy: "newbrain.quant";
  createdAt: string;
  simulationOnly: true;
};

const validSkillId = (value: string) => /^[a-z0-9][a-z0-9_-]{1,63}$/.test(value);
const hasValidCustomRules = (asset: Record<string, unknown>): boolean => {
  if (!asset.rules) return false;
  try { validateQuantStrategyRules(asset.rules); return true; } catch { return false; }
};
const isRecoverableQuantAsset = (asset: Record<string, unknown>, skillId: string): boolean => (
  asset.managedBy === undefined
  && asset.skillId === skillId
  && asset.simulationOnly === true
  && typeof asset.symbol === "string"
  && /^[0-9A-Za-z._-]{1,32}$/.test(asset.symbol)
  && (asset.strategyId === "trend-following" || asset.strategyId === "mean-reversion" || hasValidCustomRules(asset))
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

  private skillMarkdown(input: QuantSkillPackageInput): string {
    return [
      "---",
      `name: ${input.skillId}`,
      `description: ${input.title}，使用 ${input.symbol} 真实历史行情执行 ${input.strategyId} 模拟策略；不连接真实券商。`,
      "---",
      "",
      `# ${input.title}`,
      "",
      `标的：${input.symbol}`,
      `策略：${input.strategyId}`,
      ...(input.rules ? ["", "## 条件规则", "", "```json", JSON.stringify(input.rules, null, 2), "```"] : []),
      "",
      "条件规则使用 all（全部成立）或 any（任一成立）；指标为收盘价、成交量、成交额、涨跌幅或指定周期简单均线；比较方式为高于、低于、上穿或下穿。买入和卖出信号用于模拟策略，跟踪信号仅用于雷达通知。",
      "通过 quant.market.query 查询真实行情，通过 quant.strategy.run 将模拟成交写入本 Skill 的独立组合账本。",
      "所有交易仅为模拟，不连接或操作真实券商账户。买入/卖出条件按 JSON 声明式比较执行；跟踪条件只生成观察信号，不会创建订单。",
      ""
    ].join("\n");
  }

  private async directoryExists(target: string): Promise<boolean> {
    try {
      await access(target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  /** Skill 本体放在 `.newbrain/skills/<skillId>/SKILL.md`，不再套一层 skill/ 目录。 */
  private async writePackage(target: string, input: QuantSkillPackageInput, asset: QuantSkillAsset): Promise<void> {
    await mkdir(join(target, "references"), { recursive: true });
    await writeFile(join(target, "asset.json"), `${JSON.stringify(asset, null, 2)}\n`, "utf8");
    await writeFile(join(target, "SKILL.md"), this.skillMarkdown(input), "utf8");
    await writeFile(join(target, "references", "usage.md"), [
      `# ${input.title} 使用说明`,
      "",
      `- 查询标的：${input.symbol}`,
      `- 策略信号：${input.strategyId}`,
      `- 组合标识：${input.skillId}`,
      "- 行情必须来自 Spring → AKShare 工具结果。",
      "- 创建、回测和删除都必须同步右侧量化 tools。",
      ""
    ].join("\n"), "utf8");
  }

  async read(skillId: string): Promise<QuantSkillAsset | null> {
    const target = this.target(skillId.trim());
    try {
      const asset = JSON.parse(await readFile(join(target, "asset.json"), "utf8")) as Record<string, unknown>;
      if (asset.managedBy !== "newbrain.quant" || asset.skillId !== skillId.trim() || asset.simulationOnly !== true) return null;
      if (typeof asset.strategyId !== "string") return null;
      return {
        skillId: String(asset.skillId), title: String(asset.title), symbol: String(asset.symbol), strategyId: asset.strategyId,
        ...(asset.rules === undefined ? {} : { rules: validateQuantStrategyRules(asset.rules) }),
        schemaVersion: 1, managedBy: "newbrain.quant", simulationOnly: true, createdAt: String(asset.createdAt)
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async list(): Promise<Array<Pick<QuantSkillAsset, "skillId" | "title" | "symbol" | "strategyId" | "rules" | "simulationOnly">>> {
    let entries;
    try { entries = await readdir(this.skillsRoot, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const assets = await Promise.all(entries.filter((entry) => entry.isDirectory() && validSkillId(entry.name)).map((entry) => this.read(entry.name).catch(() => null)));
    return assets.filter((asset): asset is QuantSkillAsset => asset !== null).map(({ skillId, title, symbol, strategyId, rules, simulationOnly }) => ({ skillId, title, symbol, strategyId, ...(rules ? { rules } : {}), simulationOnly }));
  }

  async create(input: QuantSkillPackageInput): Promise<{ created: boolean; relativePath: string }> {
    const skillId = input.skillId.trim();
    const title = input.title.trim();
    const symbol = input.symbol.trim();
    if (!title) throw new TypeError("title is required");
    if (!/^[0-9A-Za-z._-]{1,32}$/.test(symbol)) throw new TypeError("symbol is invalid");
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(input.strategyId)) throw new TypeError("strategyId is invalid");
    const builtin = input.strategyId === "trend-following" || input.strategyId === "mean-reversion";
    const rules = input.rules ? validateQuantStrategyRules(input.rules) : undefined;
    if (!builtin && !rules) throw new TypeError("custom strategies require declarative buy and sell rules");
    const normalized: QuantSkillPackageInput = { skillId, title, symbol, strategyId: input.strategyId, ...(rules ? { rules } : {}) };
    const target = this.target(skillId);
    const relativePath = `.newbrain/skills/${skillId}`;
    if (await this.directoryExists(target)) {
      let current: Partial<QuantSkillAsset> = {};
      try {
        current = JSON.parse(await readFile(join(target, "asset.json"), "utf8")) as Partial<QuantSkillAsset>;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      assertUserSkillWriteAllowed({
        targetPath: skillId,
        exists: true,
        managedBy: current.managedBy ?? null,
        policy: "quant"
      });
      const asset: QuantSkillAsset = {
        skillId,
        title: String(current.title || title),
        symbol: String(current.symbol || symbol),
        strategyId: String(current.strategyId || input.strategyId),
        ...(current.rules ? { rules: validateQuantStrategyRules(current.rules) } : rules ? { rules } : {}),
        schemaVersion: 1,
        managedBy: "newbrain.quant",
        simulationOnly: true,
        createdAt: String(current.createdAt || new Date().toISOString())
      };
      if (!(await this.directoryExists(join(target, "SKILL.md")))) {
        await this.writePackage(target, {
          skillId,
          title: asset.title,
          symbol: asset.symbol,
          strategyId: asset.strategyId,
          ...(asset.rules ? { rules: asset.rules } : {})
        }, asset);
      }
      return { created: false, relativePath };
    }

    await mkdir(this.skillsRoot, { recursive: true });
    const staging = join(this.skillsRoot, `.tmp-${skillId}-${randomUUID()}`);
    const asset: QuantSkillAsset = {
      ...normalized,
      schemaVersion: 1,
      managedBy: "newbrain.quant",
      simulationOnly: true,
      createdAt: new Date().toISOString()
    };
    try {
      await mkdir(staging, { recursive: true });
      await this.writePackage(staging, normalized, asset);
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
