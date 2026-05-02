import { useEffect, useState } from "react";

export const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;

const STORAGE_PREFIX = "deQualityPortal.pageSize.";

/**
 * Per-page page-size state. Persisted in localStorage under a `scope` key so
 * each page (failures, rca, etc.) remembers its own setting independently.
 */
export function usePageSize(
  scope: string,
  fallback: number = DEFAULT_PAGE_SIZE
): [number, (n: number) => void] {
  const key = `${STORAGE_PREFIX}${scope}`;
  const [size, setSize] = useState<number>(() => {
    if (typeof window === "undefined") return fallback;
    const saved = Number(window.localStorage.getItem(key));
    return PAGE_SIZE_OPTIONS.includes(saved as 10 | 20 | 30 | 50 | 100)
      ? saved
      : fallback;
  });

  useEffect(() => {
    window.localStorage.setItem(key, String(size));
  }, [key, size]);

  return [size, setSize];
}

/** Slice an array for pagination. 1-indexed page. */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
