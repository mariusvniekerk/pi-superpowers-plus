import { log } from "./logging.js";
import { createDiagnosticPiProxy } from "./pi-subagents-index.ts";
import { runSync as patchedRunSync } from "./pi-subagents-run-sync.ts";
import { patchBuildPiArgsModule, patchExecutionModule } from "./pi-subagents-runtime-patches.js";

try {
  patchBuildPiArgsModule(await import("pi-subagents/src/runs/shared/pi-args.ts"));
  patchExecutionModule(await import("pi-subagents/src/runs/foreground/execution.ts"), patchedRunSync);
} catch (error) {
  log.error("Failed to apply pi-subagents runtime patches", error);
}

const { default: upstreamPiSubagentsExtension } = await import("pi-subagents/src/extension/index.ts");

export * from "./pi-subagents-index.ts";

export default function piSubagentsIndexExtension(pi) {
  upstreamPiSubagentsExtension(createDiagnosticPiProxy(pi));
}
