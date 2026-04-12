import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MANAGED_MARKER = "managedBy: pi-superpowers-plus";
const SOURCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "agents");

function getUserAgentDir(): string {
  const homeDir = os.homedir();
  const legacyDir = path.join(homeDir, ".pi", "agent", "agents");
  const modernDir = path.join(homeDir, ".agents");
  // pi-subagents still discovers both user dirs, but the modern dir wins on name
  // collisions. We intentionally treat ".agents" as the authoritative location
  // whenever it exists instead of preserving legacy-only overrides.
  return fs.existsSync(modernDir) ? modernDir : legacyDir;
}

function shouldOverwrite(targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) return true;
  return fs.readFileSync(targetPath, "utf-8").includes(MANAGED_MARKER);
}

function syncManagedAgents(): void {
  const targetDir = getUserAgentDir();
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(SOURCE_DIR)) {
    if (!entry.startsWith("spx-") || !entry.endsWith(".md")) continue;

    const sourcePath = path.join(SOURCE_DIR, entry);
    const targetPath = path.join(targetDir, entry);
    if (!shouldOverwrite(targetPath)) continue;

    fs.copyFileSync(sourcePath, targetPath);
  }
}

export const __internal = {
  MANAGED_MARKER,
  SOURCE_DIR,
  getUserAgentDir,
  shouldOverwrite,
  syncManagedAgents,
};

export default function piSubagentsAgentSyncExtension(pi: ExtensionAPI): void {
  pi.on("session_start", () => {
    syncManagedAgents();
  });
}
