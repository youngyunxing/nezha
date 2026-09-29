import { useRef, useCallback, useEffect } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";

// ── Buffer constants ─────────────────────────────────────────────────────────

const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB per task (in-memory limit)
const MAX_BUFFER_CHUNKS = 256; // compact when chunks array exceeds this
const DRAIN_FRAME_BUDGET = 128 * 1024; // 每帧最多处理 128KB，避免单帧写入时间过长
/** 屏幕落盘间隔与每次保留的尾部字节数：写整份缓冲太重，留尾部足够回放出最近的屏幕。 */
const SCREEN_SAVE_INTERVAL_MS = 15000;
const SCREEN_TAIL_BYTES = 256 * 1024;

// ── Buffer types & helpers ───────────────────────────────────────────────────

interface TaskBuffer {
  chunks: string[];
  totalLen: number;
  droppedLen: number;
}

export type TerminalWriteFn = (data: string, callback?: () => void) => void;

export interface TaskScreenContext {
  projectId: string;
  /** 任务是否还在跑（有活进程）。不在跑时屏幕内容以磁盘快照为准。 */
  live: boolean;
}

interface TerminalWriteState {
  pending: string[];
  ready: boolean;
  generation: number;
}

function createTaskBuffer(): TaskBuffer {
  return { chunks: [], totalLen: 0, droppedLen: 0 };
}

function createTerminalWriteState(generation = 0): TerminalWriteState {
  return { pending: [], ready: false, generation };
}

function pushToBuffer(buf: TaskBuffer, data: string): void {
  buf.chunks.push(data);
  buf.totalLen += data.length;
  while (buf.totalLen > MAX_BUFFER_SIZE && buf.chunks.length > 0) {
    const dropped = buf.chunks.shift()!;
    buf.totalLen -= dropped.length;
    buf.droppedLen += dropped.length;
  }
  if (buf.chunks.length > MAX_BUFFER_CHUNKS) {
    const merged = buf.chunks.join("");
    buf.chunks.length = 0;
    buf.chunks.push(merged);
  }
}

function getBufferAbsLen(buf: TaskBuffer): number {
  return buf.totalLen + buf.droppedLen;
}

