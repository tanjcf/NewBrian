import { centralSkillDescriptors } from "./central-skills.js";
import { formatSkillDisclosure, type SkillDescriptor } from "./skill-selection.js";

export interface LoadedModelSkill extends SkillDescriptor {
  instructions: string;
  instructionPath: string;
  referenceContents?: Array<{ name: string; content: string }>;
}

export interface ModelChatSkillServiceDependencies {
  appendDiagnostics: (entry: string) => Promise<unknown>;
  appendDebugLog: (entry: string) => Promise<unknown>;
  publishActivity: (activity: { type: "run"; title: string; detail: string }, requestId: string) => void;
}

export interface LoadedModelChatSkills {
  loadedLocalSkills: LoadedModelSkill[];
  disclosedSkills: SkillDescriptor[];
  disclosure: string;
}

/** Loads local skills best-effort and publishes one canonical disclosure event. */
export class ModelChatSkillService {
  private readonly dependencies: ModelChatSkillServiceDependencies;

  constructor(dependencies: ModelChatSkillServiceDependencies) {
    this.dependencies = dependencies;
  }

  async load(input: {
    requestId: string;
    selectedLocalSkillNames: string[];
    centralSkillNames: string[];
    loadSkill: (name: string) => Promise<LoadedModelSkill>;
  }): Promise<LoadedModelChatSkills> {
    const loadedLocalSkills: LoadedModelSkill[] = [];
    for (const skillName of input.selectedLocalSkillNames) {
      try {
        loadedLocalSkills.push(await input.loadSkill(skillName));
      } catch (error) {
        await this.dependencies.appendDiagnostics(
          `skill load failed (${skillName}): ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    const disclosedSkills = [
      ...centralSkillDescriptors.filter((skill) => input.centralSkillNames.includes(skill.name)),
      ...loadedLocalSkills
    ];
    const disclosure = formatSkillDisclosure(disclosedSkills);
    if (disclosure) {
      this.dependencies.publishActivity({ type: "run", title: "本轮使用 Skill", detail: disclosure }, input.requestId);
      await this.dependencies.appendDebugLog(`skills injected request=${input.requestId} names=${disclosure}`);
    }
    return { loadedLocalSkills, disclosedSkills, disclosure };
  }
}
