import { describe, expect, test } from "vitest";
import workflowMonitorExtension from "../../../extensions/workflow-monitor";

describe("/workflow-next", () => {
  test("accepts repeated --done flags before creating a new session", async () => {
    let command: any;
    const appendedEntries: Array<{ type: string; data: any }> = [];
    const fakePi: any = {
      on() {},
      registerTool() {},
      appendEntry(type: string, data: any) {
        appendedEntries.push({ type, data });
      },
      registerCommand(_name: string, opts: any) {
        command = opts;
      },
    };

    workflowMonitorExtension(fakePi);

    const calls: any[] = [];
    let newSessionCalls = 0;
    const ctx: any = {
      hasUI: true,
      sessionManager: { getSessionFile: () => "/tmp/session.jsonl" },
      ui: {
        setEditorText: (t: string) => calls.push(["setEditorText", t]),
        notify: () => {},
        select: async () => {
          throw new Error("select should not be called when --done is explicit");
        },
      },
      newSession: async () => {
        newSessionCalls += 1;
        return { cancelled: false };
      },
    };

    await command.handler("execute --done brainstorm --done plan docs/plans/phase.md", ctx);

    expect(newSessionCalls).toBe(1);
    expect(appendedEntries.at(-1)?.data?.workflow?.declaredCompletePhases).toEqual(["brainstorm", "plan"]);
    expect(calls[0][0]).toBe("setEditorText");
    expect(calls[0][1]).toMatch(/Continue from artifact: docs\/plans\/phase\.md/);
  });

  test("uses interactive fallback when earlier phases are unresolved", async () => {
    let command: any;
    const appendedEntries: Array<{ type: string; data: any }> = [];
    const fakePi: any = {
      on() {},
      registerTool() {},
      appendEntry(type: string, data: any) {
        appendedEntries.push({ type, data });
      },
      registerCommand(_name: string, opts: any) {
        command = opts;
      },
    };

    workflowMonitorExtension(fakePi);

    const selects: Array<[string, string[]]> = [];
    let newSessionCalls = 0;
    const ctx: any = {
      hasUI: true,
      sessionManager: {
        getSessionFile: () => "/tmp/session.jsonl",
        getBranch: () => [],
      },
      ui: {
        setEditorText: () => {},
        notify: () => {},
        setWidget: () => {},
        select: async (title: string, options: string[]) => {
          selects.push([title, options]);
          return "Yes, continue";
        },
      },
      newSession: async () => {
        newSessionCalls += 1;
        return { cancelled: false };
      },
    };

    await command.handler("execute", ctx);

    expect(selects).toHaveLength(1);
    expect(selects[0]?.[0]).toMatch(/unresolved/i);
    expect(selects[0]?.[1]).toContain("Yes, continue");
    expect(newSessionCalls).toBe(1);
    expect(appendedEntries.at(-1)?.data?.workflow?.declaredCompletePhases).toEqual(["brainstorm", "plan"]);
  });

  test("creates new session and prefills kickoff message", async () => {
    let handler: any;
    const fakePi: any = {
      on() {},
      registerTool() {},
      appendEntry() {},
      registerCommand(_name: string, opts: any) {
        handler = opts.handler;
      },
    };

    workflowMonitorExtension(fakePi);

    const calls: any[] = [];
    const ctx: any = {
      hasUI: true,
      sessionManager: { getSessionFile: () => "/tmp/session.jsonl" },
      ui: {
        setEditorText: (t: string) => calls.push(["setEditorText", t]),
        notify: () => {},
        select: async () => "Yes, continue",
      },
      newSession: async () => ({ cancelled: false }),
    };

    await handler("plan docs/plans/2026-02-10-x-design.md", ctx);

    expect(calls[0][0]).toBe("setEditorText");
    expect(calls[0][1]).toMatch(/Continue from artifact: docs\/plans\/2026-02-10-x-design\.md/);
  });

  test("rejects invalid phase values", async () => {
    let handler: any;
    const fakePi: any = {
      on() {},
      registerTool() {},
      appendEntry() {},
      registerCommand(_name: string, opts: any) {
        handler = opts.handler;
      },
    };

    workflowMonitorExtension(fakePi);

    let newSessionCalls = 0;
    const notifications: Array<[string, string]> = [];

    const ctx: any = {
      hasUI: true,
      sessionManager: { getSessionFile: () => "/tmp/session.jsonl" },
      ui: {
        setEditorText: () => {},
        notify: (message: string, level: string) => notifications.push([message, level]),
      },
      newSession: async () => {
        newSessionCalls += 1;
        return { cancelled: false };
      },
    };

    await handler("nonsense docs/plans/foo.md", ctx);

    expect(newSessionCalls).toBe(0);
    expect(notifications[0]?.[0]).toMatch(/Usage: \/workflow-next <phase>/);
    expect(notifications[0]?.[1]).toBe("error");
  });

  test("registers argument completions for phases and --done", () => {
    let command: any;
    const fakePi: any = {
      on() {},
      registerTool() {},
      appendEntry() {},
      registerCommand(_name: string, opts: any) {
        command = opts;
      },
    };

    workflowMonitorExtension(fakePi);

    expect(command.getArgumentCompletions("")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "brainstorm", label: "brainstorm" }),
        expect.objectContaining({ value: "--done ", label: "--done" }),
      ]),
    );

    expect(command.getArgumentCompletions("--done p")).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "--done plan", label: "plan" })]),
    );
  });
});
