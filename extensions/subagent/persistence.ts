import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { type ImplementerWorkstreamRecord, ImplementerWorkstreamRegistry } from "./workstreams.js";

export const WORKSTREAM_ENTRY_TYPE = "subagent_workstreams";

export interface PersistedImplementerState {
  activeWorkstreams: ImplementerWorkstreamRecord[];
}

export function snapshotWorkstreams(registry: ImplementerWorkstreamRegistry): PersistedImplementerState {
  return {
    activeWorkstreams: registry.listActive(),
  };
}

export function persistWorkstreams(
  appendEntry: (customType: string, data: unknown) => void,
  registry: ImplementerWorkstreamRegistry,
): void {
  appendEntry(WORKSTREAM_ENTRY_TYPE, snapshotWorkstreams(registry));
}

export function restoreWorkstreamsFromBranch(entries: SessionEntry[]): ImplementerWorkstreamRegistry {
  const registry = new ImplementerWorkstreamRegistry();

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== WORKSTREAM_ENTRY_TYPE) continue;
    const data = entry.data as PersistedImplementerState | undefined;
    registry.replaceAll(data?.activeWorkstreams ?? []);
    break;
  }

  return registry;
}
