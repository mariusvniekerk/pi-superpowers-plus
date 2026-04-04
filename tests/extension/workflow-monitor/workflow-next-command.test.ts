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

  test("does not persist explicit declarations if new session is cancelled", async () => {
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

    const ctx: any = {
      hasUI: true,
      sessionManager: { getSessionFile: () => "/tmp/session.jsonl" },
      ui: {
        setEditorText: () => {},
        notify: () => {},
        select: async () => {
          throw new Error("select should not be called when --done is explicit");
        },
      },
      newSession: async () => ({ cancelled: true }),
    };

    await command.handler("execute --done brainstorm --done plan docs/plans/phase.md", ctx);

    expect(appendedEntries).toEqual([]);
  });

  test("interactive fallback can mark unresolved phases complete and continue", async () => {
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
          return "Mark earlier phases complete and continue";
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
    expect(selects[0]?.[1]).toEqual([
      "Mark earlier phases complete and continue",
      "Continue without marking earlier phases complete",
      "Cancel",
    ]);
    expect(newSessionCalls).toBe(1);
    expect(appendedEntries.at(-1)?.data?.workflow?.declaredCompletePhases).toEqual(["brainstorm", "plan"]);
  });

  test("interactive fallback can continue without marking earlier phases complete", async () => {
    let command: any;
    const appendedEntries: Array<{ type: string; data: any }> = [];
    const calls: any[] = [];
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

    let newSessionCalls = 0;
    const ctx: any = {
      hasUI: true,
      sessionManager: {
        getSessionFile: () => "/tmp/session.jsonl",
        getBranch: () => [],
      },
      ui: {
        setEditorText: (t: string) => calls.push(["setEditorText", t]),
        notify: () => {},
        setWidget: () => {},
        select: async () => "Continue without marking earlier phases complete",
      },
      newSession: async () => {
        newSessionCalls += 1;
        return { cancelled: false };
      },
    };

    await command.handler("execute docs/plans/phase.md", ctx);

    expect(newSessionCalls).toBe(1);
    expect(appendedEntries).toEqual([]);
    expect(calls[0][1]).toMatch(/Continue from artifact: docs\/plans\/phase\.md/);
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
        select: async () => "Mark earlier phases complete and continue",
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

  test("registers phase-first argument completions", () => {
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
      expect.arrayContaining([expect.objectContaining({ value: "brainstorm", label: "brainstorm" })]),
    );
    expect(command.getArgumentCompletions("")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "--done ", label: "--done" })]),
    );

    expect(command.getArgumentCompletions("pl")).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "plan", label: "plan" })]),
    );

    expect(command.getArgumentCompletions("execute ")).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "execute --done ", label: "--done" })]),
    );

    expect(command.getArgumentCompletions("execute --do")).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "execute --done ", label: "--done" })]),
    );

    expect(command.getArgumentCompletions("execute --done")).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "execute --done ", label: "--done" })]),
    );

    expect(command.getArgumentCompletions("execute --done p")).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "execute --done plan", label: "plan" })]),
    );

    expect(command.getArgumentCompletions("execute docs/plans/phase.md")).toEqual([]);
    expect(command.getArgumentCompletions("execute docs/plans/phase.md ")).toEqual([]);
  });
});
