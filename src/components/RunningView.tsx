import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { agentLabel, canForkAgent, taskSessionId, taskSessionPath } from "../types";
import { SessionManageMenu } from "./running-view/SessionManageMenu";
import { FlowHandoff, type HandoffOptions } from "./running-view/FlowHandoff";
import type { QuickInput as QuickInputItem } from "../quickInputs";
import { useToast } from "./Toast";
import { writeClipboardText } from "./file-explorer/clipboard";
import { useI18n } from "../i18n";
import s from "../styles";
import {
  RotateCcw,
  GitMerge,
  Trash2,
  AlertTriangle,
  History,
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
  onOpenRecord,
  showRecord = false,
  getRestoreState,
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
  /** 把「会话记录」开成一个主区域标签（终端右下角那个按钮调的）。 */
  onOpenRecord: () => void;
  /** 这个任务当前是不是在「会话记录」标签上（主区域那个标签选中的是它）。 */
  showRecord?: boolean;
  getRestoreState?: () => { initialData?: string; initialSnapshot?: string };
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
  const [worktreeBusy, setWorktreeBusy] = useState<"merge" | "discard" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [forkDialogOpen, setForkDialogOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [bannerCompact, setBannerCompact] = useState(false);
  const interruptedBannerRef = useRef<HTMLDivElement>(null);

  const defaultForkName = buildDefaultForkTaskName(
    task.name,
    task.prompt,
    t("running.untitledTask"),
  );
  // 能 Fork 才算得上「可以 Fork 的会话」：工作树任务和没有会话 id 的（纯终端）都不行，
  // 这两种情况下按钮直接不出现，而不是置灰占位。跑着的会话也能 Fork —— CLI 是读落盘的
  // transcript 复制，正在生成的那一轮还没落盘、不会被带过去。
  const canFork =
    canForkAgent(task.agent) && !task.worktreePath && Boolean(resumeSessionId) && Boolean(onFork);
  // 导出不设门槛：只要有会话文件就显示（跑着的任务也能导，等于给当前进度拍个快照）。
  const canExport = Boolean(sessionPath);
  // 头部那行只剩动作按钮了（任务名在标签条上）。一个按钮都没有的终端（纯终端任务）
  // 就不占这 36px —— 那点高度留给终端自己。
  const canResumeHere = !isActive && !isInterrupted && Boolean(onResume) && canResume && !task.worktreeDiscarded;
  const canMergeWorktree =
    !isActive && task.status === "done" && Boolean(task.worktreePath) && Boolean(task.worktreeBranch) &&
    !task.worktreeDiscarded && Boolean(onMergeWorktree);
  const canDiscardWorktree =
    !isActive && Boolean(task.worktreePath) && Boolean(task.worktreeBranch) && !task.worktreeDiscarded &&
    Boolean(onDiscardWorktree);
  // fork / 导出搬到右下角那一排之后，头部只剩工作树这三个按钮 —— 跑着的任务（isActive）
  // 一个按钮都没有，于是头部整行不出现，指标行直接贴着标签条。
  const showHeaderActions = canResumeHere || canMergeWorktree || canDiscardWorktree;

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

  // 这个任务当前在看「会话记录」标签：终端不卸载，只 display:none 藏起来 ——
  // 卸载会 dispose xterm、把 PTY 尺寸重置，切回来还得重排（跟「被文件查看器盖住」同一条路）。
  const recordPane = showRecord && Boolean(sessionPath);

  // 会话右下角一排（顺序：快捷输入 / fork / 流转 / 复制 / 导出）。
  // 抽成变量是因为「终端」和「会话记录」两种模式都要挂它 —— 结束的任务是后者，
  // 而 fork / 导出 恰恰在那种时候最有用。样式跟这一排的其它按钮一致。
  // 会话管理（fork / 流转 / 复制 / 导出）收进右上角那个 ⋯ —— 它们是对整段会话做的
  // 一次性动作，不该占着右下角"随手要用"的那一排。头部那一行在的时候要往下让一行。
  const manageEntry: ReactNode = sessionPath ? (
    <SessionManageMenu
      sessionPath={sessionPath}
      assistantLabel={agentLabel(task.agent)}
      canFork={canFork}
      canExport={canExport}
      exporting={exporting}
      onFork={() => setForkDialogOpen(true)}
      onHandoff={() => setHandoffOpen(true)}
      onExport={() => void handleExport()}
    />
  ) : null;

  const cornerActions = (
    <div style={s.sessionCornerActions}>
      {/* 快捷输入 = 往终端里打字。PTY 已经没了的（完成/失败/取消/中断）就别给 ——
          插进去也没人接，只会让人以为还能输入。管快捷指令去活着的会话里管。 */}
      {isActive && (
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
      )}

      {/* 会话记录：把它开成主区域的另一个标签（点了才开，能切走能关掉）。
          只在任务活着的时候给 —— 结束的任务主区域本来就是记录，不用再开一个。 */}
      {isActive && sessionPath && !recordPane && (
        <button
          type="button"
          className="quick-input-trigger"
          style={s.quickInputTrigger}
          title={t("session.record")}
          onClick={onOpenRecord}
        >
          <History size={12} strokeWidth={2.3} />
          <span>{t("session.record")}</span>
        </button>
      )}
    </div>
  );

  // 终端面板抽成变量：正常运行要用，纯终端任务在「异常中断」态也要用它显示上次屏幕
  // （否则重启后只剩一条横幅 +「没有会话记录」，看不到记录）。
  const terminalPane = (
    <div style={{ ...s.terminalContainer, ...(recordPane ? { display: "none" } : null) }}>
      <TerminalView
        key={`${task.id}-${runCount}`}
        agent={task.agent}
        shellOwned={task.agent === "shell"}
        onInput={onInput}
        onResize={onResize}
        onRegisterTerminal={onRegisterTerminal}
        onReady={onTerminalReady}
        onSnapshot={onSnapshot}
        themeVariant={themeVariant}
        terminalFontSize={terminalFontSize}
        terminalScrollback={terminalScrollback}
        monoFontFamily={monoFontFamily}
        isActive={visible && !recordPane}
        initialData={restoreState.initialData}
        initialSnapshot={restoreState.initialSnapshot}
        topRightSlot={manageEntry}
      />
      {cornerActions}
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
      {/* 头部：任务名已移到主区域标签条，这里只剩动作按钮 */}
      {showHeaderActions && (
        <div
          style={{
            ...s.runHeader,
            // 动作按钮那一行的下沿线：底下没有指标行时（纯终端）由这一行自己画。
            ...(metrics || sessionPath ? null : { borderBottom: "1px solid var(--border-dim)" }),
          }}
        >
          {/* 任务名不在这儿了 —— 主区域标签条上已经有（components/main-tabs/MainTabBar）。
              这里只留占位，让右边的动作按钮继续靠右。 */}
          <div style={{ flex: 1, minWidth: 0 }} />
          {canResumeHere && (
            <button style={s.resumeBtn} onClick={() => onResume?.()}>
                <RotateCcw size={12} strokeWidth={2.5} />
                <span>{t("running.resume")}</span>
              </button>
            )}
          {canMergeWorktree && (
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
                    await onMergeWorktree?.();
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
          {canDiscardWorktree && (
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
                    await onDiscardWorktree?.();
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
        </div>
      )}
      <FlowHandoff
        open={handoffOpen}
        sourceLabel={agentLabel(task.agent)}
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
            // 头部在时它自己是 36px 高、内容居中，按钮下方本来就空着 ~8px，所以这里顶部不用再给；
            // 头部不在时（跑着的任务）直接把上边距补上，别让指标贴到标签条上。
            // 左边距 10 = 终端容器自己的左内边距，指标和终端正文左边对齐。
            padding: showHeaderActions ? "0 20px 8px 10px" : "8px 20px 8px 10px",
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
            {/* 被删掉的任务正在被"看"（历史组点开）：不给启动类按钮 ——
                它还是已删除状态，跑起来在列表里也看不见。要恢复走右键菜单。 */}
            {!task.deleted && (
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
            )}
          </div>
          {sessionPath ? (
            <div style={s.sessionPaneWrap}>
              <SessionView
            sessionPath={sessionPath}
            themeVariant={themeVariant}
            topRightSlot={manageEntry}
          />
              {cornerActions}
            </div>
          ) : task.agent === "shell" ? (
            terminalPane
          ) : (
            <div style={s.interruptedNoSessionPane}>
              {t(canReconnect ? "running.detachedNoSession" : "running.interruptedNoSession")}
            </div>
          )}
        </div>
      ) : recordPane && sessionPath ? (
        /* 记录视图：和终端共用右下角那一排（快捷输入 / fork / 流转 / 复制 / 导出）——
           之前它挂在 ProjectPage 上，那一排就整个丢了，用户报的"快捷输入不可见"就是这个 */
        <div style={s.sessionPaneWrap}>
          <SessionView
            sessionPath={sessionPath}
            themeVariant={themeVariant}
            topRightSlot={manageEntry}
          />
          {cornerActions}
        </div>
      ) : isActive || !sessionPath ? (
        terminalPane
      ) : (
        <div style={s.sessionPaneWrap}>
          <SessionView
            sessionPath={sessionPath}
            themeVariant={themeVariant}
            topRightSlot={manageEntry}
          />
          {cornerActions}
        </div>
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
