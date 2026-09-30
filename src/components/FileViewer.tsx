import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { AlertCircle, List } from "lucide-react";
import { isMarkdownFile } from "../utils";
import ReactCodeMirror, { EditorView } from "@uiw/react-codemirror";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { solarizedLight } from "@uiw/codemirror-theme-solarized";
import { ImagePreviewPane } from "./file-viewer/ImagePreviewPane";
import { MarkdownPreviewContent } from "./file-viewer/MarkdownPreviewContent";
import { useLanguageExtension } from "./file-viewer/languageExtensions";
import type { OpenFileTab } from "../hooks/useProjectPanels";
import type { ThemeVariant } from "../types";
import { useI18n } from "../i18n";

type TocEntry = { depth: number; text: string; id: string };

// Render markdown to sanitized HTML and extract a table of contents in a single
// pass, so heading ids in the HTML and the TOC anchors are guaranteed to match.
function renderMarkdownWithToc(content: string): { html: string; toc: TocEntry[] } {
  const used = new Set<string>();
  const toc: TocEntry[] = [];
  const instance = new Marked({
    renderer: {
      heading(token) {
        const inlineHtml = this.parser.parseInline(token.tokens);
        const plain = inlineHtml.replace(/<[^>]*>/g, "").trim();
        const base =
          plain
            .toLowerCase()
            .replace(/[^\w一-龥 -]/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "") || "section";
        let id = base;
        let n = 1;
        while (used.has(id)) id = `${base}-${n++}`;
        used.add(id);
        toc.push({ depth: token.depth, text: plain, id });
        return `<h${token.depth} id="${id}">${inlineHtml}</h${token.depth}>\n`;
      },
    },
  });
  const html = instance.parse(content, { async: false }) as string;
  return { html: DOMPurify.sanitize(html), toc };
}

function isPreviewableImageFile(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" || ext === "webp" || ext === "bmp" || ext === "svg";
}

const editorBaseTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    background: "var(--bg-panel)",
    "-webkit-user-select": "text",
    "user-select": "text",
  },
  ".cm-editor": {
    background: "var(--bg-panel)",
  },
  ".cm-scroller": {
    overflow: "auto",
    lineHeight: "1.6",
    background: "var(--bg-panel)",
    "-webkit-user-select": "text",
    "user-select": "text",
  },
  ".cm-content": {
    padding: "12px 0",
    caretColor: "var(--text-primary)",
    "-webkit-user-select": "text",
    "user-select": "text",
  },
  ".cm-gutters": {
    borderRight: "1px solid var(--border-dim)",
    background: "var(--bg-panel)",
    fontSize: "12px",
    minWidth: "44px",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 4px",
    color: "var(--text-hint)",
  },
  ".cm-activeLineGutter": {
    background: "var(--code-line-hover-bg)",
  },
  ".cm-focused .cm-activeLine, .cm-activeLine": {
    background: "var(--code-line-hover-bg)",
  },
});

type SaveStatus = "idle" | "saving" | "saved" | "error";
type ImagePreviewData = {
  dataUrl: string;
  mimeType: string;
  byteLength: number;
};

const TOC_OPEN_STORAGE_KEY = "nezha:md-toc-open";

