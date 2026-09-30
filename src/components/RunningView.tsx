import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import type {
  Task,
  TerminalFontSize,
  TerminalScrollback,
  FontFamily,
  ThemeVariant,
} from "../types";
import { StatusIcon } from "./StatusIcon";
import { TerminalView } from "./TerminalView";
import { SessionView } from "./SessionView";
import { buildDefaultForkTaskName, ForkTaskDialog } from "./running-view/SessionActionsMenu";
import { QuickInput } from "./running-view/QuickInput";
import { taskSessionId, taskSessionPath } from "../types";
import { CopySession } from "./running-view/CopySession";
import { FlowHandoff, type HandoffOptions } from "./running-view/FlowHandoff";
import type { QuickInput as QuickInputItem } from "../quickInputs";
import { useToast } from "./Toast";
import { writeClipboardText } from "./file-explorer/clipboard";
import { useI18n } from "../i18n";
import s from "../styles";
import {
  ArrowRightLeft,
  RotateCcw,
  Pencil,
  GitMerge,
  Trash2,
  AlertTriangle,
  GitFork,
  Download,
} from "lucide-react";

interface SessionMetrics {
  duration_secs: number;
  session_file_bytes: number;
  total_tokens: number;
  context_tokens: number;
  context_window: number;
  /** 当前速度（token/秒）：最近 60 秒的输出速率 */
  tps_current: number;
  /** 过去 5 小时「生成时」的平均速度（排除发呆/跑工具的时间） */
  tps_5h: number;
  /** 会话最后一次活动的时间（epoch 秒） */
  last_activity_ts: number;
}

/** 超过这么久没有新输出，「当前速度」按 0 显示（指标缓存不会自己衰减，这里补上）。 */

