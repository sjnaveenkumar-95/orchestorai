import { useCallback, useEffect, useMemo, useState } from "react";

const DISMISSED_KEY = "orchestorai:inbox:dismissed";
const DISMISSED_EVENT = "orchestorai:inbox:dismissed-updated";
const SIDEBAR_DISMISS_PREFIXES = ["run:", "stale:", "alert:"];

function readDismissedValues(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(
        parsed
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean),
      ),
    );
  } catch {
    return [];
  }
}

function writeDismissedValues(values: Iterable<string>) {
  const unique = Array.from(
    new Set(
      Array.from(values)
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(unique));
  window.dispatchEvent(new Event(DISMISSED_EVENT));
}

export function listSidebarBadgeDismissedIds(values: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(values)
        .map((value) => String(value || "").trim())
        .filter((value) => SIDEBAR_DISMISS_PREFIXES.some((prefix) => value.startsWith(prefix))),
    ),
  ).sort();
}

export function useInboxDismissedItems() {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set(readDismissedValues()));

  const refresh = useCallback(() => {
    setDismissed(new Set(readDismissedValues()));
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === DISMISSED_KEY) {
        refresh();
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(DISMISSED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(DISMISSED_EVENT, refresh);
    };
  }, [refresh]);

  const dismiss = useCallback((id: string) => {
    const normalized = String(id || "").trim();
    if (!normalized) return;
    setDismissed((prev) => {
      if (prev.has(normalized)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(normalized);
      writeDismissedValues(next);
      return next;
    });
  }, []);

  const sidebarBadgeDismissedIds = useMemo(
    () => listSidebarBadgeDismissedIds(dismissed),
    [dismissed],
  );
  const sidebarBadgeDismissedSignature = useMemo(
    () => sidebarBadgeDismissedIds.join("|"),
    [sidebarBadgeDismissedIds],
  );

  return {
    dismissed,
    dismiss,
    sidebarBadgeDismissedIds,
    sidebarBadgeDismissedSignature,
  };
}
