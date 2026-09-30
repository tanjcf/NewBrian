export interface TaskGraphNode {
  id: string;
  title: string;
  dependsOn: string[];
  status: "blocked" | "ready" | "running" | "completed" | "failed" | "cancelled";
  result: unknown;
  error: string;
}
export class TaskGraph {
  add(input: { id: string; title?: string; dependsOn?: string[] }): TaskGraphNode;
  mark(id: string, status: TaskGraphNode["status"], result?: unknown): TaskGraphNode;
  get(id: string): TaskGraphNode | null;
  list(): TaskGraphNode[];
}
