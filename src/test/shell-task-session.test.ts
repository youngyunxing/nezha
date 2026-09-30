import { describe, expect, test } from "vitest";
import { taskSessionId, taskSessionPath } from "../types";
import type { Task } from "../types";

const base = {
  id: "1",
  projectId: "p",
  prompt: "",
  permissionMode: "full_access" as const,
  status: "idle" as const,
  createdAt: 1,
};

const shell = (extra: Partial<Task>): Task => ({ ...base, agent: "shell", ...extra }) as Task;

describe("纯终端任务的会话字段（里面手敲的可能是任一家）", () => {
  test("哪个字段有值就用哪个 —— claude / kimi / codex 都认", () => {
    expect(taskSessionPath(shell({ kimiSessionPath: "/k.jsonl" }))).toBe("/k.jsonl");
    expect(taskSessionId(shell({ kimiSessionId: "session_k" }))).toBe("session_k");
    expect(taskSessionPath(shell({ codexSessionPath: "/c.jsonl" }))).toBe("/c.jsonl");
    expect(taskSessionPath(shell({ claudeSessionPath: "/a.jsonl", kimiSessionPath: "/k.jsonl" }))).toBe(
      "/a.jsonl",
    );
    expect(taskSessionPath(shell({}))).toBeUndefined();
    expect(taskSessionId(shell({}))).toBeUndefined();
  });

  test("非终端任务仍按自己的 agent 取（不受影响）", () => {
    expect(taskSessionPath({ ...base, agent: "kimi", kimiSessionPath: "/k.jsonl" } as Task)).toBe(
      "/k.jsonl",
    );
    expect(
      taskSessionPath({ ...base, agent: "claude", claudeSessionPath: "/a.jsonl" } as Task),
    ).toBe("/a.jsonl");
  });
});
