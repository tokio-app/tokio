import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  MyInstantsSound,
} from "@/common/types";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * MyInstants search with infinite scroll. Starts with trending sounds once
 * first `active`, and loads the next page when `sentinelRef` scrolls into view
 * inside `listRef` while `active`.
 */
export function useSoundSearch(active: boolean) {
  // Query of the results being shown
  const [activeQuery, setActiveQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sounds, setSounds] = useState<MyInstantsSound[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(true);
  // Message of the last request's failure
  const [error, setError] = useState<string | null>(null);

  // Latest request, so responses to older ones are ignored
  const request = useRef({ query: "", page: 1 });
  const started = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const load = useCallback((query: string, p: number) => {
    request.current = { query, page: p };
    setLoading(true);
    setError(null);
    window.api.emit(APP_EVENTS.SEARCH_SOUNDS, { query, page: p });
  }, []);

  const search = (query: string) => {
    setActiveQuery(query);
    listRef.current?.scrollTo({ top: 0 });
    load(query, 1);
  };

  const retry = () => load(request.current.query, request.current.page);

  useEffect(() => {
    const removeSearchSounds = window.api.on(
      APP_EVENTS_RESPONSE.SEARCH_SOUNDS,
      (res) => {
        const req = request.current;
        if (!res || res.query !== req.query || res.page !== req.page) return;

        setLoading(false);

        // Keeps the page, so a retry loads the one that failed.
        if (!res.success) {
          setError(res.error?.message ?? "Unable to reach MyInstants.");
          // A new search's failure shouldn't show the last search's results.
          if (res.page === 1) setSounds([]);
          return;
        }

        setPage(res.page);
        setHasNextPage(res.hasNextPage);
        setSounds((prev) => {
          if (res.page === 1) return res.data;
          const seen = new Set(prev.map((s) => s.url));
          return [...prev, ...res.data.filter((s) => !seen.has(s.url))];
        });
      },
    );

    return () => {
      removeSearchSounds();
    };
  }, []);

  // Not when the picker opens on another tab
  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    load("", 1);
  }, [active, load]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    // After a failure, only the retry button loads again.
    if (!sentinel || !active || loading || error || !hasNextPage) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) load(activeQuery, page + 1);
      },
      { root: listRef.current, rootMargin: "120px" },
    );
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [active, loading, error, hasNextPage, activeQuery, page, load]);

  return { sounds, loading, error, search, retry, listRef, sentinelRef };
}
