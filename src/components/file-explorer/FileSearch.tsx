import * as Popover from "@radix-ui/react-popover";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown, Filter, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import s from "../../styles";
import { useI18n } from "../../i18n";
import { FileIcon } from "../FileIcon";
import type { ProjectFileSearchResult } from "./types";

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 80;

interface FileFilter {
  id: string;
  label?: string;
  labelKey?: string;
  extensions: string[];
}

const FILE_FILTERS: FileFilter[] = [
  { id: "ts", label: "TS", extensions: ["ts", "tsx"] },
  { id: "js", label: "JS", extensions: ["js", "jsx", "mjs", "cjs"] },
  { id: "rust", label: "Rust", extensions: ["rs"] },
  { id: "py", label: "Python", extensions: ["py"] },
  { id: "go", label: "Go", extensions: ["go"] },
  { id: "cpp", label: "C/C++", extensions: ["c", "h", "cpp", "cc", "cxx", "hpp", "hh", "hxx"] },
  { id: "web", label: "Web", extensions: ["html", "css", "scss"] },
  { id: "json", label: "JSON", extensions: ["json", "jsonc"] },
  { id: "yaml", label: "YAML", extensions: ["yml", "yaml"] },
  { id: "md", label: "Markdown", extensions: ["md", "mdx"] },
  { id: "config", labelKey: "file.searchConfigTypes", extensions: ["toml", "ini", "env"] },
  {
    id: "image",
    labelKey: "file.searchImageTypes",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
  },
];

function filterLabel(filter: FileFilter, t: ReturnType<typeof useI18n>["t"]) {
  return filter.labelKey ? t(filter.labelKey) : (filter.label ?? filter.id);
}

/**
 * 文件名 + 文件类型两个条件的搜索状态。类型多选,空选即「全部」——
 * 传给后端的就是选中项 extensions 的并集,空数组表示不按类型过滤。
 */
