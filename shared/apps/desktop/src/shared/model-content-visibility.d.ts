export function containsPrivatePlanningNarration(content: string): boolean;
export function extractPrivatePlanningNarration(content: string): string;
export function hasUserVisibleAssistantContent(content: string): boolean;
export function sanitizeVisibleModelContent(content: string): string;
export class ModelStreamVisibilityGate {
  push(delta: string): { delta?: string; suppressed?: boolean };
  finish(hasToolCalls: boolean): { delta?: string; reset?: boolean; suppressed?: boolean };
}
