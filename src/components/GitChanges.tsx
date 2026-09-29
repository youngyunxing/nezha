import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCancellableInvoke } from "../hooks/useCancellableInvoke";
import s from "../styles";
import {
  gitChangesPanelStyle,
  gitChangesSectionActionStyle,
  gitChangesSectionCountStyle,
  gitChangesTopSectionStyle,
} from "../styles/git-diff";
import { useI18n } from "../i18n";
import {
  GitFileBrowser,
  GitFileViewToggle,
  type GitFileBrowserScrollContext,
  type GitDirectoryActionTarget,
  useGitFileViewMode,
} from "./git-view/GitFileBrowser";

interface GitFileChange {
  path: string;
  status: string;
  staged: boolean;
}

interface Props {
  projectRoot: string;
  repoPath: string;
  currentTaskCreatedAt: number | null;
  onFileSelect: (filePath: string, staged: boolean, label: string) => void;
  width?: number;
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function GitChanges({
  projectRoot,
  repoPath,
  currentTaskCreatedAt,
  onFileSelect,
  width = 280,
}: Props) {
  const { t } = useI18n();
  const repoKey = `${projectRoot}\0${repoPath}`;
  const activeRepoKeyRef = useRef(repoKey);
  activeRepoKeyRef.current = repoKey;
  const refreshSequenceRef = useRef(0);
  const [changeState, setChangeState] = useState<{
    repoKey: string;
    changes: GitFileChange[];
  }>({ repoKey: "", changes: [] });
  const changes = useMemo(
    () => (changeState.repoKey === repoKey ? changeState.changes : []),
    [changeState, repoKey],
  );
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"task" | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [trackedCollapsed, setTrackedCollapsed] = useState(false);
  const [untrackedCollapsed, setUntrackedCollapsed] = useState(false);
  const [fileViewMode, setFileViewMode] = useGitFileViewMode();
  const fileListScrollRef = useRef<HTMLDivElement>(null);
  const [fileListScrollTop, setFileListScrollTop] = useState(0);
  const [fileListViewportHeight, setFileListViewportHeight] = useState(0);

  const { safeInvoke, isCancelled } = useCancellableInvoke();

  useEffect(() => {
    const el = fileListScrollRef.current;
    if (!el) return;

    const updateViewport = () => {
      setFileListScrollTop(el.scrollTop);
      setFileListViewportHeight(el.clientHeight);
    };

    updateViewport();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateViewport);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const refresh = useCallback(
    async (options?: { clearError?: boolean }) => {
      const sequence = ++refreshSequenceRef.current;
      setLoading(true);
      if (options?.clearError !== false) setError(null);
      try {
        const requestRepoKey = repoKey;
        const result = await safeInvoke<GitFileChange[]>("git_status", {
          projectPath: projectRoot,
          repoPath,
        });
        if (
          result === null ||
          activeRepoKeyRef.current !== requestRepoKey ||
          refreshSequenceRef.current !== sequence
        ) {
          return;
        }
        setChangeState({ repoKey: requestRepoKey, changes: result });
      } catch (e) {
        if (
          !isCancelled() &&
          activeRepoKeyRef.current === repoKey &&
          refreshSequenceRef.current === sequence
        ) {
          setError(String(e));
        }
      } finally {
        if (
          !isCancelled() &&
          activeRepoKeyRef.current === repoKey &&
          refreshSequenceRef.current === sequence
        ) {
          setLoading(false);
        }
      }
    },
    [projectRoot, repoPath, repoKey, safeInvoke, isCancelled],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    // 切仓后清掉上一个仓库留下的错误提示。在途响应的失效由 activeRepoKeyRef 兜住。
    setError(null);
  }, [repoKey]);

  // "Current Task" tab: files modified after task start
  const taskChanges = useMemo(
    () => (currentTaskCreatedAt ? changes.filter((c) => c.staged) : []),
    [changes, currentTaskCreatedAt],
  );
  const allChanges = changes;
  const displayed = useMemo(
    () => (tab === "task" ? taskChanges : allChanges),
    [allChanges, tab, taskChanges],
  );

  const trackedFiles = useMemo(() => displayed.filter((c) => c.status !== "?"), [displayed]);
  const untrackedFiles = useMemo(() => displayed.filter((c) => c.status === "?"), [displayed]);
  const stagedFiles = useMemo(() => trackedFiles.filter((c) => c.staged), [trackedFiles]);
  const unstagedFiles = useMemo(() => trackedFiles.filter((c) => !c.staged), [trackedFiles]);

  const handleFileListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setFileListScrollTop(e.currentTarget.scrollTop);
  }, []);

  const fileListScrollContext = useMemo<GitFileBrowserScrollContext>(
    () => ({
      containerRef: fileListScrollRef,
      scrollTop: fileListScrollTop,
      viewportHeight: fileListViewportHeight,
      layoutKey: [
        fileViewMode,
        trackedCollapsed,
        untrackedCollapsed,
        stagedFiles.length,
        unstagedFiles.length,
        untrackedFiles.length,
      ].join(":"),
    }),
    [
      fileListScrollTop,
      fileListViewportHeight,
      fileViewMode,
      trackedCollapsed,
      untrackedCollapsed,
      stagedFiles.length,
      unstagedFiles.length,
      untrackedFiles.length,
    ],
  );

  const handleStageToggle = async (c: GitFileChange, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (c.staged) {
        await invoke("git_unstage", { projectPath: projectRoot, repoPath, filePath: c.path });
      } else {
        await invoke("git_stage", { projectPath: projectRoot, repoPath, filePath: c.path });
      }
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDirectoryStageToggle = async (
    directory: GitDirectoryActionTarget,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      setError(null);
      if (directory.staged) {
        await invoke("git_unstage_files", {
          projectPath: projectRoot,
          repoPath,
          filePaths: directory.filePaths,
        });
      } else {
        await invoke("git_stage_files", {
          projectPath: projectRoot,
          repoPath,
          filePaths: directory.filePaths,
        });
      }
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleStageAll = async () => {
    try {
      setError(null);
      await invoke("git_stage_all", { projectPath: projectRoot, repoPath });
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleUnstageAll = async () => {
    try {
      setError(null);
      await invoke("git_unstage_all", { projectPath: projectRoot, repoPath });
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDiscardFile = async (c: GitFileChange, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const untracked = c.status === "?";
    const name = fileName(c.path);
    const ok = await confirm(
      t(untracked ? "git.confirmDiscardUntracked" : "git.confirmDiscardTracked", { name }),
      {
        title: t("git.confirmDiscardTitle", { name }),
        kind: "warning",
        okLabel: t("git.discard"),
      },
    );
    if (!ok) return;
    try {
      setError(null);
      await invoke("git_discard_file", {
        projectPath: projectRoot,
        repoPath,
        filePath: c.path,
        untracked,
      });
    } catch (err) {
      setError(t("git.discardFailed", { error: String(err) }));
    } finally {
      await refresh({ clearError: false });
    }
  };

  const handleDiscardDirectory = async (
    directory: GitDirectoryActionTarget,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm(
      t(directory.untracked ? "git.confirmDiscardUntracked" : "git.confirmDiscardTracked", {
        name: directory.name,
      }),
      {
        title: t("git.confirmDiscardTitle", { name: directory.name }),
        kind: "warning",
        okLabel: t("git.discard"),
      },
    );
    if (!ok) return;
    try {
      setError(null);
      await invoke("git_discard_files", {
        projectPath: projectRoot,
        repoPath,
        filePaths: directory.filePaths,
        untracked: directory.untracked,
      });
    } catch (err) {
      setError(t("git.discardFailed", { error: String(err) }));
    } finally {
      await refresh({ clearError: false });
    }
  };

  const taskCount = taskChanges.length;
  const allCount = allChanges.length;

  return (
    <div style={gitChangesPanelStyle(width)}>
      {/* Header */}
      <div style={s.gitChangesHeader}>
        <span style={s.gitChangesTitle}>{t("git.changes")}</span>
      </div>

      {/* Tabs */}
      <div style={s.gitChangesTabs}>
        <button
          onClick={() => setTab("task")}
          style={tab === "task" ? s.gitChangesTabActive : s.gitChangesTabInactive}
        >
          {t("git.currentTask")} {taskCount}
        </button>
        <button
          onClick={() => setTab("all")}
          style={tab === "all" ? s.gitChangesTabActive : s.gitChangesTabInactive}
        >
          {t("git.all")} {allCount}
        </button>
        <div style={s.gitChangesViewToggleWrap}>
          <GitFileViewToggle mode={fileViewMode} onChange={setFileViewMode} />
        </div>
      </div>

      {/* Error */}
      {error && <div style={s.gitChangesError}>{error}</div>}

      {/* File list */}
      <div ref={fileListScrollRef} onScroll={handleFileListScroll} style={s.gitChangesFileList}>
        {displayed.length === 0 && !loading && (
          <div style={s.gitChangesEmpty}>{t("git.noChanges")}</div>
        )}

        {/* ── Tracked changes section ── */}
        {trackedFiles.length > 0 && (
          <>
            <TopSectionHeader
              label={t("git.changes")}
              count={trackedFiles.length}
              collapsed={trackedCollapsed}
              onToggleCollapse={() => setTrackedCollapsed((v) => !v)}
            />
            {!trackedCollapsed && (
              <>
                {stagedFiles.length > 0 && (
                  <>
                    <SectionHeader
                      label={t("git.staged")}
                      count={stagedFiles.length}
                      actionIcon="−"
                      actionTitle={t("git.unstageAll")}
                      onAction={handleUnstageAll}
                    />
                    <GitFileBrowser
                      entries={stagedFiles}
                      mode={fileViewMode}
                      scrollContext={fileListScrollContext}
                      onFileClick={(c) =>
                        onFileSelect(c.path, true, `${fileName(c.path)} (staged)`)
                      }
                      onStageToggle={handleStageToggle}
                      onDirectoryStageToggle={handleDirectoryStageToggle}
                      autoCollapseLargeDirectories
                    />
                  </>
                )}
                {unstagedFiles.length > 0 && (
                  <>
                    <SectionHeader
                      label={t("git.modified")}
                      count={unstagedFiles.length}
                      actionIcon="+"
                      actionTitle={t("git.stageAll")}
                      onAction={handleStageAll}
                    />
                    <GitFileBrowser
                      entries={unstagedFiles}
                      mode={fileViewMode}
                      scrollContext={fileListScrollContext}
                      onFileClick={(c) =>
                        onFileSelect(c.path, false, `${fileName(c.path)} (unstaged)`)
                      }
                      onStageToggle={handleStageToggle}
                      onDirectoryStageToggle={handleDirectoryStageToggle}
                      onDiscard={handleDiscardFile}
                      onDirectoryDiscard={handleDiscardDirectory}
                      autoCollapseLargeDirectories
                    />
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ── Untracked files section ── */}
        {untrackedFiles.length > 0 && (
          <>
            <TopSectionHeader
              label={t("git.untrackedFiles")}
              count={untrackedFiles.length}
              collapsed={untrackedCollapsed}
              onToggleCollapse={() => setUntrackedCollapsed((v) => !v)}
            />
            {!untrackedCollapsed && (
              <GitFileBrowser
                entries={untrackedFiles}
                mode={fileViewMode}
                scrollContext={fileListScrollContext}
                onFileClick={(c) => onFileSelect(c.path, false, `${fileName(c.path)} (untracked)`)}
                onStageToggle={handleStageToggle}
                onDirectoryStageToggle={handleDirectoryStageToggle}
                onDiscard={handleDiscardFile}
                onDirectoryDiscard={handleDiscardDirectory}
                autoCollapseLargeDirectories
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TopSectionHeader({
  label,
  count,
  collapsed,
  onToggleCollapse,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onToggleCollapse}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={gitChangesTopSectionStyle(hovered)}
    >
      <span style={s.gitChangesTopSectionIcon}>
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      </span>
      <span style={s.gitChangesTopSectionLabel}>{label}</span>
      <span style={s.gitChangesTopSectionCount}>{count}</span>
    </div>
  );
}

function SectionHeader({
  label,
  count,
  actionIcon,
  actionTitle,
  onAction,
}: {
  label: string;
  count: number;
  actionIcon?: string;
  actionTitle?: string;
  onAction?: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={s.gitChangesSectionHeader}
    >
      <span style={s.gitChangesSectionLabel}>{label}</span>
      <span style={gitChangesSectionCountStyle(Boolean(onAction))}>{count}</span>
      {onAction && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          title={actionTitle}
          style={gitChangesSectionActionStyle(hovered)}
        >
          {actionIcon}
        </button>
      )}
    </div>
  );
}