function MarkdownToc({
  toc,
  activeId,
  onJump,
}: {
  toc: TocEntry[];
  activeId: string | null;
  onJump: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(TOC_OPEN_STORAGE_KEY);
      return stored === null ? false : stored === "1";
    } catch {
      return false;
    }
  });
  const minDepth = useMemo(() => Math.min(...toc.map((entry) => entry.depth)), [toc]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(TOC_OPEN_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* localStorage 不可用时静默忽略 */
      }
      return next;
    });
  };

  return (
    <div className={`md-toc${open ? "" : " md-toc-collapsed"}`}>
      <button
        type="button"
        className="md-toc-toggle"
        onClick={toggle}
        title={t("file.outline")}
        aria-label={t("file.outline")}
      >
        <List size={13} />
        {open && <span>{t("file.outline")}</span>}
      </button>
      {open && (
        <nav className="md-toc-list">
          {toc.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-depth={Math.min(entry.depth - minDepth + 1, 6)}
              className={`md-toc-item${activeId === entry.id ? " active" : ""}`}
              onClick={() => onJump(entry.id)}
              title={entry.text}
            >
              {entry.text}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function FilePreviewPane({
  filePath,
  fileName,
  projectPath,
  themeVariant,
  previewMode,
}: {
  filePath: string;
  fileName: string;
  projectPath: string;
  themeVariant: ThemeVariant;
  previewMode: boolean;
}) {
  const editorTheme =
    themeVariant === "dark" || themeVariant === "midnight"
      ? githubDark
      : themeVariant === "eyecare"
        ? solarizedLight
        : githubLight;
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const isMarkdown = isMarkdownFile(fileName);
  const isPreviewableImage = isPreviewableImageFile(fileName);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const showMarkdownPreview = isMarkdown && previewMode && content !== null;
  const { html: markdownHtml, toc } = useMemo(
    () => (isMarkdown && content !== null ? renderMarkdownWithToc(content) : { html: "", toc: [] }),
    [isMarkdown, content],
  );

  const jumpToHeading = (id: string) => {
    const target = scrollRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !showMarkdownPreview || toc.length === 0) return;
    const headings = toc
      .map((entry) => root.querySelector<HTMLElement>(`#${CSS.escape(entry.id)}`))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveHeadingId(visible[0].target.id);
      },
      { root, rootMargin: "0px 0px -65% 0px", threshold: 0 },
    );
    headings.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [showMarkdownPreview, toc]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setContent(null);
    setImagePreview(null);
    setError(null);
    setSaveStatus("idle");

    const loadFile = isPreviewableImage
      ? invoke<ImagePreviewData>("read_image_preview", { path: filePath, projectPath }).then((preview) => {
          if (cancelled) return;
          setImagePreview(preview);
          setLoading(false);
        })
      : invoke<string>("read_file_content", { path: filePath, projectPath }).then((nextContent) => {
          if (cancelled) return;
          setContent(nextContent);
          setLoading(false);
        });

    loadFile
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, projectPath, isPreviewableImage]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedResetRef.current) clearTimeout(savedResetRef.current);
    },
    [],
  );

  const handleChange = (value: string) => {
    setContent(value);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (savedResetRef.current) clearTimeout(savedResetRef.current);

    setSaveStatus("saving");
    saveTimerRef.current = setTimeout(async () => {
      try {
        await invoke("write_file_content", { path: filePath, content: value, projectPath });
        setSaveStatus("saved");
        savedResetRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("error");
      }
    }, 1500);
  };

  const languageExtension = useLanguageExtension(fileName);
  const extensions = useMemo(() => [languageExtension, editorBaseTheme], [languageExtension]);

  const saveLabel =
    saveStatus === "saving"
      ? t("file.saving")
      : saveStatus === "saved"
        ? t("file.saved")
        : saveStatus === "error"
          ? t("file.saveFailed")
          : null;
  const statusLabel = isPreviewableImage
    ? imagePreview
      ? `${imagePreview.mimeType} · ${t("file.readOnly")}`
      : t("file.imagePreview")
    : saveLabel;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
        minHeight: 0,
        background: "var(--bg-panel)",
      }}
    >
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          position: "relative",
          userSelect: "text",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-hint)",
              fontSize: 12,
            }}
          >
            {t("common.loading")}
          </div>
        )}
        {error && !loading && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 10,
              color: "var(--text-muted)",
            }}
          >
            <AlertCircle size={24} strokeWidth={1.5} />
            <span style={{ fontSize: 12.5 }}>{error}</span>
          </div>
        )}
        {!loading &&
          !error &&
          (isPreviewableImage && imagePreview ? (
            <ImagePreviewPane
              src={imagePreview.dataUrl}
              fileName={fileName}
              mimeType={imagePreview.mimeType}
              byteLength={imagePreview.byteLength}
            />
          ) : content !== null ? (
            isMarkdown && previewMode ? (
              <div className="md-preview-pane">
                <div ref={scrollRef} className="md-preview-scroll">
                  <MarkdownPreviewContent html={markdownHtml} onJump={jumpToHeading} />
                </div>
                {toc.length > 0 && (
                  <MarkdownToc toc={toc} activeId={activeHeadingId} onJump={jumpToHeading} />
                )}
              </div>
            ) : (
              <ReactCodeMirror
                value={content}
                onChange={handleChange}
                theme={editorTheme}
                extensions={extensions}
                height="100%"
                style={{ height: "100%" }}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: true,
                  highlightSelectionMatches: true,
                  autocompletion: false,
                  searchKeymap: true,
                }}
              />
            )
          ) : null)}
      </div>

      <div
        style={{
          height: 22,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderTop: "1px solid var(--border-dim)",
          background: "var(--bg-subtle)",
          flexShrink: 0,
          gap: 8,
        }}
      >
        <span
          style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
        >
          {filePath}
        </span>
        {statusLabel && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: saveStatus === "error" ? "var(--danger-fg)" : "var(--text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {statusLabel}
          </span>
        )}
      </div>
    </div>
  );
}

export function FileViewer({
  tabs,
  activeFilePath,
  projectPath,
  themeVariant,
  previewModes,
}: {
  tabs: OpenFileTab[];
  activeFilePath: string | null;
  projectPath: string;
  themeVariant: ThemeVariant;
  /** 每个文件的 markdown 预览开关；开关按钮在主区域标签条上（见 MainTabBar）。 */
  previewModes: Record<string, boolean>;
}) {
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activeFilePath) ?? tabs[tabs.length - 1] ?? null,
    [tabs, activeFilePath],
  );

  if (!activeTab) return null;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
        minHeight: 0,
        background: "var(--bg-panel)",
      }}
    >
      <div
        style={{
          flex: 1,
          position: "relative",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.path === activeTab.path;
          return (
            <div
              key={tab.path}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                visibility: isActive ? "visible" : "hidden",
                pointerEvents: isActive ? "auto" : "none",
              }}
            >
              <FilePreviewPane
                filePath={tab.path}
                fileName={tab.name}
                projectPath={projectPath}
                themeVariant={themeVariant}
                previewMode={previewModes[tab.path] ?? isMarkdownFile(tab.name)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
