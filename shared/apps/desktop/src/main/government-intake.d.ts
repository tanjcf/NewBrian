export declare const GOVERNMENT_INTAKE_QUESTION_ID: "requirement-clarification";

export declare function analyzeGovernmentMissingInformation(input: {
  userRequest: string;
  hasAttachments: boolean;
}): string[];

export declare function buildGovernmentIntakeQuestion(missing: string[]): {
  questionId: string;
  prompt: string;
  options: Array<{ label: string; description: string; recommended: boolean }>;
};

export declare function buildGovernmentIntakeNotice(missing: string[]): string;

export declare function extractMissingInformationFromPlan(
  plan: Array<{ stepId: string; result?: string }>
): string[];

export declare function applyGovernmentIntakeToPlan<T extends { stepId: string }>(
  plan: T[],
  missing: string[]
): T[];

export declare function completeGovernmentIntakeInPlan<T extends { stepId: string }>(
  plan: T[],
  answer: string
): T[];
