import type { BrainFlowRecord } from "./brain-workspace-storage.ts";

export interface FlowSchedule {
  id: string;
  ownerId: string;
  flowId: string;
  enabled: boolean;
  timezone: string;
  runAt: string;
}

export interface FlowScheduleStore {
  listEnabled(ownerId: string): FlowSchedule[];
  claim(scheduleId: string, occurrence: string): boolean | Promise<boolean>;
  fail(scheduleId: string, occurrence: string, errorCode: string): void | Promise<void>;
  complete(scheduleId: string, occurrence: string): void | Promise<void>;
}

function clock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export class FlowScheduler {
  constructor(private readonly options: {
    store: FlowScheduleStore;
    resolveOwnerId: () => Promise<string> | string;
    getFlow: (ownerId: string, flowId: string) => BrainFlowRecord;
    execute: (ownerId: string, flow: BrainFlowRecord, occurrence: string) => Promise<void>;
  }) {}

  async tick(now = new Date()): Promise<void> {
    const ownerId = (await this.options.resolveOwnerId()).trim();
    if (!ownerId) return;
    for (const schedule of this.options.store.listEnabled(ownerId)) {
      if (!schedule.enabled) continue;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(schedule.runAt)) {
        await this.options.store.fail(schedule.id, "invalid", "BRAIN_FLOW_SCHEDULE_TIME_INVALID");
        continue;
      }
      const local = clock(now, schedule.timezone);
      if (local.time < schedule.runAt) continue;
      const occurrence = `${schedule.id}:${local.date}`;
      if (!(await this.options.store.claim(schedule.id, occurrence))) continue;
      try { await this.options.execute(ownerId, this.options.getFlow(ownerId, schedule.flowId), occurrence); await this.options.store.complete(schedule.id, occurrence); }
      catch (error) { await this.options.store.fail(schedule.id, occurrence, error instanceof Error ? error.message : "BRAIN_FLOW_SCHEDULE_FAILED"); }
    }
  }
}
