import { describe, expect, it } from "vitest";
import { sessionMessagesToText, type CopyableMessage } from "../sessionText";

const LABELS = { assistantLabel: "Claude Code", youLabel: "你" };

const messages: CopyableMessage[] = [
  { role: "user", content: [{ type: "text", text: "第一句" }] },
  {
    role: "assistant",
    content: [{ type: "text", text: "回答一" }, { type: "tool_use" }],
  },
  { role: "user", content: [{ type: "text", text: "第二句" }] },
  { role: "assistant", content: [{ type: "tool_use" }] }, // 纯工具调用
  { role: "assistant", content: [{ type: "text", text: "回答二" }] },
];

describe("复制会话的文本化", () => {
  it("全部：跳过没有文本的消息，带上双方署名", () => {
    const text = sessionMessagesToText(messages, LABELS);
    expect(text).toContain("**你**\n\n第一句");
    expect(text).toContain("**Claude Code**\n\n回答一");
    expect(text).toContain("**Claude Code**\n\n回答二");
    expect(text.split("\n\n---\n\n")).toHaveLength(4); // 5 条里 4 条有文本
  });

  it("最近 N 条：1 就是最近一条", () => {
    expect(sessionMessagesToText(messages, { ...LABELS, count: 1 })).toBe(
      "**Claude Code**\n\n回答二",
    );
    expect(sessionMessagesToText(messages, { ...LABELS, count: 2 })).toBe(
      "**你**\n\n第二句\n\n---\n\n**Claude Code**\n\n回答二",
    );
  });

  it("一条文本都没有时返回空串", () => {
    expect(
      sessionMessagesToText([{ role: "assistant", content: [{ type: "tool_use" }] }], LABELS),
    ).toBe("");
  });
});
