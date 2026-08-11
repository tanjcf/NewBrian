/** Keyword heuristic only — does not enable government-research-writing unless Settings autoSkillEnabled is ON. */
export function shouldAutomaticallyUseGovernmentWriting(requestText: string): boolean;
export function isGovernmentRevisionPreviewRequest(requestText: string): boolean;
export function isGovernmentConfirmedRevisionDeliveryRequest(requestText: string): boolean;