function joinBufferFrom(buf: TaskBuffer, absOffset: number): string {
  const relOffset = absOffset - buf.droppedLen;
  if (relOffset <= 0) return buf.chunks.join("");
  let cum = 0;
  for (let i = 0; i < buf.chunks.length; i++) {
    const len = buf.chunks[i].length;
    if (cum + len > relOffset) {
      const parts = buf.chunks.slice(i);
      parts[0] = parts[0].slice(relOffset - cum);
      return parts.join("");
    }
    cum += len;
  }
  return "";
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useTerminalManager(options?: {
  /** 落盘/读回屏幕的上下文；任务已被删则返回 null。由 App 注入（它知道 tasks/projects）。 */
  resolveTaskContext?: (taskId: string) => TaskScreenContext | null;
}) {
  const resolveTaskContextRef = useRef(options?.resolveTaskContext);
  resolveTaskContextRef.current = options?.resolveTaskContext;
  // 每任务已落盘到的缓冲长度（没增长就跳过写盘）
  const screenSavedRef = useRef<Record<string, number>>({});
  // 恢复时读回来的旧屏幕内容。落盘时拼在「新输出」前面，否则新起的那一小段输出会把
  // 更完整的旧记录覆盖掉（实测：恢复后 15 秒，几 KB 的新 shell 输出冲掉了整份旧记录）。
  const restoredPrefixRef = useRef<Record<string, string>>({});
  const taskBufferRef = useRef<Record<string, TaskBuffer>>({});
  const terminalSnapshotRef = useRef<Record<string, { snapshot: string; bufferLength: number }>>(
    {},
  );
  const terminalWriteRefs = useRef<Record<string, TerminalWriteFn>>({});
  const terminalWriteStateRef = useRef<Record<string, TerminalWriteState>>({});
  const terminalSizeRef = useRef<{ cols: number; rows: number }>({ cols: 220, rows: 50 });

  // ── Write state management ───────────────────────────────────────────────

  const resetTerminalWriteState = useCallback((taskId: string) => {
    const prev = terminalWriteStateRef.current[taskId];
    const next = createTerminalWriteState((prev?.generation ?? 0) + 1);
    terminalWriteStateRef.current[taskId] = next;
    return next;
  }, []);

  const enqueueTerminalWrite = useCallback(
    (taskId: string, data: string) => {
      const state = terminalWriteStateRef.current[taskId] ?? resetTerminalWriteState(taskId);
      if (!state.ready) {
        state.pending.push(data);
        return;
      }
      const writeFn = terminalWriteRefs.current[taskId];
      if (writeFn) {
        writeFn(data);
      }
    },
    [resetTerminalWriteState],
  );

  // ── Agent output ingestion ───────────────────────────────────────────────
  // 通过 tauri::ipc::Channel 直投单订阅者，绕过 emit/listen 的全局事件总线。
  // pendingOutputs / RAF 仍在 hook 级共享，保留原批量写入节奏与每帧字节预算。

  const pendingOutputsRef = useRef<Map<string, string[]>>(new Map());
  const rafIdRef = useRef<number>(0);

  const drainPendingOutputs = useCallback(() => {
    rafIdRef.current = 0;
    if (
      (
        navigator as unknown as {
          scheduling?: { isInputPending?: () => boolean };
        }
      ).scheduling?.isInputPending?.()
    ) {
      rafIdRef.current = requestAnimationFrame(drainPendingOutputs);
      return;
    }
    const pendingOutputs = pendingOutputsRef.current;
    let bytesThisFrame = 0;
    for (const [taskId, chunks] of pendingOutputs) {
      const joined = chunks.length === 1 ? chunks[0] : chunks.join("");

      if (terminalWriteRefs.current[taskId]) {
        enqueueTerminalWrite(taskId, joined);
      }
      if (taskId in taskBufferRef.current) {
        pushToBuffer(taskBufferRef.current[taskId], joined);
      }

      pendingOutputs.delete(taskId);
      bytesThisFrame += joined.length;
      if (bytesThisFrame >= DRAIN_FRAME_BUDGET) {
        break;
      }
    }
    if (pendingOutputs.size > 0 && !rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(drainPendingOutputs);
    }
  }, [enqueueTerminalWrite]);

  const ingestAgentChunk = useCallback(
    (taskId: string, data: string) => {
      const pendingOutputs = pendingOutputsRef.current;
      let arr = pendingOutputs.get(taskId);
      if (!arr) {
        arr = [];
        pendingOutputs.set(taskId, arr);
      }
      arr.push(data);
      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(drainPendingOutputs);
      }
    },
    [drainPendingOutputs],
  );

  const createOutputChannel = useCallback(
    (taskId: string): Channel<string> => {
      const channel = new Channel<string>();
      channel.onmessage = (data) => ingestAgentChunk(taskId, data);
      return channel;
    },
    [ingestAgentChunk],
  );

  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // ── Public API ───────────────────────────────────────────────────────────

  const resetTaskTerminal = useCallback((taskId: string) => {
    taskBufferRef.current[taskId] = createTaskBuffer();
    delete terminalSnapshotRef.current[taskId];
    delete screenSavedRef.current[taskId];
    // 旧记录缓存也清掉：下一次落盘/回放会重新从磁盘读（此时读到的才是最新的那份）
    delete restoredPrefixRef.current[taskId];
  }, []);

  const removeTaskBuffers = useCallback((taskIds: string[]) => {
    for (const taskId of taskIds) {
      delete taskBufferRef.current[taskId];
      delete terminalSnapshotRef.current[taskId];
      delete terminalWriteRefs.current[taskId];
      delete terminalWriteStateRef.current[taskId];
    }
  }, []);

  const writeErrorToTerminal = useCallback((taskId: string, errMsg: string) => {
    const writeFn = terminalWriteRefs.current[taskId];
    if (writeFn) {
      writeFn(errMsg);
    }
    const buf = taskBufferRef.current[taskId] ?? createTaskBuffer();
    pushToBuffer(buf, errMsg);
    taskBufferRef.current[taskId] = buf;
  }, []);

  const handleInput = useCallback((taskId: string, data: string) => {
    invoke("send_input", { taskId, data }).catch(console.error);
  }, []);

  const handleResize = useCallback((taskId: string, cols: number, rows: number) => {
    terminalSizeRef.current = { cols, rows };
    invoke("resize_pty", { taskId, cols, rows }).catch(console.error);
  }, []);

  /** 取某任务的旧屏幕记录：只读一次，之后走内存里的那份。 */
  const loadScreenRecord = useCallback(
    async (taskId: string, context: TaskScreenContext): Promise<string> => {
      const cached = restoredPrefixRef.current[taskId];
      if (cached !== undefined) return cached;
      const existing = await invoke<string | null>("load_task_screen", {
        projectId: context.projectId,
        taskId,
      }).catch(() => null);
      const prefix = existing ?? "";
      restoredPrefixRef.current[taskId] = prefix;
      return prefix;
    },
    [],
  );

  const handleRegisterTerminal = useCallback(
    (taskId: string, fn: TerminalWriteFn | null): number => {
      const state = resetTerminalWriteState(taskId);
      if (fn) {
        terminalWriteRefs.current[taskId] = fn;
        // 任务已经不在跑（重启后、或异常中断）：把落盘的屏幕回放上来——这就是「关掉
        // 之后还能看到上次内容」。仍在跑的任务不回放，否则会与实时输出叠在一起。
        const context = resolveTaskContextRef.current?.(taskId);
        const buffered = taskBufferRef.current[taskId];
        const hasBufferedOutput = !!buffered && buffered.chunks.length > 0;
        if (context && !hasBufferedOutput) {
          loadScreenRecord(taskId, context)
            .then((screen) => {
              if (screen && terminalWriteRefs.current[taskId] === fn) fn(screen);
            })
            .catch(() => {});
        }
      } else {
        delete terminalWriteRefs.current[taskId];
      }
      return state.generation;
    },
    [resetTerminalWriteState],
  );

  const handleTerminalReady = useCallback((taskId: string, generation: number) => {
    const state = terminalWriteStateRef.current[taskId];
    if (!state || state.generation !== generation) return;
    state.ready = true;
    if (state.pending.length > 0) {
      const writeFn = terminalWriteRefs.current[taskId];
      if (writeFn) {
        const data = state.pending.length === 1 ? state.pending[0] : state.pending.join("");
        writeFn(data);
      }
      state.pending = [];
    }
  }, []);

  const handleSnapshot = useCallback((taskId: string, snapshot: string) => {
    const buf = taskBufferRef.current[taskId];
    const state = terminalWriteStateRef.current[taskId];
    const pendingLen = state?.pending.reduce((s, c) => s + c.length, 0) ?? 0;
    terminalSnapshotRef.current[taskId] = {
      snapshot,
      bufferLength: buf ? Math.max(0, getBufferAbsLen(buf) - pendingLen) : 0,
    };
  }, []);

  // 定期把每个任务的输出「尾部」落盘。放在输出管线这一层而不是终端组件里，后台未挂载的
  // 任务也一样被保存；应用退出时来不及做任何事，靠这个兜住「重启后还能看到上次屏幕」。
  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        const buffers = taskBufferRef.current;
        for (const [taskId, buf] of Object.entries(buffers)) {
          if (!buf || buf.chunks.length === 0) continue;
          const absLen = getBufferAbsLen(buf);
          if (screenSavedRef.current[taskId] === absLen) continue; // 没有新输出
          const context = resolveTaskContextRef.current?.(taskId);
          if (!context) continue;
          screenSavedRef.current[taskId] = absLen;
          const tail = joinBufferFrom(buf, Math.max(0, absLen - SCREEN_TAIL_BYTES));
          if (!tail) continue;
          // 旧记录拼在前面：恢复出来的终端上看到的就是「旧屏幕 + 新输出」，落盘保持一致
          const prefix = await loadScreenRecord(taskId, context);
          const content = (prefix + tail).slice(-SCREEN_TAIL_BYTES);
          invoke("save_task_screen", {
            projectId: context.projectId,
            taskId,
            content,
          }).catch(() => {});
        }
      })();
    }, SCREEN_SAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const getTaskRestoreState = useCallback((taskId: string) => {
    const buf = taskBufferRef.current[taskId];
    const snapshotState = terminalSnapshotRef.current[taskId];

    if (!buf) return { initialData: "" };

    if (!snapshotState?.snapshot) {
      return { initialData: buf.chunks.join("") };
    }

    const absLen = getBufferAbsLen(buf);
    if (snapshotState.bufferLength < 0 || snapshotState.bufferLength > absLen) {
      return { initialData: buf.chunks.join("") };
    }

    return {
      initialSnapshot: snapshotState.snapshot,
      initialData: joinBufferFrom(buf, snapshotState.bufferLength),
    };
  }, []);

  return {
    terminalSizeRef,
    resetTaskTerminal,
    removeTaskBuffers,
    writeErrorToTerminal,
    handleInput,
    handleResize,
    handleRegisterTerminal,
    handleTerminalReady,
    handleSnapshot,
    getTaskRestoreState,
    createOutputChannel,
  };
}
