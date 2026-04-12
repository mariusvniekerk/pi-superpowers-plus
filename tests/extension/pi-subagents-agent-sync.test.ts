import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { __internal } from "../../extensions/pi-subagents-agent-sync";

let tempHome: string;
let previousAgentDir: string | undefined;

function legacyAgentPath(name: string): string {
  return path.join(tempHome, ".pi", "agent", "agents", name);
}

function modernAgentPath(name: string): string {
  return path.join(tempHome, ".agents", name);
}

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-agent-sync-"));
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  vi.stubEnv("HOME", tempHome);
});

afterEach(() => {
  vi.unstubAllEnvs();

  if (previousAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }

  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe("pi-subagents managed agent sync", () => {
  test("copies managed spx agents into the legacy user agent directory when no modern directory exists", () => {
    __internal.syncManagedAgents();

    const implementer = fs.readFileSync(legacyAgentPath("spx-implementer.md"), "utf-8");
    const worker = fs.readFileSync(legacyAgentPath("spx-worker.md"), "utf-8");

    expect(implementer).toContain("managedBy: pi-superpowers-plus");
    expect(implementer).toContain("You are an implementation subagent.");
    expect(implementer).toContain("Use the statuses `DONE`, `DONE_WITH_CONCERNS`, `BLOCKED`, or `NEEDS_CONTEXT`");
    expect(worker).toContain("name: spx-worker");
    expect(fs.existsSync(modernAgentPath("spx-worker.md"))).toBe(false);
  });

  test("prefers the modern user agent directory when it already exists", () => {
    fs.mkdirSync(path.dirname(modernAgentPath("spx-implementer.md")), { recursive: true });

    __internal.syncManagedAgents();

    expect(fs.existsSync(modernAgentPath("spx-implementer.md"))).toBe(true);
    expect(fs.existsSync(legacyAgentPath("spx-implementer.md"))).toBe(false);
  });

  test("overwrites managed spx agent files but preserves unmanaged files in discovered directories", () => {
    fs.mkdirSync(path.dirname(legacyAgentPath("spx-implementer.md")), { recursive: true });
    fs.writeFileSync(
      legacyAgentPath("spx-implementer.md"),
      "---\nmanagedBy: pi-superpowers-plus\nname: spx-implementer\n---\nold",
      "utf-8",
    );
    fs.writeFileSync(legacyAgentPath("spx-worker.md"), "---\nname: spx-worker\n---\ncustom", "utf-8");

    __internal.syncManagedAgents();

    expect(fs.readFileSync(legacyAgentPath("spx-implementer.md"), "utf-8")).toContain("implementation subagent");
    expect(fs.readFileSync(legacyAgentPath("spx-worker.md"), "utf-8")).toContain("custom");
  });

  test("shouldOverwrite only replaces managed files", () => {
    fs.mkdirSync(path.dirname(legacyAgentPath("spx-code-reviewer.md")), { recursive: true });
    const managedFile = legacyAgentPath("spx-code-reviewer.md");
    const unmanagedFile = legacyAgentPath("spx-doc-reviewer.md");

    fs.writeFileSync(managedFile, "---\nmanagedBy: pi-superpowers-plus\n---\nmanaged", "utf-8");
    fs.mkdirSync(path.dirname(unmanagedFile), { recursive: true });
    fs.writeFileSync(unmanagedFile, "---\nname: spx-doc-reviewer\n---\nunmanaged", "utf-8");

    expect(__internal.shouldOverwrite(managedFile)).toBe(true);
    expect(__internal.shouldOverwrite(unmanagedFile)).toBe(false);
    expect(__internal.shouldOverwrite(modernAgentPath("spx-test-runner.md"))).toBe(true);
  });

  test("ignores PI_CODING_AGENT_DIR and still syncs to the effective pi-subagents home directory", () => {
    process.env.PI_CODING_AGENT_DIR = "~/custom-agent-root";

    __internal.syncManagedAgents();

    expect(fs.existsSync(legacyAgentPath("spx-implementer.md"))).toBe(true);
    expect(fs.existsSync(modernAgentPath("spx-implementer.md"))).toBe(false);
    expect(fs.existsSync(path.join(tempHome, "custom-agent-root", "agents", "spx-implementer.md"))).toBe(false);
  });
});
