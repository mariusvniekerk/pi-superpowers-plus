import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { discoverAgents } from "../../../extensions/subagent/agents";

describe("subagent agent discovery", () => {
  test("discovers bundled agents from package agents/ directory", () => {
    const res = discoverAgents(process.cwd(), "project");
    const names = res.agents.map((a) => a.name);
    expect(names).toContain("implementer");
    expect(names).toContain("code-reviewer");
    expect(names).toContain("codebase-investigator");
    expect(names).toContain("internet-researcher");
    expect(names).toContain("test-runner");
    expect(names).toContain("test-effectiveness-analyst");
  });

  test("ships bundled review prompts for spec and plan document loops", () => {
    expect(fs.existsSync(path.join(process.cwd(), "skills", "brainstorming", "spec-document-reviewer-prompt.md"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(process.cwd(), "skills", "writing-plans", "plan-document-reviewer-prompt.md"))).toBe(
      true,
    );
  });
});
