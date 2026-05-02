import { useCallback, useEffect, useState } from "react";

const SESSION_PREFIX = "deQualityPortal.session.";
const LOCAL_PREFIX = "deQualityPortal.local.";

function readJson<T>(storage: Storage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or disabled storage — ignore */
  }
}

/**
 * State that survives in-app navigation (filters, current page, active tab,
 * view toggles) but resets when the tab is closed. Backed by sessionStorage.
 *
 * `scope` should be unique per state slot, e.g. "failures.filters".
 */
export function useSessionState<T>(
  scope: string,
  initial: T
): [T, (next: T | ((prev: T) => T)) => void, () => void] {
  const key = `${SESSION_PREFIX}${scope}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    return readJson<T>(window.sessionStorage, key, initial);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    writeJson(window.sessionStorage, key, value);
  }, [key, value]);

  const clear = useCallback(() => {
    if (typeof window !== "undefined") window.sessionStorage.removeItem(key);
    setValue(initial);
  }, [key, initial]);

  return [value, setValue, clear];
}

/**
 * Form drafts that should survive across navigation AND browser restarts
 * (so a half-written RCA doesn't vanish if the user accidentally closes the
 * tab). Caller is responsible for calling `clear()` on successful submit.
 */
export function useLocalDraft<T>(
  scope: string,
  initial: T
): [T, (next: T | ((prev: T) => T)) => void, () => void] {
  const key = `${LOCAL_PREFIX}${scope}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    return readJson<T>(window.localStorage, key, initial);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    writeJson(window.localStorage, key, value);
  }, [key, value]);

  const clear = useCallback(() => {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
    setValue(initial);
  }, [key, initial]);

  return [value, setValue, clear];
}
