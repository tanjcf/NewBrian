import {
  centralSkillDescriptors,
  GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED,
  GOVERNMENT_RESEARCH_WRITING_SKILL_NAME,
  isGovernmentResearchWritingProductEnabled,
  isGovernmentResearchWritingSkill
} from "./central-skills.ts";
import { shouldAutomaticallyUseGovernmentWriting } from "./government-skill-routing.js";
import { shouldUseGoalRuntimeForSkills } from "./skill-goal-runtime.ts";
import {
  selectAutomaticSkillNames,
  shouldRunAutomaticSkillSelection,
  validateComposerModes,
  validateExplicitSkillNames,
  type ComposerMode,
  type SkillDescriptor
} from "./skill-selection.ts";
import { classifyAutoTaskClass } from "./model-auto-router.ts";

/** Simple chat (incl. greetings): no automatic skill injection in BRAIN. */
export function isSimpleChatSkillExempt(latestUserRequest?: string): boolean {
  const text = String(latestUserRequest || "").trim();
  if (!text) return false;
  return classifyAutoTaskClass({ text }) === "chat";
}

export interface ModelChatSkillSelectionInput {
  requestedSkillNames?: string[];
  persistedSkillNames?: string[];
  composerModes?: ComposerMode[];
  localSkillDescriptors: SkillDescriptor[];
  heuristicSkills: SkillDescriptor[];
  hasActiveGoal: boolean;
  /**
   * Settings → personalization.autoSkillEnabled.
   * Default false: specialty skills require this turn's composer selection.
   * When true: restore prior auto-awaken via durable goal persistence, keyword
   * heuristics, and automatic skill matching.
   */
  autoSkillEnabled?: boolean;
  /** Latest user text — used only when autoSkillEnabled for keyword advisory routing. */
  latestUserRequest?: string;
}

export interface ModelChatSkillSelection {
  explicitSkillNames: string[];
  composerModes: ComposerMode[];
  centralSkillNames: string[];
  selectedLocalSkillNames: string[];
  governmentSkillEnabled: boolean;
  goalRuntimeRequested: boolean;
  goalRuntimeEnabled: boolean;
}

/**
 * Specialty central skills that wake only from composer selection unless auto-skill is ON.
 * Always includes government-research-writing so offline product still clears it from
 * durable goals and never treats it as an ordinary local skill.
 */
export const SPECIALTY_COMPOSER_SKILL_NAMES = new Set([
  ...centralSkillDescriptors.map((skill) => skill.name),
  GOVERNMENT_RESEARCH_WRITING_SKILL_NAME
]);

export function isSpecialtyComposerSkill(name: string): boolean {
  return SPECIALTY_COMPOSER_SKILL_NAMES.has(name);
}

export function isProjectManagerSkill(name: string): boolean {
  return String(name || "").toLowerCase().endsWith("-project-manager");
}

const COMPANION_MEMORY_SKILL_NAME = "companion-memory";

export function withAlwaysOnCompanionMemory(
  selectedLocalSkillNames: string[],
  localSkillDescriptors: SkillDescriptor[]
): string[] {
  const present = localSkillDescriptors.some((skill) => skill.name === COMPANION_MEMORY_SKILL_NAME);
  if (!present) return selectedLocalSkillNames.slice(0, 5);
  return [
    COMPANION_MEMORY_SKILL_NAME,
    ...selectedLocalSkillNames.filter((name) => name !== COMPANION_MEMORY_SKILL_NAME)
  ].slice(0, 5);
}

/** Always keep at most one project-manager shadow skill in the local skill set. */
export function withAlwaysOnProjectManagerShadow(
  selectedLocalSkillNames: string[],
  localSkillDescriptors: SkillDescriptor[]
): string[] {
  const projectManagers = localSkillDescriptors
    .map((skill) => skill.name)
    .filter((name) => isProjectManagerSkill(name));
  if (!projectManagers.length) {
    return selectedLocalSkillNames.slice(0, 4);
  }
  const primary = projectManagers[0];
  const others = selectedLocalSkillNames.filter((name) => !isProjectManagerSkill(name));
  return [...new Set([primary, ...others])].slice(0, 4);
}

/** Drops product-offline skills from name lists without throwing (old UI / persisted goals). */
function withoutProductOfflineSkills(names: string[] | undefined): string[] | undefined {
  if (names == null) return names;
  if (isGovernmentResearchWritingProductEnabled()) return names;
  return names.filter((name) => !isGovernmentResearchWritingSkill(name));
}

/** Excludes product-offline skills from skill catalogs used for validation and auto-match. */
function withoutProductOfflineDescriptors(skills: SkillDescriptor[]): SkillDescriptor[] {
  if (isGovernmentResearchWritingProductEnabled()) return skills;
  return skills.filter((skill) => !isGovernmentResearchWritingSkill(skill.name));
}

