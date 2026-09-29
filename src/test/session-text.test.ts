import { describe, expect, it } from "vitest";
import { buildHandoffPrompt, sessionMessagesToText, type CopyableMessage } from "../sessionText";

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

describe("流转的开场白", () => {
  it("带上来源、上下文和交接说明", () => {
    const prompt = buildHandoffPrompt({
      sourceLabel: "Claude Code",
      contextText: "**你**\n\n你好",
      note: "接着把测试补上",
    });
    expect(prompt).toContain("从另一个会话（Claude Code）流转过来");
    expect(prompt).toContain("<上下文>\n**你**\n\n你好\n</上下文>");
    expect(prompt).toContain("交接说明：接着把测试补上");
  });

  it("没写交接说明时给一句默认指令，不留空", () => {
    const prompt = buildHandoffPrompt({ sourceLabel: "Codex", contextText: "x", note: "   " });
    expect(prompt).toContain("请先看懂上面的上下文");
    expect(prompt).not.toContain("交接说明：");
  });
});
