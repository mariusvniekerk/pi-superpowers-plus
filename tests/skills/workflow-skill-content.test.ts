import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { loadAgentFrontmatter } from "../helpers/agent-frontmatter";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("workflow skill content", () => {
  test("ships namespaced review and utility agents wired into prompts", () => {
    const docReviewer = loadAgentFrontmatter("agents/spx-doc-reviewer.md");
    const investigator = loadAgentFrontmatter("agents/spx-codebase-investigator.md");
    const testRunner = loadAgentFrontmatter("agents/spx-test-runner.md");
    const internetResearcher = loadAgentFrontmatter("agents/spx-internet-researcher.md");
    const testEffectivenessAnalyst = loadAgentFrontmatter("agents/spx-test-effectiveness-analyst.md");

    expect(docReviewer.name).toBe("spx-doc-reviewer");
    expect(docReviewer.tools).toBe("read, bash, find, grep, ls");

    expect(investigator.name).toBe("spx-codebase-investigator");
    expect(investigator.tools).toBe("read, bash, find, grep, ls, lsp");
    expect(investigator.model).toBe("openai-codex/gpt-5.4:low");

    expect(testRunner.name).toBe("spx-test-runner");
    expect(testRunner.tools).toBe("bash");
    expect(testRunner.model).toBe("openai-codex/gpt-5.4:low");

    expect(internetResearcher.name).toBe("spx-internet-researcher");
    expect(internetResearcher.tools).toBe("web_search, read");
    expect(internetResearcher.model).toBe("openai-codex/gpt-5.4:low");

    expect(testEffectivenessAnalyst.name).toBe("spx-test-effectiveness-analyst");
    expect(testEffectivenessAnalyst.tools).toBe("read, find, grep, ls, lsp");
    expect(testEffectivenessAnalyst.model).toBe("openai-codex/gpt-5.4:high");

    expect(read("skills/brainstorming/spec-document-reviewer-prompt.md")).toContain('agent: "spx-doc-reviewer"');
    expect(read("skills/writing-plans/plan-document-reviewer-prompt.md")).toContain('agent: "spx-doc-reviewer"');
  });

  test("package metadata points at shipped local pi-subagents wrappers with a typecheck gate", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
      pi?: { extensions?: string[] };
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.pi?.extensions).toContain("extensions/pi-subagents-index.js");
    expect(pkg.pi?.extensions).toContain("extensions/pi-subagents-notify.js");
    expect(pkg.pi?.extensions).toContain("extensions/pi-subagents-agent-sync.ts");
    expect(pkg.pi?.extensions).not.toContain("extensions/subagent/index.ts");
    expect(pkg.dependencies?.["pi-subagents"]).toBeDefined();
    expect(pkg.scripts?.typecheck).toBe("tsc --noEmit");
    expect(pkg.devDependencies?.typescript).toBeDefined();
    expect(pkg.devDependencies?.["@types/node"]).toBeDefined();
    expect(read("tsconfig.json")).toContain('"noEmit": true');

    const indexPath = path.join(process.cwd(), "extensions/pi-subagents-index.js");
    const notifyPath = path.join(process.cwd(), "extensions/pi-subagents-notify.js");

    expect(fs.existsSync(indexPath)).toBe(true);
    expect(fs.existsSync(notifyPath)).toBe(true);

    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const packOutput = execFileSync(npmCommand, ["pack", "--json", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    const tarballs = JSON.parse(packOutput) as Array<{ files?: Array<{ path: string }> }>;
    const packedFiles = new Set(tarballs[0]?.files?.map((file) => file.path) ?? []);

    expect(packedFiles.has("extensions/pi-subagents-index.js")).toBe(true);
    expect(packedFiles.has("extensions/pi-subagents-notify.js")).toBe(true);
  });

  test("brainstorming requires recommitting spec changes after review feedback", () => {
    expect(read("skills/brainstorming/SKILL.md")).toMatch(/commit the updated spec/i);
  });
});
