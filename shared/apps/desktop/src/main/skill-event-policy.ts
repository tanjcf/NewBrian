import type { LoadedModelSkill } from "./model-chat-skill-service.js";
import type { SkillDescriptor } from "./skill-selection.js";

export function buildSkillLoadedPayload(skill: SkillDescriptor | LoadedModelSkill) {
  return {
    name: skill.name,
    description: skill.description,
    ...("instructionPath" in skill && skill.instructionPath ? { instructionPath: skill.instructionPath } : {})
  };
}
