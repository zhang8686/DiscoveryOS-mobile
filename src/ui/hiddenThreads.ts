// Threads the user chose to hide from a list ("隐藏该贴" on a long press). Kept across restarts.
// This replaces the old global "hide pinned" switch, whose "pinned" guess (from last-reply times)
// was wrong on a by-post-time page; hiding a specific thread is unambiguous.
import { signal, Storage } from "nsh";

const KEY = "hidden-threads";
const hiddenIds = signal<Set<string>>(new Set());
let started = false;

function start(): void {
  if (started) return;
  started = true;
  Storage.getItem(KEY)
    .then((v) => {
      if (!v) return;
      try {
        const list = JSON.parse(v);
        if (Array.isArray(list)) hiddenIds.set(new Set(list.filter((x): x is string => typeof x === "string")));
      } catch { /* a corrupt value is ignored */ }
    })
    .catch(() => undefined);
}

/** Whether the thread is hidden from the lists. Reads the signal, so a `computed` list re-runs. */
export function isHidden(tid: string): boolean {
  start();
  return hiddenIds().has(tid);
}

/** Hides the thread from the lists (persisted). */
export function hideThread(tid: string): void {
  start();
  const next = new Set(hiddenIds());
  next.add(tid);
  hiddenIds.set(next);
  void Storage.setItem(KEY, JSON.stringify([...next])).catch(() => undefined);
}

/** Shows a hidden thread again. */
export function unhideThread(tid: string): void {
  start();
  const next = new Set(hiddenIds());
  next.delete(tid);
  hiddenIds.set(next);
  void Storage.setItem(KEY, JSON.stringify([...next])).catch(() => undefined);
}
