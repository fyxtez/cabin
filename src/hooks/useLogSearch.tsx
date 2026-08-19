import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

export function useLogSearch(logs: string, logsLoading: boolean, enabled: boolean) {
  const [searchQuery, setSearchQueryState] = useState("");
  const [currentMatch, setCurrentMatch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const logsContainerRef = useRef<HTMLPreElement>(null);
  const matchRefs = useRef(new Map<number, HTMLElement>());

  const matchOffsets = useMemo(() => {
    if (!searchQuery) return [];
    const source = logs.toLocaleLowerCase();
    const query = searchQuery.toLocaleLowerCase();
    const offsets: number[] = [];
    let cursor = 0;
    while (cursor <= source.length - query.length) {
      const found = source.indexOf(query, cursor);
      if (found === -1) break;
      offsets.push(found);
      cursor = found + Math.max(query.length, 1);
    }
    return offsets;
  }, [logs, searchQuery]);

  const highlightedLogs = useMemo(() => {
    if (!searchQuery || matchOffsets.length === 0) return logs;
    const pieces: React.ReactNode[] = [];
    let cursor = 0;
    matchOffsets.forEach((offset, index) => {
      pieces.push(logs.slice(cursor, offset));
      pieces.push(
        <mark
          className={index === currentMatch ? "current-match" : ""}
          key={`${offset}-${index}`}
          ref={(element) => {
            if (element) matchRefs.current.set(index, element);
            else matchRefs.current.delete(index);
          }}
        >
          {logs.slice(offset, offset + searchQuery.length)}
        </mark>,
      );
      cursor = offset + searchQuery.length;
    });
    pieces.push(logs.slice(cursor));
    return pieces;
  }, [currentMatch, logs, matchOffsets, searchQuery]);

  useEffect(() => {
    // Feature: fresh log output starts at the newest journal entry when search is inactive.
    if (!logsLoading && !searchQuery && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, logsLoading, searchQuery]);

  useEffect(() => {
    if (matchOffsets.length === 0) {
      setCurrentMatch(0);
      return;
    }
    if (currentMatch >= matchOffsets.length) setCurrentMatch(0);
  }, [currentMatch, matchOffsets.length]);

  useEffect(() => {
    matchRefs.current.get(currentMatch)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentMatch, highlightedLogs]);

  useEffect(() => {
    if (!enabled) return;
    // Feature: Cmd/Ctrl+F focuses Cabin's in-app journal search instead of WebView browser search.
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [enabled]);

  function moveMatch(direction: 1 | -1) {
    if (matchOffsets.length === 0) return;
    setCurrentMatch((value) => (value + direction + matchOffsets.length) % matchOffsets.length);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      moveMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      clearSearch();
      searchInputRef.current?.blur();
    }
  }

  function setSearchQuery(value: string) {
    setSearchQueryState(value);
    setCurrentMatch(0);
  }

  function clearSearch() {
    setSearchQueryState("");
    setCurrentMatch(0);
  }

  return {
    searchQuery,
    currentMatch,
    matchOffsets,
    highlightedLogs,
    searchInputRef,
    logsContainerRef,
    setSearchQuery,
    clearSearch,
    moveMatch,
    handleSearchKeyDown,
  };
}
