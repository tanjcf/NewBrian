/**
 * Desktop entry for scene project init: seeds scene knowledge + project-init skill.
 * Re-exports agentd seed so create/open project can initialize without waiting for chat.
 */
export {
  ensureSceneProjectInit,
  PROJECT_INIT_SKILL_NAME,
  SCENE_TOOLS_TEMPLATE_MARKER,
  SCENE_KNOWLEDGE_FILENAME,
  SCENE_TOOLS_ROUTING_FILENAME,
  normalizeSceneKey,
  SCENE_KNOWLEDGE_MARKDOWN,
  SCENE_TITLES
} from "../../../agentd/src/scene-knowledge-seed.js";
export { UserShadow } from "../../../agentd/src/user-shadow.js";

import { ensureSceneProjectInit as ensureInit, normalizeSceneKey } from "../../../agentd/src/scene-knowledge-seed.js";
import { UserShadow } from "../../../agentd/src/user-shadow.js";

/** Initialize project-manager + project-init skill with scene knowledge for a workspace folder. */
export async function initializeSceneProjectSkills(input: {
  workspacePath: string;
  projectName?: string;
  brainWorkspaceKey?: string;
}) {
  const brainWorkspaceKey = normalizeSceneKey(input.brainWorkspaceKey);
  const shadow = new UserShadow({
    workspacePath: input.workspacePath,
    projectName: input.projectName,
    brainWorkspaceKey
  });
  const projectSkill = await shadow.ensureProjectSkill();
  const sceneInit = await ensureInit({
    workspacePath: input.workspacePath,
    projectName: input.projectName || projectSkill.skillName.replace(/-project-manager$/, ""),
    brainWorkspaceKey
  });
  return { projectSkill, sceneInit, brainWorkspaceKey };
}
