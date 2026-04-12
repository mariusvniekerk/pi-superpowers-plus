declare module "~/threads/thread-manager" {
  import type { LaceEvent } from "~/threads/types";

  export interface ThreadManager {
    getEvents(threadId: string): LaceEvent[];
  }
}

declare module "~/threads/types" {
  export type LaceEventType = string;

  export interface LaceEvent {
    type: LaceEventType;
  }
}
