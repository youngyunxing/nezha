import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, Check } from "lucide-react";
import { marked, type Token, type Tokens } from "marked";
import { useI18n } from "../i18n";
import type { ThemeVariant } from "../types";
import { highlightCode } from "../highlight";

interface SessionContent {
  type: "text" | "tool_use" | "thinking";
  text?: string;
  id?: string;
  name?: string;
  input?: string;
  thinking?: string;
}

interface SessionMessage {
  role: "user" | "assistant";
  content: SessionContent[];
}

function UserMessageBubble({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ marginBottom: 14, display: "flex", justifyContent: "flex-end" }}>
      <div
        style={{ maxWidth: "72%", position: "relative" }}
        className="user-message-bubble"
        onMouseEnter={(e) => {
          const btn = (e.currentTarget as HTMLElement).querySelector(
            ".copy-btn",
          ) as HTMLElement | null;
          if (btn) btn.style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          const btn = (e.currentTarget as HTMLElement).querySelector(
            ".copy-btn",
          ) as HTMLElement | null;
          if (btn) btn.style.opacity = "0";
        }}
      >
        <button
          className="copy-btn"
          onClick={handleCopy}
          style={{
            position: "absolute",
            top: 6,
            right: 8,
            opacity: 0,
            transition: "opacity 0.15s",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 2,
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <div
          style={{
            padding: "10px 16px",
            background: "var(--accent-subtle)",
            color: "var(--text-primary)",
            borderRadius: 20,
            fontSize: 13.5,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

type MarkdownBlock =
  | { kind: "html"; html: string }
  | { kind: "code"; code: string; lang?: string };

/** 把 markdown 按「代码块 / 其余」切开：代码块要异步高亮，其余整段同步渲染。 */
function splitMarkdown(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let buffer: Token[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    blocks.push({ kind: "html", html: marked.parser(buffer, { async: false }) as string });
    buffer = [];
  };

  for (const token of marked.lexer(text)) {
    if (token.type === "code") {
      flush();
      const code = token as Tokens.Code;
      blocks.push({ kind: "code", code: code.text, lang: code.lang || undefined });
    } else {
      buffer.push(token);
    }
  }
  flush();
  return blocks;
}

function CodeBlock({
  code,
  lang,
  themeVariant,
}: {
  code: string;
  lang?: string;
  themeVariant: ThemeVariant;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    highlightCode(code, lang, themeVariant)
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, lang, themeVariant]);

  // 高亮未就绪（首次懒加载 shiki）或语言未知时，先按普通代码块呈现。
  if (!html) {
    return (
      <div className="session-prose">
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  return <div className="session-prose session-code" dangerouslySetInnerHTML={{ __html: html }} />;
}

function MarkdownBody({ text, themeVariant }: { text: string; themeVariant: ThemeVariant }) {
  const blocks = useMemo(() => splitMarkdown(text), [text]);
  return (
    <>
      {blocks.map((block, i) =>
        block.kind === "html" ? (
          <div key={i} className="session-prose" dangerouslySetInnerHTML={{ __html: block.html }} />
        ) : (
          <CodeBlock key={i} code={block.code} lang={block.lang} themeVariant={themeVariant} />
        ),
      )}
    </>
  );
}

function MessageBlock({
  message,
  themeVariant,
}: {
  message: SessionMessage;
  themeVariant: ThemeVariant;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    if (!text.trim()) return null;
    return <UserMessageBubble text={text} />;
  }

  // 只留「助手说过的话」：工具调用（bash / 读写文件…）与思考块一律不展示——回放的
  // 价值是双方对话本身，工具噪声会把对话冲散。
  const textParts = message.content.filter((c) => c.type === "text" && (c.text ?? "").trim());
  if (textParts.length === 0) return null;

  return (
    <div style={{ marginBottom: 18, maxWidth: "82%" }}>
      {textParts.map((t, i) => (
        <MarkdownBody key={i} text={t.text ?? ""} themeVariant={themeVariant} />
      ))}
    </div>
  );
}

export function SessionView({
  sessionPath,
  themeVariant,
}: {
  sessionPath: string;
  themeVariant: ThemeVariant;
}) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    invoke<SessionMessage[]>("read_session_messages", { sessionPath })
      .then((msgs) => {
        setMessages(msgs);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [sessionPath]);

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "20px 28px 32px",
      }}
    >
      {loading && (
        <div style={{ color: "var(--text-hint)", fontSize: 13, padding: "12px 0" }}>
          {t("session.loading")}
        </div>
      )}
      {error && (
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "12px 0" }}>
          {t("session.unableToLoad", { error })}
        </div>
      )}
      {!loading && !error && messages.length === 0 && (
        <div style={{ color: "var(--text-hint)", fontSize: 13, padding: "12px 0" }}>
          {t("session.noMessages")}
        </div>
      )}
      {messages.map((msg, i) => (
        <MessageBlock key={i} message={msg} themeVariant={themeVariant} />
      ))}
    </div>
  );
}
