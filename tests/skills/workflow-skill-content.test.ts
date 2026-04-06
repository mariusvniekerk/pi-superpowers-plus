import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { discoverAgents } from "../../extensions/subagent/agents";

describe("workflow skill content", () => {
  test("ships a dedicated read-only document reviewer agent and uses it in review prompts", () => {
    const discovery = discoverAgents(process.cwd(), "project");
    const docReviewer = discovery.agents.find((agent) => agent.name === "doc-reviewer");

    expect(docReviewer).toBeDefined();
    expect(docReviewer?.tools).toEqual(["read", "bash", "find", "grep", "ls"]);

    const specPrompt = fs.readFileSync(
      path.join(process.cwd(), "skills", "brainstorming", "spec-document-reviewer-prompt.md"),
      "utf-8",
    );
    const planPrompt = fs.readFileSync(
      path.join(process.cwd(), "skills", "writing-plans", "plan-document-reviewer-prompt.md"),
      "utf-8",
    );

    expect(specPrompt).toContain('agent: "doc-reviewer"');
    expect(planPrompt).toContain('agent: "doc-reviewer"');
  });

  test("ships low-cost support agents for codex/gpt utility work", () => {
    const discovery = discoverAgents(process.cwd(), "project");
    const codebaseInvestigator = discovery.agents.find((agent) => agent.name === "codebase-investigator");
    const testRunner = discovery.agents.find((agent) => agent.name === "test-runner");
    const internetResearcher = discovery.agents.find((agent) => agent.name === "internet-researcher");
    const testEffectivenessAnalyst = discovery.agents.find((agent) => agent.name === "test-effectiveness-analyst");

    expect(codebaseInvestigator).toBeDefined();
    expect(codebaseInvestigator?.tools).toEqual(["read", "bash", "find", "grep", "ls", "lsp"]);
    expect(codebaseInvestigator?.model).toBe("openai-codex/gpt-5.4:low");

    expect(testRunner).toBeDefined();
    expect(testRunner?.tools).toEqual(["bash"]);
    expect(testRunner?.model).toBe("openai-codex/gpt-5.4:low");

    expect(internetResearcher).toBeDefined();
    expect(internetResearcher?.tools).toEqual(["web_search", "read"]);
    expect(internetResearcher?.model).toBe("openai-codex/gpt-5.4:low");

    expect(testEffectivenessAnalyst).toBeDefined();
    expect(testEffectivenessAnalyst?.tools).toEqual(["read", "find", "grep", "ls", "lsp"]);
    expect(testEffectivenessAnalyst?.model).toBe("openai-codex/gpt-5.4:high");
  });

  test("brainstorming requires recommitting spec changes after review feedback", () => {
    const brainstorming = fs.readFileSync(path.join(process.cwd(), "skills", "brainstorming", "SKILL.md"), "utf-8");

    expect(brainstorming).toMatch(/commit the updated spec/i);
  });
});
