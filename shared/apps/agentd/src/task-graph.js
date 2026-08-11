export class TaskGraph {
  constructor() {
    this.nodes = new Map();
  }

  add(input) {
    const id = String(input?.id || "").trim();
    if (!id) throw new Error("Task graph nodes require an id.");
    if (this.nodes.has(id)) throw new Error(`Task graph node already exists: ${id}`);
    const dependsOn = [...new Set((Array.isArray(input.dependsOn) ? input.dependsOn : [])
      .map((value) => String(value).trim()).filter(Boolean))];
    if (dependsOn.includes(id)) throw new Error("A task cannot depend on itself.");
    const missing = dependsOn.find((dependency) => !this.nodes.has(dependency));
    if (missing) throw new Error(`Unknown task dependency: ${missing}`);
    const dependencyNodes = dependsOn.map((dependency) => this.nodes.get(dependency));
    const initialStatus = dependencyNodes.some((dependency) => dependency.status === "failed" || dependency.status === "cancelled")
      ? "cancelled"
      : dependencyNodes.every((dependency) => dependency.status === "completed")
        ? "ready"
        : dependsOn.length > 0 ? "blocked" : "ready";
    const node = {
      id,
      title: String(input.title || id),
      dependsOn,
      status: initialStatus,
      result: null,
      error: ""
    };
    this.nodes.set(id, node);
    return structuredClone(node);
  }

  mark(id, status, result = null) {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown task graph node: ${id}`);
    node.status = status;
    node.result = result;
    for (const candidate of this.nodes.values()) {
      if (candidate.status !== "blocked") continue;
      const dependencies = candidate.dependsOn.map((dependency) => this.nodes.get(dependency));
      if (dependencies.some((dependency) => dependency?.status === "failed" || dependency?.status === "cancelled")) {
        candidate.status = "cancelled";
        candidate.error = "A required dependency did not complete successfully.";
      } else if (dependencies.every((dependency) => dependency?.status === "completed")) {
        candidate.status = "ready";
      }
    }
    return structuredClone(node);
  }

  get(id) {
    const node = this.nodes.get(id);
    return node ? structuredClone(node) : null;
  }

  list() {
    return [...this.nodes.values()].map((node) => structuredClone(node));
  }
}
