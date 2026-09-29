import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, Check } from "lucide-react";
import { marked } from "marked";
import { useI18n } from "../i18n";

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
            background: "var(--bg-subtle)",
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

function MessageBlock({ message }: { message: SessionMessage }) {
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
        <div
          key={i}
          className="session-prose"
          dangerouslySetInnerHTML={{ __html: marked(t.text ?? "", { async: false }) as string }}
        />
      ))}
    </div>
  );
}

export function SessionView({ sessionPath }: { sessionPath: string }) {
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
        <MessageBlock key={i} message={msg} />
      ))}
    </div>
  );
}
