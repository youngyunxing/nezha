/** 会话回放的文本化：给「复制会话」用，也方便单测。 */
export interface CopyableContent {
  type: string;
  text?: string;
}

export interface CopyableMessage {
  role: "user" | "assistant";
  content: CopyableContent[];
}

/** 一条消息里所有 text 片段拼起来（tool_use / thinking 不参与复制）。 */
function messageText(message: CopyableMessage): string {
  return message.content
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text!.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 把会话消息拼成可直接粘贴的 Markdown。
 * `count` 给了就只取最近这么多条（1 = 只取最近一条），不给就是全部。
 * 计数只算**有文本的**消息：会话末尾常常是纯工具调用，按原始条数切会让「最近 1 条」
 * 复制出空内容。
 */
export function sessionMessagesToText(
  messages: CopyableMessage[],
  options: { count?: number; assistantLabel: string; youLabel: string },
): string {
  const withText = messages
    .map((message) => ({ message, text: messageText(message) }))
    .filter((entry) => entry.text !== "");
  const picked = options.count === undefined ? withText : withText.slice(-options.count);
  const blocks: string[] = [];
  for (const { message, text } of picked) {
    const who = message.role === "user" ? options.youLabel : options.assistantLabel;
    blocks.push(`**${who}**\n\n${text}`);
  }
  return blocks.join("\n\n---\n\n");
}

/**
 * 流转用的开场白：把源会话的上下文原样交给另一个 agent，并说明这是接手不是新任务。
 * 目标 agent 读不懂源会话的私有记录格式，所以只能靠这段文本接手。
 */
export function buildHandoffPrompt(options: {
  sourceLabel: string;
  contextText: string;
  note?: string;
}): string {
  const note = options.note?.trim();
  const lines = [
    `下面是从另一个会话（${options.sourceLabel}）流转过来的上下文，请接着往下做，不要从头重来。`,
    "",
    "<上下文>",
    options.contextText,
    "</上下文>",
    "",
    note ? `交接说明：${note}` : "请先看懂上面的上下文，然后告诉我你打算怎么接手。",
  ];
  return lines.join("\n");
}
