import type { Highlighter } from "shiki";
import type { ThemeVariant } from "./types";

/** 主题名沿用应用设置里那套（github-dark / github-light / solarized-light）。 */
const THEMES = ["github-dark", "github-light", "solarized-light"] as const;

/** 预载常用语言，其余在用到时 loadLanguage；加载失败就退回纯文本。 */
const LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "bash",
  "shell",
  "python",
  "rust",
  "go",
  "html",
  "css",
  "yaml",
  "toml",
  "markdown",
  "sql",
  "diff",
];

let highlighterPromise: Promise<Highlighter> | null = null;

/** 全局共享一个 highlighter：语法与主题只加载一次，多处复用。 */
export function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= import("shiki").then(({ createHighlighter }) =>
    createHighlighter({ themes: [...THEMES], langs: LANGS }),
  );
  return highlighterPromise;
}

export function shikiThemeFor(themeVariant: ThemeVariant): string {
  if (themeVariant === "dark" || themeVariant === "midnight") return "github-dark";
  if (themeVariant === "eyecare") return "solarized-light";
  return "github-light";
}

/**
 * 高亮一段代码，返回 shiki 生成的 <pre class="shiki"> HTML。
 * 未知语言、加载失败等情况返回 null，调用方回退成普通 <pre>。
 */
export async function highlightCode(
  code: string,
  lang: string | undefined,
  themeVariant: ThemeVariant,
): Promise<string | null> {
  const highlighter = await getHighlighter();
  const requested = (lang ?? "").trim().toLowerCase();
  let resolved = requested || "text";

  if (resolved !== "text" && !highlighter.getLoadedLanguages().includes(resolved)) {
    try {
      await highlighter.loadLanguage(resolved as never);
    } catch {
      resolved = "text";
    }
  }

  try {
    return highlighter.codeToHtml(code, { lang: resolved, theme: shikiThemeFor(themeVariant) });
  } catch {
    return null;
  }
}
