// Unread counts for the personal section, read from the forum's own header.
//
// 4d4y runs Discuz 7.2-style pages: the logged-in index prints every kind of
// unread next to the account menu — 私人消息 / 公共消息 / 系统消息 / 好友消息 /
// 帖子消息, each as "名字 (N)". There is no JSON prompt endpoint, so we fetch a
// page and read the numbers, then fold them into the two badges the app shows:
//
//   私信      = 私人消息 + 公共消息        (短消息 未读总数)
//   我的主题  = 系统消息 + 好友消息 + 帖子消息  (提醒 未读总数)
import { request } from "./client";

export interface NoticeCounts {
  /** 短消息未读：私人消息 + 公共消息. -1 when neither count was on the page. */
  pm: number;
  /** 提醒未读：系统消息 + 好友消息 + 帖子消息. -1 when none were on the page. */
  notice: number;
}

const PRIVATE = /私人消息\s*\((\d+)\)/;
const PUBLIC = /公共消息\s*\((\d+)\)/;
const SYSTEM = /系统消息\s*\((\d+)\)/;
const FRIEND = /好友消息\s*\((\d+)\)/;
const THREAD = /帖子消息\s*\((\d+)\)/;

function num(re: RegExp, html: string): number {
  const m = re.exec(html);
  return m ? Number(m[1]) : -1;
}

/** The two aggregated unread counts on a page, or null when none were present. */
export function parseNoticeCounts(html: string): NoticeCounts | null {
  const priv = num(PRIVATE, html);
  const pub = num(PUBLIC, html);
  const sys = num(SYSTEM, html);
  const fri = num(FRIEND, html);
  const thr = num(THREAD, html);
  // A group is known when at least one of its counts is on the page; an unknown
  // member then counts as 0 (e.g. pm.php lists 私人消息 but not 公共消息).
  const pm = priv < 0 && pub < 0 ? -1 : Math.max(priv, 0) + Math.max(pub, 0);
  const notice = sys < 0 && fri < 0 && thr < 0 ? -1 : Math.max(sys, 0) + Math.max(fri, 0) + Math.max(thr, 0);
  if (pm < 0 && notice < 0) return null;
  return { pm, notice };
}

/** Reads the counts, trying the index first (it carries all five) and falling
 * back to notice.php (提醒) and pm.php (短消息) so one blocked page cannot hide
 * the other badge. Returns null on total failure so the caller keeps what it had
 * (no badge flashes to 0). */
export async function loadNoticeCounts(): Promise<NoticeCounts | null> {
  let pm = -1;
  let notice = -1;
  for (const path of ["", "notice.php", "pm.php?filter=privatepm"]) {
    if (pm >= 0 && notice >= 0) break;
    try {
      const counts = parseNoticeCounts(await request("GET", path));
      if (!counts) continue;
      if (pm < 0 && counts.pm >= 0) pm = counts.pm;
      if (notice < 0 && counts.notice >= 0) notice = counts.notice;
    } catch {
      /* try the next page */
    }
  }
  if (pm < 0 && notice < 0) return null;
  return { pm, notice };
}
