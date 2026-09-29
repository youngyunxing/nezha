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
