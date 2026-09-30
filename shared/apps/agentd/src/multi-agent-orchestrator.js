function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export class MultiAgentOrchestrator {
  constructor(input = {}) {
    this.maxConcurrency = Math.max(1, input.maxConcurrency ?? 3);
    this.onEvent = input.onEvent ?? (() => undefined);
    this.tasks = new Map();
    this.running = 0;
    this.capacityWaiters = [];
  }

  delegate(input) {
    if (!input.parentThreadId || !input.childThreadId || !String(input.instruction || "").trim()) {
      throw new Error("Delegated tasks require parent/child thread IDs and an instruction.");
    }
    const task = {
      id: input.id || makeId("delegated-task"),
      parentThreadId: input.parentThreadId,
      childThreadId: input.childThreadId,
      title: String(input.title || "Delegated task"),
      instruction: String(input.instruction).trim(),
      owner: input.owner || "researcher",
      dependsOn: [...new Set((input.dependsOn ?? []).map(String).filter(Boolean))],
      status: "queued",
      summary: "",
      result: null,
      error: "",
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null
    };
    if (this.tasks.has(task.id)) throw new Error(`Delegated task already exists: ${task.id}`);
    this.tasks.set(task.id, task);
    this.emit("agent_task_queued", task);
    return structuredClone(task);
  }

  restore(input) {
    if (!input?.id || !input.parentThreadId || !input.childThreadId) {
      throw new Error("Restored tasks require an ID and parent/child thread IDs.");
    }
    const task = {
      ...structuredClone(input),
      status: input.status === "running" ? "failed" : input.status,
      summary: input.summary ?? "",
      result: input.result ?? null,
      error: input.status === "running"
        ? "Task execution was interrupted; retry must be explicitly requested to avoid repeating side effects."
        : input.error ?? "",
      dependsOn: [...new Set((input.dependsOn ?? []).map(String).filter(Boolean))]
    };
    this.tasks.set(task.id, task);
    this.emit("agent_task_restored", task);
    return structuredClone(task);
  }

  get(id) {
    const task = this.tasks.get(id);
    return task ? structuredClone(task) : null;
  }

  list(parentThreadId) {
    return [...this.tasks.values()]
      .filter((task) => !parentThreadId || task.parentThreadId === parentThreadId)
      .map((task) => structuredClone(task));
  }

  async run(id, runner) {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Unknown delegated task: ${id}`);
    if (task.status !== "queued") throw new Error(`Delegated task ${id} is ${task.status}.`);
    const dependencies = task.dependsOn.map((dependency) => this.tasks.get(dependency));
    if (dependencies.some((dependency) => !dependency)) {
      return this.fail(id, "A required dependency is unknown.");
    }
    if (dependencies.some((dependency) => dependency.status === "failed")) {
      return this.fail(id, "A required dependency did not complete successfully.");
    }
    if (dependencies.some((dependency) => dependency.status !== "completed")) {
      throw new Error(`Delegated task ${id} is waiting for dependencies.`);
    }
    if (this.running >= this.maxConcurrency) {
      await new Promise((resolve) => this.capacityWaiters.push(resolve));
    }
    this.running += 1;
    task.status = "running";
    task.startedAt = new Date().toISOString();
    this.emit("agent_task_started", task);
    try {
      const result = await runner(structuredClone(task));
      task.result = result ?? null;
      task.summary = String(result?.summary ?? result?.content ?? "").trim();
      task.status = "completed";
      task.completedAt = new Date().toISOString();
      this.emit("agent_task_completed", task);
      return structuredClone(task);
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      task.completedAt = new Date().toISOString();
      this.emit("agent_task_failed", task);
      return structuredClone(task);
    } finally {
      this.running -= 1;
      this.capacityWaiters.shift()?.();
    }
  }

  async runAll(parentThreadId, runner) {
    const queued = [...this.tasks.values()].filter((task) =>
      task.status === "queued" && (!parentThreadId || task.parentThreadId === parentThreadId));
    const queuedIds = new Set(queued.map((task) => task.id));
    while ([...queuedIds].some((id) => this.tasks.get(id)?.status === "queued")) {
      const pending = [...queuedIds].map((id) => this.tasks.get(id)).filter((task) => task?.status === "queued");
      for (const task of pending) {
        const dependencies = task.dependsOn.map((dependency) => this.tasks.get(dependency));
        if (dependencies.some((dependency) => !dependency || dependency.status === "failed")) {
          this.fail(task.id, "A required dependency did not complete successfully.");
        }
      }
      const ready = pending.filter((task) => task.status === "queued" && task.dependsOn.every((dependency) =>
        this.tasks.get(dependency)?.status === "completed"));
      if (ready.length === 0) {
        for (const task of pending.filter((candidate) => candidate.status === "queued")) {
          this.fail(task.id, "Dependencies could not be resolved.");
        }
        break;
      }
      await Promise.all(ready.map((task) => this.run(task.id, runner)));
    }
    return queued.map((task) => structuredClone(this.tasks.get(task.id)));
  }

  fail(id, reason) {
    let task = this.tasks.get(id);
    if (!task) {
      task = [...this.tasks.values()].find((candidate) => candidate.childThreadId === id);
    }
    if (!task) throw new Error(`Unknown delegated task: ${id}`);
    const status = String(task.status || "").toLowerCase();
    if (status === "completed" || status === "failed" || status === "cancelled" || status === "canceled") {
      return structuredClone(task);
    }
    task.status = "failed";
    task.error = String(reason || "Delegated task failed before it started.");
    task.completedAt = new Date().toISOString();
    this.emit("agent_task_failed", task);
    return structuredClone(task);
  }

  async merge(parentThreadId, taskIds, merger) {
    const tasks = taskIds.map((id) => this.tasks.get(id));
    if (tasks.some((task) => !task)) throw new Error("Cannot merge an unknown delegated task.");
    if (tasks.some((task) => task.parentThreadId !== parentThreadId)) {
      throw new Error("All merged tasks must belong to the same parent thread.");
    }
    if (tasks.some((task) => task.status !== "completed")) {
      throw new Error("Only completed delegated tasks can be merged.");
    }
    const result = await merger(tasks.map((task) => structuredClone(task)));
    this.emit("agent_results_merged", { parentThreadId, taskIds, result });
    return result;
  }

  emit(type, payload) {
    this.onEvent({ type, timestamp: new Date().toISOString(), payload: structuredClone(payload) });
  }
}
