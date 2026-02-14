import * as fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { log } from "./logging.js";

function isTestPath(p: string): boolean {
  return (
    /(^|\/)tests?(\/|$)/.test(p) ||
    p.endsWith(".test.ts") ||
    p.endsWith(".spec.ts") ||
    p.endsWith(".test.js") ||
    p.endsWith(".spec.js")
  );
}

function isTestCommand(cmd: string): boolean {
  return (
    /\bvitest\b/.test(cmd) ||
    /\bpytest\b/.test(cmd) ||
    /\bnpm\s+test\b/.test(cmd) ||
    /\bpnpm\s+test\b/.test(cmd) ||
    /\byarn\s+test\b/.test(cmd)
  );
}

export default function (pi: ExtensionAPI) {
  let hasRunTests = false;
  let consecutiveBlockedWrites = 0;
  const pendingTestCommands = new Set<string>();
  const violationsFile = process.env.PI_TDD_GUARD_VIOLATIONS_FILE;
  let violations = 0;

  function persist() {
    if (!violationsFile) return;
    try {
      fs.writeFileSync(violationsFile, String(violations), "utf-8");
    } catch (err) {
      log.debug(`Failed to persist TDD violations to ${violationsFile}: ${err instanceof Error ? err.message : err}`);
    }
  }

  pi.on("tool_call", async (event) => {
    if (event.toolName === "bash") {
      const command = (event.input as any)?.command as string | undefined;
      if (command && isTestCommand(command) && event.toolCallId) {
        pendingTestCommands.add(event.toolCallId);
      }
      return;
    }

    if (event.toolName === "write" || event.toolName === "edit") {
      const p = ((event.input as any)?.path as string | undefined) ?? "";
      if (!p) return;

      if (!hasRunTests && !isTestPath(p)) {
        violations += 1;
        consecutiveBlockedWrites += 1;
        persist();

        if (consecutiveBlockedWrites >= 3) {
          process.exit(1);
        }

        return { blocked: true };
      }

      consecutiveBlockedWrites = 0;
    }
  });

  pi.on("tool_result", async (event) => {
    if (event.toolName !== "bash") return;
    if (!event.toolCallId || !pendingTestCommands.has(event.toolCallId)) return;

    pendingTestCommands.delete(event.toolCallId);
    const exitCode = (event.details as any)?.exitCode;
    const passed = typeof exitCode === "number" ? exitCode === 0 : event.isError !== true;

    if (passed) {
      hasRunTests = true;
      consecutiveBlockedWrites = 0;
    }
  });
}
