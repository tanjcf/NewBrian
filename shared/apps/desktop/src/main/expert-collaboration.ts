import { createHash } from "node:crypto";

export type ExpertPreference = { scope: string; scene: string; expertId: string; mode: "auto" | "ask" | "off" };
export type ExpertChoice = { expertId: string; reason: string; responsibility: string };
type Question = { questionId: string; prompt: string; status?: string; answer?: string; options: Array<{ label: string; description: string; recommended?: boolean }> };
export const EXPERT_ACCEPT = "采用推荐";
export const EXPERT_SKIP = "直接继续，不使用专家";
export function expertQuestionId(ids: string[], detail = "") { return `expert-plan:${[...new Set(ids)].sort().join("+")}:${createHash("sha256").update(detail).digest("hex").slice(0, 16)}`; }
export function expertProjectScope(path: string) { return createHash("sha256").update(path.replace(/\\/g, "/").replace(/\/$/, "")).digest("hex"); }
export function effectiveExpertPreference(items: ExpertPreference[], scope: string, scene: string, expertId: string) {
  return items.find(p => p.scope === scope && p.scene === scene && p.expertId === expertId)
    ?? items.find(p => p.scope === "global" && p.scene === scene && p.expertId === expertId);
}

/** A persisted UI answer authorizes only the experts in that goal, never arbitrary model text. */
export class ExpertCollaboration {
  private readonly deps: {
    goal: () => { goalId: string; status: string } | null;
    createGoal: (objective: string) => { goalId: string; status: string };
    questions: (goalId: string) => Question[];
    ask: (goalId: string, question: Question) => void;
    catalog: () => Promise<Array<{ id: string; displayName: string; enabled: boolean; installed: boolean }>>;
    preferences: () => Promise<ExpertPreference[]>;
    savePreference: (preference: ExpertPreference) => Promise<unknown>;
    applied: (goalId: string, questionId: string) => void;
    scope: string; scene: string;
  };
  constructor(deps: ExpertCollaboration["deps"]) { this.deps = deps; }

  async propose(objective: string, choices: ExpertChoice[]) {
    if (typeof objective !== "string" || !objective.trim() || objective.length > 2000 || !Array.isArray(choices) || choices.length < 1 || choices.length > 3
      || choices.some(c => !c || typeof c.expertId !== "string" || typeof c.reason !== "string" || typeof c.responsibility !== "string")
      || new Set(choices.map(c => c.expertId)).size !== choices.length
      || choices.some(c => !/^[a-z0-9-]{1,64}$/.test(c.expertId) || !c.reason?.trim() || !c.responsibility?.trim()
        || c.reason.length > 500 || c.responsibility.length > 500)) throw new Error("EXPERT_PROPOSAL_INVALID");
    const catalog = await this.deps.catalog();
    for (const choice of choices) {
      if (!catalog.some(e => e.id === choice.expertId && (!e.installed || e.enabled))) throw new Error("EXPERT_UNAVAILABLE");
    }
    let goal = this.deps.goal();
    if (!goal || goal.status !== "active") goal = this.deps.createGoal(objective);
    const existing = this.deps.questions(goal.goalId).filter(q => q.questionId.startsWith("expert-plan:"));
    if (existing.some(q => q.status === "answered" && q.answer === EXPERT_SKIP)) return { status: "declined", instruction: "Continue without experts. Do not repeat the recommendation for this task." };
    const preferences = await this.deps.preferences();
    if (choices.some(c => effectiveExpertPreference(preferences, this.deps.scope, this.deps.scene, c.expertId)?.mode === "off"))
      return { status: "excluded_by_preference", instruction: "Choose another expert or continue without experts. Only change this preference if the user explicitly requests it." };
    if (choices.every(c => catalog.find(e => e.id === c.expertId)?.installed
      && effectiveExpertPreference(preferences, this.deps.scope, this.deps.scene, c.expertId)?.mode === "auto"))
      return { status: "accepted_by_preference", choices };
    const questionId = expertQuestionId(choices.map(c => c.expertId), JSON.stringify(choices));
    const previous = existing.find(q => q.questionId === questionId);
    if (previous) return { status: previous.status === "pending" ? "waiting_user" : previous.answer === EXPERT_ACCEPT ? "accepted" : "adjustment_requested", question: previous };
    const pending = this.deps.questions(goal.goalId).find(q => q.status === "pending");
    if (pending) return { status: "waiting_user", question: pending };
    const question = { questionId, prompt: `建议的专家分工\n${choices.map(c => {
      const expert = catalog.find(e => e.id === c.expertId)!;
      return `${expert.displayName}：${c.responsibility}\n推荐理由：${c.reason}${expert.installed ? "" : "\n采用后将安装内置专家包。"}`;
    }).join("\n\n")}`, options: [
      { label: EXPERT_ACCEPT, description: "仅同意本次任务的专家分工，不保存长期偏好。", recommended: true },
      { label: "调整分工", description: "补充要求后重新推荐，确认前不调用专家。" },
      { label: EXPERT_SKIP, description: "由基础助手继续完成任务。" }
    ] };
    this.deps.ask(goal.goalId, question);
    return { status: "waiting_user", question, instruction: "Stop expert execution and wait for the user's decision." };
  }

