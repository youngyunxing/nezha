import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * 在一批**会话文件的正文**里搜 query —— 命中判据与回放一致（回放里能看到的那些消息）。
 * 任务的会话和「本地会话」都走这条：调用方把两边的路径凑成一个数组传进来。
 *
 * 后端一次调用扫一批（跑在 spawn_blocking 里、按 mtime 缓存解析结果），所以这里
 * 只需要防抖 + 只认最后一次请求。名字 / 提示词 / 命令那三个字段由列表同步匹配，
 * 不经过这里。
 */
export function useSessionSearch(
  sessionPaths: string[],
  query: string,
  options?: { debounceMs?: number },
) {
  const debounceMs = options?.debounceMs ?? 250;
  const [matchedPaths, setMatchedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [searching, setSearching] = useState(false);

  const paths = sessionPaths;
  // 数组每次都是新引用，用 join 出来的键当依赖，避免每次渲染都重搜
  const pathsKey = paths.join("\n");
  const pathsRef = useRef<string[]>(paths);
  pathsRef.current = paths;
  // 打字快时会有多个请求在飞：只认最后一次的返回
  const requestRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || pathsKey === "") {
      setMatchedPaths(new Set());
      setSearching(false);
      return;
    }
    const request = ++requestRef.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      invoke<string[]>("search_session_texts", {
        sessionPaths: pathsRef.current,
        query: trimmed,
      })
        .then((hits) => {
          if (requestRef.current !== request) return;
          setMatchedPaths(new Set(hits));
        })
        .catch(() => {
          if (requestRef.current !== request) return;
          setMatchedPaths(new Set());
        })
        .finally(() => {
          if (requestRef.current !== request) return;
          setSearching(false);
        });
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [pathsKey, query, debounceMs]);

  return { matchedPaths, searching };
}
