import { diagnoseAgentReach, readCandidateBundle, scaffoldGameStudios } from "./garden-integration-service.ts";

export function registerGardenRuntimeTools(runtime: { registerExternalTool: (definition: any, handler: (input: any) => Promise<any>) => void }, input: {
  workspace: string; workspaceKey: string; resources: string; python: string;
  submitCandidate: (input: { skill_key: string; source: string; upstream_commit: string; files: Record<string, string> }) => Promise<unknown>;
  evaluateOpenSpace: (input: Record<string, unknown>) => Promise<unknown>;
}) {
  const register = (name: string, description: string, properties: Record<string, unknown>, required: string[], write: boolean,
    run: (args: any) => Promise<unknown>) => runtime.registerExternalTool({
      name, title: name, description, kind: write ? "write" : "read", risk: write ? "medium" : "low",
      requiresApproval: write, namespace: "garden", inputSchema: { type: "object", properties, required, additionalProperties: false }
    }, async args => {
      try { return { ok: true, output: JSON.stringify(await run(args)) }; }
      catch (error) { return { ok: false, output: error instanceof Error ? error.message : String(error) }; }
    });
  register("environment.reach.diagnose", "Run the installed Agent Reach Python doctor for local GitHub and web capability status. Does not install tools or upload cookies.", {}, [], false,
    () => diagnoseAgentReach(input.python, input.resources));
  if (input.workspaceKey === "explore") {
    register("skill.candidate.evaluate", "Run OpenSpace search and staged repair through Spring's isolated pilot. Static checks are NOT a behavioral pass. Save the returned candidate files under .brain/candidates, retain sources and evaluation.json, then submit separately for review.", {
      directory: { type: "string" }, query: { type: "string" }, fixContent: { type: "string" }, contract: { type: "object" }
    }, ["directory", "query"], true, async args => input.evaluateOpenSpace({
      files: await readCandidateBundle(input.workspace, args.directory), query: args.query,
      ...(args.fixContent ? { fix_content: args.fixContent } : {}), contract: args.contract || {}
    }));
    register("skill.candidate.submit", "Submit a generated Nuwa/OpenSpace skill directory under .brain/candidates for Spring human review. Required files: SKILL.md, sources.md, evaluation.json. Does not publish or overwrite installed skills.", {
      directory: { type: "string" }, skillKey: { type: "string", pattern: "^[a-z][a-z0-9-]{1,63}$" },
      source: { type: "string", enum: ["nuwa", "openspace"] }, upstreamCommit: { type: "string", pattern: "^[a-f0-9]{40}$" }
    }, ["directory", "skillKey", "source", "upstreamCommit"], true, async args => input.submitCandidate({
      skill_key: args.skillKey, source: args.source, upstream_commit: args.upstreamCommit,
      files: await readCandidateBundle(input.workspace, args.directory)
    }));
  }
  if (["game", "explore"].includes(input.workspaceKey)) {
    register("game.studios.scaffold", "Create missing Game Studios design, story and evidence templates in the current project. Existing files are preserved.", {}, [], true,
      () => scaffoldGameStudios(input.workspace));
  }
}
