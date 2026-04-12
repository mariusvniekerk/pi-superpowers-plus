import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { loadAgentFrontmatter } from "../helpers/agent-frontmatter";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("structured agent protocols", () => {
  test("spx implementer keeps the old agent body while the implementer prompt declares the strict final status block", () => {
    const frontmatter = loadAgentFrontmatter("agents/spx-implementer.md");
    const agentContents = read("agents/spx-implementer.md");
    const promptContents = read("skills/subagent-driven-development/implementer-prompt.md");

    expect(frontmatter.name).toBe("spx-implementer");
    expect(frontmatter.managedBy).toBe("pi-superpowers-plus");
    expect(agentContents).toContain("You are an implementation subagent.");
    expect(promptContents).toContain("Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT");
    expect(promptContents).toContain("Summary:");
    expect(promptContents).toContain("Tests:");
    expect(promptContents).toContain("Files Changed:");
    expect(promptContents).toContain("Concerns:");
  });

  test("reviewer prompt templates require structured review summaries", () => {
    expect(read("skills/requesting-code-review/code-reviewer.md")).toContain("### Verdict");
    expect(read("skills/requesting-code-review/code-reviewer.md")).toContain("### Flags For Orchestrator");
    expect(read("skills/requesting-code-review/code-reviewer.md")).not.toContain("### Assessment");
    expect(read("skills/requesting-code-review/code-reviewer.md")).not.toContain("## Review Summary");
    expect(read("skills/subagent-driven-development/quality-spec-reviewer-prompt.md")).toContain("## Review Summary");
    expect(read("skills/subagent-driven-development/critical-reviewer-prompt.md")).toContain("## Review Summary");
    expect(read("skills/subagent-driven-development/critical-reviewer-prompt.md")).toContain(
      "**Flags for orchestrator:**",
    );
  });

  test("workflow prompts instruct automatic repair after malformed structured output", () => {
    const subagentDrivenDevelopment = read("skills/subagent-driven-development/SKILL.md");
    const requestingCodeReview = read("skills/requesting-code-review/SKILL.md");

    expect(subagentDrivenDevelopment).toContain("Retry automatically up to 3 times");
    expect(subagentDrivenDevelopment).toContain("repair only the missing structured parts");
    expect(requestingCodeReview).toContain("repair-only");
    expect(requestingCodeReview).toContain("3 times");
  });
});
