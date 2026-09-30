export function buildGovernmentResultOracle(goldText: string): {
  sourceKind: "result-oracle";
  characterCount: number;
  headings: string[];
  distinctivePhrases: string[];
  themePhrases: string[];
  requiredPhrases: string[];
  forbiddenCrossScene: string[];
  structuralHints: {
    hasAbstract: boolean;
    hasBackground: boolean;
    hasPractices: boolean;
    hasImplications: boolean;
    hasKnowledgeLink: boolean;
    hasDiscussion: boolean;
  };
};

export function scoreGovernmentResultAgainstOracle(candidateText: string, oracle: ReturnType<typeof buildGovernmentResultOracle>, options?: {
  forbiddenCrossScene?: string[];
  minCharacters?: number;
}): {
  pass: boolean;
  requiredHitRate: number;
  hitRequired: string[];
  missingRequired: string[];
  leakedForbidden: string[];
  structureHits: Record<string, boolean | null>;
  candidateCharacters: number;
  minCharacters: number;
};

export function assertGovernmentDeliveryMatchesOracle(input: {
  candidatePath: string;
  oraclePath: string;
  options?: {
    forbiddenCrossScene?: string[];
    minCharacters?: number;
  };
}): Promise<{
  oracle: ReturnType<typeof buildGovernmentResultOracle>;
  scored: ReturnType<typeof scoreGovernmentResultAgainstOracle>;
  candidatePath: string;
  oraclePath: string;
}>;
