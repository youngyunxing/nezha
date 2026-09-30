import { useRef, useCallback, useEffect } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { trimPromptNoise } from "../screenRecord";
import { TERMINAL_INPUT_MODE_RESET } from "../components/terminalShared";

// ── Buffer constants ─────────────────────────────────────────────────────────

const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB per task (in-memory limit)
const MAX_BUFFER_CHUNKS = 256; // compact when chunks array exceeds this
const DRAIN_FRAME_BUDGET = 128 * 1024; // 每帧最多处理 128KB，避免单帧写入时间过长
/** 屏幕落盘间隔与每次保留的尾部字节数：写整份缓冲太重，留尾部足够回放出最近的屏幕。 */
const SCREEN_SAVE_INTERVAL_MS = 15000;
/** 终端尺寸的初始默认值；等真实尺寸最多等这么久。 */
const DEFAULT_TERMINAL_COLS = 220;
const DEFAULT_TERMINAL_ROWS = 50;
const DEFAULT_SIZE_WAIT_MS = 240;
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

  /** 只复位终端的输入模式（鼠标上报等），不动缓冲区 —— 任务进程结束时用。 */
  const resetTerminalInputModes = useCallback((taskId: string) => {
    terminalWriteRefs.current[taskId]?.(TERMINAL_INPUT_MODE_RESET);
  }, []);

  const resetTaskTerminal = useCallback((taskId: string) => {
    taskBufferRef.current[taskId] = createTaskBuffer();
    delete terminalSnapshotRef.current[taskId];
    delete screenSavedRef.current[taskId];
    // 旧记录缓存也清掉：下一次落盘/回放会重新从磁盘读（此时读到的才是最新的那份）
    delete restoredPrefixRef.current[taskId];
    // 顺带把残留的鼠标上报模式关掉（本地写入 xterm，不进 PTY）
    terminalWriteRefs.current[taskId]?.(TERMINAL_INPUT_MODE_RESET);
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

  /** 等终端量出真实尺寸再 spawn（最多 DEFAULT_SIZE_WAIT_MS）。
   *  面板比 spawn 早一步就位：挂载后一帧内会 fit 并把真实 cols/rows 写进 terminalSizeRef。
   *  不等的话，PTY 会先拿到初始默认值 220×50，CLI 就按 220 列画了第一帧 —— 那个宽度远大于
   *  面板，会留在终端历史里（实测记录里能看到 220 / 156 / 87 / 39 六种宽度的边框线）。
   *  已经有真实尺寸（非默认值）或超时就照常返回。 */
  const waitForMeasuredSize = useCallback(async () => {
    const isDefaultSize = () =>
      terminalSizeRef.current.cols === DEFAULT_TERMINAL_COLS &&
      terminalSizeRef.current.rows === DEFAULT_TERMINAL_ROWS;
    if (!isDefaultSize()) return;
    const deadline = Date.now() + DEFAULT_SIZE_WAIT_MS;
    // rAF 在窗口被遮挡/隐藏时不会触发（应用的"隐藏到 Dock"、后台启动都算），
    // 所以每一步都拿 setTimeout 兜底 —— 否则这个 await 会永远挂着，任务再也起不来。
    const nextFrame = () =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 40);
        window.requestAnimationFrame(() => {
          window.clearTimeout(timer);
          resolve();
        });
      });
    while (Date.now() < deadline && isDefaultSize()) {
      await nextFrame();
    }
  }, []);

  /** PTY 建好之后重发一次当前尺寸。
   *  面板通常比 PTY 先就位：挂载 → fit → resize_pty，那一次会打在还没注册的 PTY 上被丢掉，
   *  于是 CLI 按默认 220×50 画了第一屏（首屏换行错乱），要等下一次尺寸变化（切走再切回）
   *  才重排。spawn/resume 完成后再补一次，SIGWINCH 就会让它按真实宽度重画。 */
  const reapplyTerminalSize = useCallback((taskId: string) => {
    const { cols, rows } = terminalSizeRef.current;
    invoke("resize_pty", { taskId, cols, rows }).catch(() => {});
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
      // 剪掉尾部纯提示符重画：回放出来不再是一屏重复的提示符，落盘也不再攒噪声。
      const prefix = existing ? trimPromptNoise(existing) : "";
      restoredPrefixRef.current[taskId] = prefix;
      return prefix;
    },
    [],
  );

  /** 恢复纯终端任务前，把落盘的屏幕记录塞进输出缓冲区的最前面。
   *  必须抢在新 PTY 有输出之前塞：handleRegisterTerminal 看到「已有实时输出」会跳过回放
   *  （那是为了不在跑着的任务上重复铺屏），而新 shell 一启动就会吐提示符，不预塞就永远
   *  看不到旧内容。记录进缓冲区后，落盘时就不能再把它当 prefix 拼一遍，否则下次恢复两份。 */
  const seedTaskScreen = useCallback(
    async (taskId: string, context: TaskScreenContext) => {
      const screen = await loadScreenRecord(taskId, context);
      if (!screen) return;
      const buf = taskBufferRef.current[taskId] ?? createTaskBuffer();
      taskBufferRef.current[taskId] = buf;
      if (buf.totalLen > 0 || buf.droppedLen > 0) return; // 已经有实时输出，不插队
      pushToBuffer(buf, screen);
      restoredPrefixRef.current[taskId] = "";
    },
    [loadScreenRecord],
  );

  const handleRegisterTerminal = useCallback(
    (taskId: string, fn: TerminalWriteFn | null): number => {
      const state = resetTerminalWriteState(taskId);
      if (fn) {
        terminalWriteRefs.current[taskId] = fn;
        // 进程已经不在了才回放落盘屏幕（比如打开一个早就结束、没有会话可重画的终端）。
        // 判据不能用「还没有实时输出」：CLI/shell 启动有几十毫秒空窗，注册正好落在空窗里
        // 就会先把旧记录铺上，随后被 agent 自己重画的历史盖成两份。跑着的任务里，
        // 纯终端的旧内容由 seedTaskScreen 预塞进缓冲区、agent 的 TUI 自己会在 --resume
        // 时重画历史，都不需要这里再回放。
        const context = resolveTaskContextRef.current?.(taskId);
        const buffered = taskBufferRef.current[taskId];
        const hasBufferedOutput = !!buffered && buffered.chunks.length > 0;
        if (context && !context.live && !hasBufferedOutput) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖有意收敛，加进去会重复订阅
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
          const content = trimPromptNoise((prefix + tail).slice(-SCREEN_TAIL_BYTES));
          invoke("save_task_screen", {
            projectId: context.projectId,
            taskId,
            content,
          }).catch(() => {});
        }
      })();
    }, SCREEN_SAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖有意收敛，加进去会重复订阅
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
    resetTerminalInputModes,
      resetTaskTerminal,
    removeTaskBuffers,
    writeErrorToTerminal,
    handleInput,
    handleResize,
    reapplyTerminalSize,
    waitForMeasuredSize,
    handleRegisterTerminal,
    seedTaskScreen,
    handleTerminalReady,
    handleSnapshot,
    getTaskRestoreState,
    createOutputChannel,
  };
}
