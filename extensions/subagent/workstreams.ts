import { randomUUID } from "node:crypto";

export type WorkstreamMode = "auto" | "fresh" | "rotate";
export type ImplementerWorkstreamStatus = "active" | "completed" | "rotated" | "failed";

export interface ImplementerWorkstreamRecord {
  workstreamId: string;
  taskKey: string;
  status: ImplementerWorkstreamStatus;
  cwd: string;
  sessionId: string;
  sessionFile?: string;
  createdAt: string;
  lastUsedAt: string;
  turnCount: number;
  rotationReason?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class ImplementerWorkstreamRegistry {
  private records = new Map<string, ImplementerWorkstreamRecord>();

  acquire(input: {
    taskKey: string;
    cwd: string;
    mode: WorkstreamMode;
    rotationReason?: string;
  }): ImplementerWorkstreamRecord {
    const active = this.listActive();
    const existing = active.find((item) => item.taskKey === input.taskKey && item.cwd === input.cwd);

    if (input.mode === "auto" && existing) {
      return this.touch(existing.workstreamId);
    }

    for (const item of active) {
      if (item.cwd !== input.cwd) continue;
      if (item.taskKey !== input.taskKey) {
        this.complete(item.workstreamId);
        continue;
      }
      if (item.workstreamId !== existing?.workstreamId) {
        this.complete(item.workstreamId);
        continue;
      }
      if (input.mode === "rotate") {
        continue;
      }
      if (input.mode === "fresh") {
        this.complete(item.workstreamId);
      }
    }

    if (input.mode === "rotate" && existing) {
      this.rotate(existing.workstreamId, input.rotationReason ?? "rotate requested");
    }

    return this.create(input.taskKey, input.cwd);
  }

  create(taskKey: string, cwd: string): ImplementerWorkstreamRecord {
    const now = nowIso();
    const record: ImplementerWorkstreamRecord = {
      workstreamId: randomUUID(),
      taskKey,
      status: "active",
      cwd,
      sessionId: `implementer-${taskKey}-${Date.now()}`,
      createdAt: now,
      lastUsedAt: now,
      turnCount: 0,
    };
    this.records.set(record.workstreamId, record);
    return record;
  }

  touch(workstreamId: string): ImplementerWorkstreamRecord {
    const record = this.records.get(workstreamId);
    if (!record) throw new Error(`Unknown workstream: ${workstreamId}`);
    const updated: ImplementerWorkstreamRecord = {
      ...record,
      lastUsedAt: nowIso(),
      turnCount: record.turnCount + 1,
    };
    this.records.set(workstreamId, updated);
    return updated;
  }

  rotate(workstreamId: string, rotationReason: string): void {
    const record = this.records.get(workstreamId);
    if (!record) return;
    this.records.set(workstreamId, { ...record, status: "rotated", rotationReason });
  }

  complete(workstreamId: string): void {
    const record = this.records.get(workstreamId);
    if (!record) return;
    this.records.set(workstreamId, { ...record, status: "completed" });
  }

  fail(workstreamId: string, rotationReason?: string): void {
    const record = this.records.get(workstreamId);
    if (!record) return;
    this.records.set(workstreamId, { ...record, status: "failed", rotationReason });
  }

  setSessionFile(workstreamId: string, sessionFile: string | undefined): void {
    const record = this.records.get(workstreamId);
    if (!record) return;
    this.records.set(workstreamId, { ...record, sessionFile });
  }

  get(workstreamId: string): ImplementerWorkstreamRecord | undefined {
    return this.records.get(workstreamId);
  }

  list(): ImplementerWorkstreamRecord[] {
    return Array.from(this.records.values());
  }

  listActive(): ImplementerWorkstreamRecord[] {
    return this.list().filter((item) => item.status === "active");
  }

  replaceAll(records: ImplementerWorkstreamRecord[]): void {
    this.records = new Map(records.map((record) => [record.workstreamId, record]));
  }
}