function formatDuration(secs: number): string {
  const totalSeconds = Math.max(0, Math.round(secs));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** TPS：小的给两位小数，大的取整，免得抖得难看。 */
function formatTps(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(mb < 10 ? 1 : 0)}M`;
  }
  const gb = bytes / 1024 / 1024 / 1024;
  return `${gb.toFixed(gb < 10 ? 1 : 0)}G`;
}

export function RunningView({
  task,
  projectPath,
  runCount = 0,
  visible = true,
  projectActive = true,
  onResume,
  onFork,
  onMergeWorktree,
  onDiscardWorktree,
  onReconnect,
  onMarkRead,
  onHandoff,
  onRestart,
  quickInputs,
  quickAutoEnter,
  onQuickAutoEnterChange,
  onSaveQuickInput,
  onDeleteQuickInput,
  onInput,
  onResize,
  onRegisterTerminal,
  onTerminalReady,
  onSnapshot,
  getRestoreState,
  onRename,
  themeVariant,
  terminalFontSize,
  terminalScrollback,
  monoFontFamily,
}: {
  task: Task;
  projectPath: string;
  runCount?: number;
  visible?: boolean;
  projectActive?: boolean;
  onResume?: () => void;
  onFork?: (name: string) => void;
  onMergeWorktree?: () => Promise<void>;
  onDiscardWorktree?: () => Promise<void>;
  onReconnect: () => void;
  /** 这一轮的新回复已被看到：把「有新回复」落回「空闲待命」 */
  onMarkRead?: () => void;
  /** 把当前会话流转给另一个 agent；resolve true = 完成，弹窗自己关 */
  onHandoff: (options: HandoffOptions) => Promise<boolean>;
  /** 没有会话可续时（比如 codex 没留下会话记录）重新开一个，而不是给个死路 */
  onRestart: () => void;
  /** 会话右下角的快捷输入 */
  quickInputs: QuickInputItem[];
  /** 快捷输入：输入后是否自动回车 */
  quickAutoEnter: boolean;
  onQuickAutoEnterChange: (value: boolean) => void;
  onSaveQuickInput: (item: QuickInputItem) => void;
  onDeleteQuickInput: (id: string) => void;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onRegisterTerminal: (writeFn: ((data: string, callback?: () => void) => void) | null) => number;
  onTerminalReady: (generation: number) => void;
  onSnapshot?: (snapshot: string) => void;
  getRestoreState?: () => { initialData?: string; initialSnapshot?: string };
  onRename: (name: string) => void;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  terminalScrollback: TerminalScrollback;
  monoFontFamily: FontFamily;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const isActive =
    task.status === "pending" ||
    task.status === "idle" ||
    task.status === "running" ||
    task.status === "input_required" ||
    task.status === "awaiting_review";
  const isInterrupted = task.status === "interrupted";
  // 中断的两种情况：进程还活着（点重连接回去）、进程没了（点恢复重新拉起）
  const canReconnect = isInterrupted && Boolean(task.processAlive);
  const sessionPath = taskSessionPath(task);
  const resumeSessionId = taskSessionId(task);
  // 纯终端没有会话 id 可 resume：恢复 = 重开一个 shell（屏幕内容由终端快照/输出缓冲带回）。
  const canResume = task.agent === "shell" || !!resumeSessionId;
  // 没有会话可续（例如 codex 这一版把会话存进 SQLite、没留 rollout）：允许重新开始
  const canRestart = !canResume;
  const restoreState = getRestoreState?.() ?? {};

  const [metricsState, setMetricsState] = useState<{
    sessionPath: string;
    status: "loading" | "ready" | "failed";
    metrics: SessionMetrics | null;
  } | null>(null);
  const currentMetricsState = metricsState?.sessionPath === sessionPath ? metricsState : null;
  const metrics = currentMetricsState?.status === "ready" ? currentMetricsState.metrics : null;
  const [editingTitle, setEditingTitle] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [hoverHeader, setHoverHeader] = useState(false);
  const [worktreeBusy, setWorktreeBusy] = useState<"merge" | "discard" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [forkDialogOpen, setForkDialogOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [bannerCompact, setBannerCompact] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const interruptedBannerRef = useRef<HTMLDivElement>(null);

  const defaultForkName = buildDefaultForkTaskName(
    task.name,
    task.prompt,
    t("running.untitledTask"),
  );
  // 能 Fork 才算得上「可以 Fork 的会话」：工作树任务和没有会话 id 的（纯终端）都不行，
  // 这两种情况下按钮直接不出现，而不是置灰占位。跑着的会话也能 Fork —— CLI 是读落盘的
  // transcript 复制，正在生成的那一轮还没落盘、不会被带过去。
  const canFork = !task.worktreePath && Boolean(resumeSessionId) && Boolean(onFork);
  // 导出不设门槛：只要有会话文件就显示（跑着的任务也能导，等于给当前进度拍个快照）。
  const canExport = Boolean(sessionPath);

  const handleExport = async () => {
    if (exporting || !sessionPath) return;
    setExporting(true);
    try {
      const titleSource = (task.name ?? task.prompt).trim();
      // 仅保留汉字/字母/数字/连字符，其它替换成 _。避免出现非法文件名字符。
      const slug =
        titleSource
          .slice(0, 50)
          .replace(/[^\w\u4e00-\u9fa5-]+/g, "_")
          .replace(/^_+|_+$/g, "") || "session";
      const date = new Date().toISOString().slice(0, 10);
      const defaultName = `nezha-${slug}-${date}.md`;

      const outputPath = await saveDialog({
        title: t("running.exportSaveDialogTitle"),
        defaultPath: defaultName,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!outputPath) return;

      await invoke<void>("export_session_markdown", {
        sessionPath,
        projectPath,
        isCodex: task.agent === "codex",
        outputPath,
        taskMeta: {
          name: task.name,
          prompt: task.prompt,
          agent: task.agent,
          createdAt: task.createdAt,
          sessionId: task.agent === "codex" ? task.codexSessionId : task.claudeSessionId,
          worktreeBranch: task.worktreeBranch,
          baseBranch: task.baseBranch,
          additions: task.additions,
          deletions: task.deletions,
          failureReason: task.failureReason,
        },
      });
      showToast(t("running.exportSuccess", { path: outputPath }), "success");
    } catch (err) {
      showToast(t("running.exportFailed", { error: String(err) }), "error");
    } finally {
      setExporting(false);
    }
  };

  const handleCopySessionPath = async () => {
    if (!sessionPath) return false;
    try {
      await writeClipboardText(sessionPath);
      return true;
    } catch (err) {
      showToast(t("running.sessionFilePathCopyFailed", { error: String(err) }), "error");
      return false;
    }
  };

  useEffect(() => {
    const el = interruptedBannerRef.current;
    if (!el) return;

    const updateCompact = () => {
      setBannerCompact(el.clientWidth < 820);
    };
    updateCompact();

    const observer = new ResizeObserver(updateCompact);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isInterrupted, sessionPath]);

  // 「有新回复」是未读状态：这个任务正显示在前台（visible）、窗口有焦点，就算你看过了。
  // 窗口重新获得焦点、页面重新可见时再判一次 —— 切出去再切回来也算看过。
  useEffect(() => {
    if (!onMarkRead || !visible || !projectActive || task.status !== "awaiting_review") return;
    const markIfFocused = () => {
      if (document.hasFocus()) onMarkRead();
    };
    markIfFocused();
    window.addEventListener("focus", markIfFocused);
    document.addEventListener("visibilitychange", markIfFocused);
    return () => {
      window.removeEventListener("focus", markIfFocused);
      document.removeEventListener("visibilitychange", markIfFocused);
    };
  }, [onMarkRead, visible, projectActive, task.status]);

  useEffect(() => {
    if (!sessionPath) {
      setMetricsState(null);
      return;
    }
    const activeSessionPath = sessionPath;
    setMetricsState((prev) =>
      prev?.sessionPath === activeSessionPath
        ? prev
        : { sessionPath: activeSessionPath, status: "loading", metrics: null },
    );
    // 只在项目处于前台时才跑 metrics 轮询；切到其他项目时暂停，
    // 项目重新激活时这里会立即补拉一次。注意这里用的是 projectActive
    // 而不是 visible —— 后者在同项目内打开 FileViewer / GitDiff 时也会是 false，
    // 那种场景下不应该中断正在运行任务的 duration 更新。
    if (!projectActive) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = () => {
      invoke<SessionMetrics>("read_session_metrics", { sessionPath: activeSessionPath })
        .then((nextMetrics) => {
          if (cancelled) return;
          setMetricsState({
            sessionPath: activeSessionPath,
            status: "ready",
            metrics: nextMetrics,
          });
        })
        .catch(() => {
          if (!cancelled) {
            setMetricsState({
              sessionPath: activeSessionPath,
              status: "failed",
              metrics: null,
            });
          }
        });
    };

    load();
    if (isActive) timer = setInterval(load, 3000);

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [sessionPath, isActive, projectActive]);

  // 终端面板抽成变量：正常运行要用，纯终端任务在「异常中断」态也要用它显示上次屏幕
  // （否则重启后只剩一条横幅 +「没有会话记录」，看不到记录）。
  const terminalPane = (
    <div style={s.terminalContainer}>
      <TerminalView
        key={`${task.id}-${runCount}`}
        onInput={onInput}
        onResize={onResize}
        onRegisterTerminal={onRegisterTerminal}
        onReady={onTerminalReady}
        onSnapshot={onSnapshot}
        themeVariant={themeVariant}
        terminalFontSize={terminalFontSize}
        terminalScrollback={terminalScrollback}
        monoFontFamily={monoFontFamily}
        isActive={visible}
        initialData={restoreState.initialData}
        initialSnapshot={restoreState.initialSnapshot}
      />
      {/* 会话右下角：流转 + 复制会话 + 快捷输入 */}
      <div style={s.sessionCornerActions}>
        {sessionPath && (
          <button
            type="button"
            className="quick-input-trigger"
            style={s.quickInputTrigger}
            title={t("handoff.button")}
            onClick={() => setHandoffOpen(true)}
          >
            <ArrowRightLeft size={12} strokeWidth={2.3} />
            <span>{t("handoff.button")}</span>
          </button>
        )}
        {sessionPath && (
          <CopySession
            sessionPath={sessionPath}
            assistantLabel={task.agent === "codex" ? "Codex" : task.agent === "kimi" ? "Kimi" : "Claude Code"}
          />
        )}
        <QuickInput
          items={quickInputs}
          sessionKind={task.agent === "shell" ? "command" : "prompt"}
          projectId={task.projectId}
          autoEnter={quickAutoEnter}
          onAutoEnterChange={onQuickAutoEnterChange}
          onInsert={onInput}
          onSave={onSaveQuickInput}
          onDelete={onDeleteQuickInput}
        />
      </div>
    </div>
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
        zIndex: visible ? 1 : 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          ...s.runHeader,
          // 纯终端没有指标行（没有会话文件），分割线就没人画了 —— 补在任务名这一行下面，
          // 和左侧面板头部的分割线一样落在 36px 处。有指标行时由指标行负责那条线。
          ...(metrics || sessionPath ? null : { borderBottom: "1px solid var(--border-dim)" }),
        }}
        onMouseEnter={() => setHoverHeader(true)}
        onMouseLeave={() => setHoverHeader(false)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          {editingTitle ? (
            <input
              ref={titleInputRef}
              style={{
                maxWidth: 420,
                width: "100%",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-primary)",
                background: "transparent",
                border: "none",
                borderBottom: "2px solid var(--border-strong)",
                borderRadius: 0,
                padding: "0 2px",
                outline: "none",
              }}
              value={editValue}
              placeholder={task.prompt.slice(0, 60)}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onRename(editValue.trim());
                  setEditingTitle(false);
                }
                if (e.key === "Escape") {
                  setEditingTitle(false);
                }
              }}
              onBlur={() => {
                onRename(editValue.trim());
                setEditingTitle(false);
              }}
            />
          ) : (
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {(() => {
                const t = task.name ?? task.prompt;
                return t.slice(0, 70) + (t.length > 70 ? "…" : "");
              })()}
            </span>
          )}
          {sessionPath && !editingTitle && (
            <button
              type="button"
              title={t("task.renameTask")}
              style={{
                ...s.taskRenameBtn,
                flexShrink: 0,
                color: "var(--text-secondary)",
                opacity: hoverHeader ? 1 : 0.65,
                background: hoverHeader ? "var(--bg-input)" : "transparent",
                transition: "opacity 0.15s ease, background 0.15s ease",
              }}
              onClick={() => {
                setEditValue(task.name ?? "");
                setEditingTitle(true);
                setTimeout(() => titleInputRef.current?.focus(), 0);
              }}
            >
              <Pencil size={13} strokeWidth={2.25} />
            </button>
          )}
        </div>
        {isActive && (
          <>
          </>
        )}
        {!isActive &&
          !isInterrupted &&
          onResume &&
          canResume &&
          !task.worktreeDiscarded && (
            <button style={s.resumeBtn} onClick={onResume}>
              <RotateCcw size={12} strokeWidth={2.5} />
              <span>{t("running.resume")}</span>
            </button>
          )}
        {!isActive &&
          task.status === "done" &&
          task.worktreePath &&
          task.worktreeBranch &&
          !task.worktreeDiscarded &&
          onMergeWorktree && (
            <button
              style={{
                ...s.resumeBtn,
                opacity: worktreeBusy ? 0.6 : 1,
                cursor: worktreeBusy ? "not-allowed" : "pointer",
              }}
              disabled={!!worktreeBusy}
              onClick={async () => {
                setWorktreeBusy("merge");
                try {
                  await onMergeWorktree();
                } finally {
                  setWorktreeBusy(null);
                }
              }}
            >
              <GitMerge size={12} strokeWidth={2.5} />
              <span>
                {worktreeBusy === "merge"
                  ? t("running.merging")
                  : t("running.mergeTo", { branch: task.baseBranch ?? "" })}
              </span>
            </button>
          )}
        {!isActive &&
          task.worktreePath &&
          task.worktreeBranch &&
          !task.worktreeDiscarded &&
          onDiscardWorktree && (
            <button
              style={{
                ...s.cancelBtn,
                opacity: worktreeBusy ? 0.6 : 1,
                cursor: worktreeBusy ? "not-allowed" : "pointer",
              }}
              disabled={!!worktreeBusy}
              onClick={async () => {
                setWorktreeBusy("discard");
                try {
                  await onDiscardWorktree();
                } finally {
                  setWorktreeBusy(null);
                }
              }}
            >
              <Trash2 size={12} strokeWidth={2.5} />
              <span>
                {worktreeBusy === "discard"
                  ? t("running.discarding")
                  : t("running.discardWorktree")}
              </span>
            </button>
          )}
        {canFork && (
          <button
            type="button"
            style={s.resumeBtn}
            title={t("running.forkSession")}
            onClick={() => setForkDialogOpen(true)}
          >
            <GitFork size={12} strokeWidth={2.4} />
            <span>{t("running.forkSession")}</span>
          </button>
        )}
        {canExport && (
          <button
            type="button"
            style={{ ...s.resumeBtn, opacity: exporting ? 0.6 : 1, cursor: exporting ? "wait" : "pointer" }}
            title={t("running.exportMarkdown")}
            disabled={exporting}
            onClick={handleExport}
          >
            <Download size={12} strokeWidth={2.4} className={exporting ? "spin" : ""} />
            <span>{exporting ? t("running.exporting") : t("running.exportSession")}</span>
          </button>
        )}
      </div>
      <FlowHandoff
        open={handoffOpen}
        sourceLabel={task.agent === "codex" ? "Codex" : task.agent === "kimi" ? "Kimi" : "Claude Code"}
        defaultTarget={task.agent === "codex" ? "claude" : "codex"}
        onOpenChange={setHandoffOpen}
        onHandoff={onHandoff}
      />
      <ForkTaskDialog
        open={forkDialogOpen}
        defaultName={defaultForkName}
        onOpenChange={setForkDialogOpen}
        onFork={(name) => onFork?.(name)}
      />
      {(metrics || sessionPath) && (
        <div
          style={{
            // 任务名那行是 36px 高、文字居中，文字下方本来就空着 ~8px；所以这里顶部不给
            // 内边距，视觉上到任务名的距离才等于到底部分割线的 8px。
            padding: "0 20px 8px",
            borderBottom: "1px solid var(--border-dim)",
            flexShrink: 0,
          }}
        >
          <div style={s.runMetricsRow}>
            {metrics && (
              <>
                <MetricPill
                  label={t("running.duration")}
                  value={formatDuration(metrics.duration_secs)}
                />
              </>
            )}
            {sessionPath && (
              <SessionFilePill
                label={t("running.sessionFileLabel")}
                value={
                  currentMetricsState?.status === "ready" && metrics
                    ? formatFileSize(metrics.session_file_bytes)
                    : currentMetricsState?.status === "failed"
                      ? "0B"
                      : "..."
                }
                tone={
                  currentMetricsState?.status === "ready" && metrics
                    ? metrics.session_file_bytes > 0
                      ? "success"
                      : "error"
                    : currentMetricsState?.status === "failed"
                      ? "error"
                      : "warning"
                }
                copiedLabel={t("running.sessionFilePathCopied")}
                onCopy={handleCopySessionPath}
              />
            )}
            {metrics && (
              <>
                <MetricPill
                  label={t("running.tokens")}
                  value={formatTokens(metrics.total_tokens)}
                />
                {/* 只看 5 小时平均：实时值抖动大、参考价值低，已去掉 */}
                {metrics.tps_5h > 0 && (
                  <MetricPill label={t("running.tps5h")} value={formatTps(metrics.tps_5h)} />
                )}
                {metrics.context_window > 0 && metrics.context_tokens > 0 && (
                  <MetricPill
                    label={t("running.context")}
                    value={`${formatTokens(metrics.context_tokens)} / ${formatTokens(metrics.context_window)} (${Math.round(
                      (metrics.context_tokens / metrics.context_window) * 100,
                    )}%)`}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Main content: terminal when active, session view when done/failed. */}
      {isInterrupted ? (
        <div style={s.interruptedSessionWrap}>
          <div ref={interruptedBannerRef} style={s.interruptedBanner}>
            <div style={s.interruptedBannerIcon}>
              <AlertTriangle size={14} strokeWidth={2.1} />
            </div>
            <div style={s.interruptedBannerBody}>
              <div style={s.interruptedBannerTitle}>
                {t(canReconnect ? "running.detachedTitle" : "running.interruptedTitle")}
              </div>
            </div>
            <div style={s.interruptedBannerActions}>
              <button
                type="button"
                title={!canResume ? t("running.restartHint") : undefined}
                style={{
                  ...s.interruptedPrimaryBtn,
                  opacity: canResume || canRestart ? 1 : 0.45,
                  cursor: canResume || canRestart ? "pointer" : "not-allowed",
                }}
                disabled={!canResume && !canRestart}
                onClick={canResume ? (canReconnect ? onReconnect : onResume) : onRestart}
              >
                <RotateCcw size={12} strokeWidth={2.1} />
                <span>
                  {!canResume
                    ? t("running.restart")
                    : canReconnect
                      ? bannerCompact
                        ? t("running.reconnect")
                        : t("running.reconnectTask")
                      : bannerCompact
                        ? t("running.resume")
                        : t("running.resumeTask")}
                </span>
              </button>
            </div>
          </div>
          {sessionPath ? (
            <SessionView sessionPath={sessionPath} themeVariant={themeVariant} />
          ) : task.agent === "shell" ? (
            terminalPane
          ) : (
            <div style={s.interruptedNoSessionPane}>
              {t(canReconnect ? "running.detachedNoSession" : "running.interruptedNoSession")}
            </div>
          )}
        </div>
      ) : isActive || !sessionPath ? (
        terminalPane
      ) : (
        <SessionView sessionPath={sessionPath} themeVariant={themeVariant} />
      )}

      {/* Status bar when task is done and no session path (terminal fallback) */}
      {!isActive && !isInterrupted && !sessionPath && (
        <div
          style={{
            padding: "10px 20px",
            borderTop: "1px solid var(--border-dim)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <StatusIcon status={task.status} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {task.status === "done"
              ? t("task.completed")
              : task.status === "failed"
                ? (task.failureReason ?? t("task.failed"))
                : t("task.cancelled")}
          </span>
        </div>
      )}
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.runMetricPill}>
      <span style={s.runMetricPillLabel}>{label}</span>
      <span style={s.runMetricPillValue}>{value}</span>
    </div>
  );
}

type SessionFilePillTone = "success" | "warning" | "error";

const sessionFilePillToneColor: Record<SessionFilePillTone, string> = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error: "var(--color-error)",
};

function SessionFilePill({
  label,
  value,
  tone,
  copiedLabel,
  onCopy,
}: {
  label: string;
  value: string;
  tone: SessionFilePillTone;
  copiedLabel: string;
  onCopy: () => Promise<boolean>;
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const handleClick = async () => {
    const ok = await onCopy();
    if (!ok) return;
    setCopied(true);
    if (copiedTimerRef.current !== null) {
      clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = setTimeout(() => {
      setCopied(false);
      copiedTimerRef.current = null;
    }, 1000);
  };

  return (
    <span
      style={s.runSessionFilePillWrap}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        style={{ ...s.runMetricPill, ...s.runMetricPillButton }}
        onClick={handleClick}
      >
        <span
          aria-hidden="true"
          style={{
            ...s.railStatusDot,
            background: sessionFilePillToneColor[tone],
            borderColor: "var(--bg-input)",
            ...s.runSessionStatusDot,
          }}
        />
        <span style={s.runMetricPillLabel}>{label}</span>
        <span style={s.runMetricPillValue}>{value}</span>
      </button>
      {copied && hovered && <span style={s.runSessionCopyTooltip}>{copiedLabel}</span>}
    </span>
  );
}
