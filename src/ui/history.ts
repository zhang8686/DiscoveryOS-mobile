// The threads the user has opened, kept in the app's storage on this device so the History
// list can show them. Newest first, one entry per thread, and capped at LIMIT entries.
import { Storage, signal } from "nsh";
import type { Post } from "../discuz/parse";
import type { HistoryEntry } from "./historyGroups";

const KEY = "history";
const LIMIT = 200;

export const historyEntries = signal<HistoryEntry[]>([]);
// Set once the history changes in this run, so a read from storage that finishes late
// does not overwrite a newer history.
let changedThisRun = false;

// Keeps only the entries that have the fields a row shows; anything else in storage is dropped.
function fromStorage(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const out: HistoryEntry[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const e = v as Partial<HistoryEntry>;
    const p = e.post as Partial<Post> | undefined;
    if (!p || typeof p.id !== "string" || typeof p.title !== "string" || typeof e.viewed !== "number") continue;
    out.push({ post: p as Post, viewed: e.viewed });
  }
  return out;
}

Storage.getItem(KEY)
  .then((saved) => {
    if (changedThisRun || !saved) return;
    historyEntries.set(fromStorage(JSON.parse(saved)));
  })
  .catch(() => undefined);

function save(list: HistoryEntry[]) {
  historyEntries.set(list);
  changedThisRun = true;
  Storage.setItem(KEY, JSON.stringify(list)).catch(() => undefined);
}

/** Records a thread as opened now: it moves to the top of the history, once. The row fields
 * are kept as the list showed them; a reply's excerpt and a pin do not belong in the history. */
export function recordView(post: Post, now: number = Date.now()): void {
  const kept: Post = {
    id: post.id,
    title: post.title,
    uid: post.uid,
    author: post.author,
    at: post.at,
    replies: post.replies,
    views: post.views,
    lastReplyBy: post.lastReplyBy,
    lastReplyAt: post.lastReplyAt,
    fid: post.fid,
  };
  const rest = historyEntries().filter((e) => e.post.id !== post.id);
  save([{ post: kept, viewed: now }, ...rest].slice(0, LIMIT));
}

/** Whether a thread has been opened before. Tracked: the thread list greys
 * a row as soon as `recordView` adds it to the history. */
// A virtualized list asks once per visible row on every render. Build the id
// set once per history change instead of scanning 200 entries per row.
let viewedSource: HistoryEntry[] | null = null;
let viewedIds = new Set<string>();
export function isViewed(id: string): boolean {
  const entries = historyEntries();
  if (viewedSource !== entries) {
    viewedSource = entries;
    viewedIds = new Set(entries.map((e) => e.post.id));
  }
  return viewedIds.has(id);
}

// The reply count each thread had when it was last opened: what the list subtracts to say how many
// replies came after. Built once per history change, as the viewed set is.
let countsSource: HistoryEntry[] | null = null;
let countsById = new Map<string, number>();

function viewedCounts(): Map<string, number> {
  const entries = historyEntries();
  if (countsSource !== entries) {
    countsSource = entries;
    countsById = new Map(entries.flatMap((e) => (e.post.replies === undefined ? [] : [[e.post.id, e.post.replies] as [string, number]])));
  }
  return countsById;
}

/**
 * How many replies a thread gained since the user last opened it: 0 for a thread never opened (no
 * count to compare), one whose page gives no count, or one that gained none.
 */
export function newRepliesSinceView(id: string, replies: number | undefined): number {
  if (replies === undefined) return 0;
  const before = viewedCounts().get(id);
  if (before === undefined) return 0;
  return Math.max(0, replies - before);
}

/** Empties the history. */
export function clearHistory(): void {
  save([]);
}