  async authorize(expertId: string) {
    const expert = (await this.deps.catalog()).find(e => e.id === expertId);
    if (!expert || (expert.installed && !expert.enabled)) throw new Error("EXPERT_UNAVAILABLE");
    const goal = this.deps.goal();
    const questions = goal?.status === "active" ? this.deps.questions(goal.goalId) : [];
    if (questions.some(q => q.questionId.startsWith("expert-plan:") && q.answer === EXPERT_SKIP)) throw new Error("EXPERT_DECLINED_FOR_TASK");
    const latestPlan = questions.find(q => q.questionId.startsWith("expert-plan:"));
    if (latestPlan) {
      if (latestPlan.status === "answered" && latestPlan.answer === EXPERT_ACCEPT
        && latestPlan.questionId.split(":")[1].split("+").includes(expertId)) return;
      throw new Error("EXPERT_CONFIRMATION_REQUIRED");
    }
    const preference = effectiveExpertPreference(await this.deps.preferences(), this.deps.scope, this.deps.scene, expertId);
    if (preference?.mode === "auto" && expert.installed) return;
    throw new Error("EXPERT_CONFIRMATION_REQUIRED: call expert.propose with task-specific reasons and responsibilities; wait for the user.");
  }

  async preference(expertId: string, mode: "auto" | "ask" | "off") {
    if (!["auto", "ask", "off"].includes(mode)) throw new Error("EXPERT_PREFERENCE_INVALID");
    const expert = (await this.deps.catalog()).find(e => e.id === expertId);
    if (!expert) throw new Error("EXPERT_UNAVAILABLE");
    const goal = this.deps.goal();
    if (!goal) throw new Error("EXPERT_TASK_REQUIRED");
    const prefix = `expert-preference:${expertId}:${mode}:`;
    const previous = this.deps.questions(goal.goalId).find(q => q.questionId.startsWith(prefix) && q.status !== "applied");
    const questionId = previous?.questionId ?? `${prefix}${Date.now()}`;
    if (previous?.status === "answered") {
      const scope = previous.answer === "仅本项目" ? this.deps.scope : previous.answer === "所有项目" ? "global" : null;
      if (!scope) { this.deps.applied(goal.goalId, questionId); return { status: "not_saved" }; }
      await this.deps.savePreference({ scope, scene: this.deps.scene, expertId, mode });
      this.deps.applied(goal.goalId, questionId);
      return { status: "saved", scope, scene: this.deps.scene, expertId, mode };
    }
    if (this.deps.questions(goal.goalId).some(q => q.status === "pending")) return { status: "waiting_user" };
    this.deps.ask(goal.goalId, { questionId, prompt: `是否保存「${expert.displayName}」的协作偏好：${{ auto: "适合当前任务时自动参与", ask: "每次先询问", off: "不自动参与" }[mode]}？仅在当前场景生效。`, options: [
      { label: "仅本项目", description: "项目规则优先于全局偏好。" },
      { label: "所有项目", description: "作为此场景的全局默认，可被项目规则覆盖。" },
      { label: "不保存", description: "不修改长期偏好。", recommended: true }
    ] });
    return { status: "waiting_user" };
  }
}