export function useFileSearch(
  projectPath: string,
  onOpenResult: (result: ProjectFileSearchResult) => void,
) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [results, setResults] = useState<ProjectFileSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const requestIdRef = useRef(0);
  // 回车打开结果:回调身份每个 render 都可能变,存 ref 里避免把它塞进 effect 依赖。
  const onOpenRef = useRef(onOpenResult);
  onOpenRef.current = onOpenResult;

  const extensions = useMemo(
    () =>
      FILE_FILTERS.filter((filter) => selectedIds.includes(filter.id)).flatMap(
        (filter) => filter.extensions,
      ),
    [selectedIds],
  );
  const queryText = query.trim();
  const searchActive = queryText.length > 0 || extensions.length > 0;

  // 切换项目时清空条件,避免上一个项目的过滤条件静默套在新项目上。
  useEffect(() => {
    setQuery("");
    setSelectedIds([]);
  }, [projectPath]);

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (!searchActive) {
      setResults([]);
      setLoading(false);
      setError(null);
      setActiveIndex(0);
      return;
    }

    setLoading(true);
    setResults([]);
    setActiveIndex(0);
    setError(null);
    const timer = window.setTimeout(() => {
      invoke<ProjectFileSearchResult[]>("search_project_files", {
        projectPath,
        query: queryText,
        extensions,
        limit: SEARCH_LIMIT,
      })
        .then((nextResults) => {
          if (requestId !== requestIdRef.current) return;
          setResults(nextResults);
          setActiveIndex(0);
        })
        .catch((err: unknown) => {
          if (requestId !== requestIdRef.current) return;
          setResults([]);
          setError(String(err));
        })
        .finally(() => {
          if (requestId === requestIdRef.current) {
            setLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [extensions, projectPath, queryText, searchActive]);

  const toggleType = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }, []);

  const selectAllTypes = useCallback(() => setSelectedIds([]), []);

  const clear = useCallback(() => {
    setQuery("");
    setSelectedIds([]);
  }, []);

  const openActive = useCallback(() => {
    const result = results[activeIndex];
    if (result) onOpenRef.current(result);
  }, [activeIndex, results]);

  return {
    query,
    setQuery,
    selectedIds,
    toggleType,
    selectAllTypes,
    extensions,
    searchActive,
    results,
    loading,
    error,
    activeIndex,
    setActiveIndex,
    clear,
    openActive,
  };
}

export type FileSearchState = ReturnType<typeof useFileSearch>;

export function FileSearchBar({ search }: { search: FileSearchState }) {
  const { t } = useI18n();
  const firstSelected = FILE_FILTERS.find((filter) => filter.id === search.selectedIds[0]);
  const typeLabel =
    search.selectedIds.length === 0 || !firstSelected
      ? t("file.searchAllTypes")
      : search.selectedIds.length === 1
        ? filterLabel(firstSelected, t)
        : `${filterLabel(firstSelected, t)} +${search.selectedIds.length - 1}`;

  return (
    <div style={s.fileSearchBar}>
      <div style={s.fileSearchBox}>
        <Search size={13} style={s.fileSearchIcon} />
        <input
          value={search.query}
          onChange={(event) => search.setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              search.clear();
              event.preventDefault();
              return;
            }
            if (search.loading || search.results.length === 0) return;
            if (event.key === "ArrowDown") {
              search.setActiveIndex(Math.min(search.results.length - 1, search.activeIndex + 1));
              event.preventDefault();
            } else if (event.key === "ArrowUp") {
              search.setActiveIndex(Math.max(0, search.activeIndex - 1));
              event.preventDefault();
            } else if (event.key === "Enter") {
              search.openActive();
              event.preventDefault();
            }
          }}
          placeholder={t("file.searchPlaceholder")}
          style={s.fileSearchInput}
        />
        {search.searchActive && (
          <button
            type="button"
            title={t("common.clear")}
            aria-label={t("common.clear")}
            onClick={search.clear}
            style={s.fileSearchClearBtn}
          >
            <X size={12} />
          </button>
        )}
      </div>

      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" aria-label={t("file.searchTypeFilter")} style={s.fileSearchTypeBox}>
            <Filter size={13} style={s.fileSearchIcon} />
            <span style={s.fileSearchTypeValue}>{typeLabel}</span>
            <ChevronDown size={12} style={s.fileSearchTypeChevron} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={4}
            style={s.fileSearchTypeContent}
          >
            <button
              type="button"
              className="branch-popover-item"
              onClick={search.selectAllTypes}
            >
              <span className="branch-popover-item-name">{t("file.searchAllTypes")}</span>
              {search.selectedIds.length === 0 && (
                <Check
                  size={12}
                  strokeWidth={2.5}
                  color="var(--accent)"
                  style={s.repoSelectorCheck}
                />
              )}
            </button>
            <div style={s.fileSearchTypeSeparator} />
            <div style={s.fileSearchTypeList}>
              {FILE_FILTERS.map((filter) => {
                const selected = search.selectedIds.includes(filter.id);
                return (
                  <button
                    key={filter.id}
                    type="button"
                    className="branch-popover-item"
                    onClick={() => search.toggleType(filter.id)}
                  >
                    <span className="branch-popover-item-name">{filterLabel(filter, t)}</span>
                    {selected && (
                      <Check
                        size={12}
                        strokeWidth={2.5}
                        color="var(--accent)"
                        style={s.repoSelectorCheck}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

export function FileSearchResults({
  search,
  onOpen,
}: {
  search: FileSearchState;
  onOpen: (result: ProjectFileSearchResult) => void;
}) {
  const { t } = useI18n();

  if (search.loading) {
    return <div style={s.fileSearchEmpty}>{t("common.loading")}</div>;
  }
  if (search.error) {
    return <div style={s.fileSearchEmpty}>{t("file.searchFailed", { error: search.error })}</div>;
  }
  if (search.results.length === 0) {
    return <div style={s.fileSearchEmpty}>{t("file.searchNoResults")}</div>;
  }

  return (
    <>
      {search.results.map((result, index) => (
        <button
          key={result.path}
          type="button"
          onMouseEnter={() => search.setActiveIndex(index)}
          onClick={() => onOpen(result)}
          style={{
            ...s.fileSearchResult,
            ...(search.activeIndex === index ? s.fileSearchResultActive : null),
          }}
        >
          <FileIcon name={result.name} ext={result.extension} isDir={false} isGitignored={false} />
          <span style={s.fileSearchResultMain}>
            <span style={s.fileSearchResultName}>{result.name}</span>
            {result.dir && <span style={s.fileSearchResultDir}>{result.dir}</span>}
          </span>
        </button>
      ))}
    </>
  );
}