/** Resolves explicit, persisted, central, and automatic skills without runtime side effects. */
export function selectModelChatSkills(input: ModelChatSkillSelectionInput): ModelChatSkillSelection {
  const autoSkillEnabled = input.autoSkillEnabled === true;
  const localSkillDescriptors = withoutProductOfflineDescriptors(input.localSkillDescriptors);
  const heuristicSkills = withoutProductOfflineDescriptors(input.heuristicSkills);
  const descriptors = [...localSkillDescriptors, ...centralSkillDescriptors];
  const requested = validateExplicitSkillNames(
    withoutProductOfflineSkills(input.requestedSkillNames),
    descriptors
  );
  const persisted = validateExplicitSkillNames(
    withoutProductOfflineSkills(input.persistedSkillNames),
    descriptors
  );
  // OFF (default): specialty skills must come from this turn's composer selection only.
  // ON: specialty may also revive from durable goal persistence (prior auto-skill behavior).
  const persistedForMerge = autoSkillEnabled
    ? persisted
    : persisted.filter((name) => !isSpecialtyComposerSkill(name));
  let explicitSkillNames = [...new Set([...requested, ...persistedForMerge])].slice(0, 4);
  const composerModes = validateComposerModes(input.composerModes);
  let centralSkillNames = explicitSkillNames.filter((name) =>
    centralSkillDescriptors.some((skill) => skill.name === name)
  );

  // When auto-skill is ON and the product skill is online, keyword advisory routing may
  // awaken government writing without an explicit composer pick.
  if (
    GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED
    && autoSkillEnabled
    && !centralSkillNames.includes(GOVERNMENT_RESEARCH_WRITING_SKILL_NAME)
    && shouldAutomaticallyUseGovernmentWriting(input.latestUserRequest ?? "")
  ) {
    explicitSkillNames = [...new Set([...explicitSkillNames, GOVERNMENT_RESEARCH_WRITING_SKILL_NAME])].slice(0, 4);
    centralSkillNames = [...new Set([...centralSkillNames, GOVERNMENT_RESEARCH_WRITING_SKILL_NAME])];
  }

  const explicitLocalSkillNames = explicitSkillNames.filter((name) => !centralSkillNames.includes(name));
  let automaticSkillNames = shouldRunAutomaticSkillSelection(centralSkillNames)
    ? selectAutomaticSkillNames(heuristicSkills)
    : [];

  if (autoSkillEnabled) {
    // Promote specialty matches from the local skill catalog into central enablement
    // so auto-awaken uses the same government runtime path as an explicit pick.
    const autoSpecialty = automaticSkillNames.filter((name) => isSpecialtyComposerSkill(name));
    if (autoSpecialty.length) {
      explicitSkillNames = [...new Set([...explicitSkillNames, ...autoSpecialty])].slice(0, 4);
      centralSkillNames = [...new Set([
        ...centralSkillNames,
        ...autoSpecialty.filter((name) =>
          centralSkillDescriptors.some((skill) => skill.name === name)
        )
      ])];
      automaticSkillNames = automaticSkillNames.filter((name) => !isSpecialtyComposerSkill(name));
    }
  } else {
    // OFF (default): never auto-inject specialty via heuristics.
    // Non-specialty project/global skills may still auto-wake from matchSkills
    // so workspace skills are not permanently dead until the user finds Settings.
    automaticSkillNames = automaticSkillNames.filter((name) => !isSpecialtyComposerSkill(name));
  }

  // Simple chat (greetings + short casual turns): no automatic skill wrapping.
  // Specialty / project skills only when the user picked them or the task is not chat.
  if (isSimpleChatSkillExempt(input.latestUserRequest)) {
    automaticSkillNames = [];
  }

  const goalRuntimeRequested = composerModes.includes("goal") || shouldUseGoalRuntimeForSkills(explicitSkillNames);
  const localNames = [...new Set([...explicitLocalSkillNames, ...automaticSkillNames])];
  const selectedLocalSkillNames = withAlwaysOnCompanionMemory(
    isSimpleChatSkillExempt(input.latestUserRequest) && !explicitLocalSkillNames.length
      ? []
      : withAlwaysOnProjectManagerShadow(localNames, localSkillDescriptors),
    localSkillDescriptors
  );
  return {
    explicitSkillNames,
    composerModes,
    centralSkillNames,
    selectedLocalSkillNames,
    governmentSkillEnabled: isGovernmentResearchWritingProductEnabled()
      && centralSkillNames.some((name) => isGovernmentResearchWritingSkill(name)),
    goalRuntimeRequested,
    goalRuntimeEnabled: goalRuntimeRequested || input.hasActiveGoal
  };
}
