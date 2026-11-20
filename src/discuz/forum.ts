// The forum pages: the channel list and a channel's thread list.
import { currentFormHash, currentUser, findFloor, isLoginRequired, pageSize, request } from "./client";
import { parseBookmarks, parseChannels, parseChannelLinks, parseMyReplies, parseMyThreads, parsePmConversation, parsePmUsers, parsePosts, parseProfile, parseReplies, parseSearchResults, parseThreadPageInfo, parseUser, type Author, type Channel, type PmMessage, type Post, type Profile, type Reply } from "./parse";
import { formEncodeGb, htmlEntities } from "./encoding";
import { BUILTIN_CHANNELS, mergeChannels } from "./channels";

/** Preview-only sample data. The release APK sets DEMO to false. */
export const DEMO = false;
/**
 * index.php is behind Cloudflare Managed Challenge. Other Discuz pages are served,
 * so use the built-in channel list and enrich it from a served page when possible.
 */
export async function loadChannels(): Promise<Channel[]> {
  if (DEMO) return mergeChannels(BUILTIN_CHANNELS.map((c) => ({ ...c })));
  // Signed in, index.php is served (Cloudflare only challenges guests) and gives
  // every channel with its description and today's new-post count.
  try {
    const html = await request("GET", "index.php", { retry: false });
    const found = parseChannels(html);
    if (found.length > 0) return mergeChannels(found);
  } catch { /* fall through */ }
  // Guests: take the channel links from a forum page that is always served.
  try {
    const html = await request("GET", "forumdisplay.php", { query: [["fid", "2"]], retry: false });
    const found = parseChannelLinks(html);
    if (found.length > 0) return mergeChannels(found);
  } catch { /* fall through */ }
  return BUILTIN_CHANNELS.map((c) => ({ ...c }));
}

/** Sort by thread start ("dateline") or last reply ("lastpost"), newest first. */
export type SortOrder = "dateline" | "lastpost";

export async function loadPosts(fid: string, page = 1, order: SortOrder = "lastpost"): Promise<Post[]> {
  if (DEMO) return []; // demo data removed; the release build never takes this branch
  // Match the forum's web sort exactly (the URLs the user supplied):
  //   post time  -> forumdisplay.php?fid=2&filter=&orderby=dateline
  //   reply time -> forumdisplay.php?fid=2&filter=2592000&orderby=lastpost
  // `filter=2592000` is the 30-day window the site applies to the reply-time order. The web
  // URLs send no `ascdesc`, so this sends none either: the site's own default for both
  // orders is newest first, and adding `ascdesc` risks a different result.
  const query: [string, string][] = [
    ["fid", fid],
    ["page", String(page)],
    ["orderby", order],
    ["filter", order === "lastpost" ? "2592000" : ""],
    // A full page (the forum's own per-page setting, 50 here) arrives in one round-trip, so the
    // next one can be fetched while the reader is still well short of the list's end.
    ["ppp", String(pageSize)],
  ];
  const html = await request("GET", "forumdisplay.php", { query });
  // The forum's own order is kept as returned — the same order its web page shows. The 微信模式
  // reference script (which the user pointed to) trusts `orderby` and never re-sorts. `dateline`
  // already comes newest-thread-first to the MINUTE. The parse is told the order so a dateline page
  // does not get the lastpost-only "pinned" guess (which hid the newest threads).
  return parsePosts(html, order);
}

/**
 * The threads whose titles contain `keyword`, in every channel (`search.php`,
 * newest reply first). The site answers signed-out searches with a notice, not
 * a list, so that is reported as a sign-in error. The site returns one page.
 */
export async function searchThreads(keyword: string): Promise<Post[]> {
  const html = await request("GET", "search.php", {
    query: [
      ["srchtype", "title"],
      ["srchtxt", keyword],
      ["searchsubmit", "true"],
      ["st", "on"],
      ["srchuname", ""],
      ["srchfilter", "all"],
      ["srchfrom", "0"],
      ["before", ""],
      ["orderby", "lastpost"],
      ["ascdesc", "desc"],
    ],
  });
  if (html.includes("您还未登录")) throw new Error(currentUser() ? "搜索需要重新登录" : "登录后才能搜索");
  const posts = parseSearchResults(html);
  return posts;
}

type ReplyPage = { title?: string; fid?: string; lastPage?: number; replies: Reply[] };

// A thread page is reused for this long, so opening the same thread again does not ask the forum again.
const REPLY_PAGE_TTL_MS = 10 * 60 * 1000;
// The most pages kept: a parsed page carries every reply's full HTML body, so it is by far
// the largest thing the app caches. 32 pages already covers several long threads at once;
// the oldest quarter is evicted past the limit, and stale entries are dropped on every store.
const REPLY_PAGE_LIMIT = 32;
const replyPageCache = new Map<string, { page: ReplyPage; at: number }>();
// Requests under way, by page: a second open while one is loading shares its answer.
const replyPageInFlight = new Map<string, Promise<ReplyPage>>();
// Bumped on every clear, so a request started before it does not store its page after it.
let replyPageGeneration = 0;
// Bumped per thread by `clearThreadReplyPages`, so a page of that thread asked before the
// change is not stored after it.
const threadGenerations = new Map<string, number>();

/** Stores a freshly loaded page, dropping stale pages and evicting the oldest past the limit. */
function storeReplyPage(key: string, page: ReplyPage): void {
  const now = Date.now();
  // An expired page can no longer be served, but it would otherwise keep its full
  // reply bodies in memory until a size eviction (or a sign-out) happened to run.
  for (const [k, entry] of replyPageCache) {
    if (now - entry.at >= REPLY_PAGE_TTL_MS) replyPageCache.delete(k);
  }
  replyPageCache.set(key, { page, at: now });
  if (replyPageCache.size <= REPLY_PAGE_LIMIT) return;
  const drop = Math.floor(REPLY_PAGE_LIMIT / 4);
  const oldest = [...replyPageCache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [k] of oldest.slice(0, drop)) replyPageCache.delete(k);
}

/**
 * Forgets every cached thread page. Replies differ by account, so this runs on sign-in and sign-out.
 */
export function clearReplyPageCache(): void {
  replyPageGeneration++;
  replyPageCache.clear();
  replyPageInFlight.clear();
}

/** The cache keys (`tid:page`) of thread `tid` among `keys`: all of its pages. */
export function threadPageKeys(keys: Iterable<string>, tid: string): string[] {
  return [...keys].filter((key) => key.split(":")[0] === tid);
}

/**
 * Forgets every cached page of the thread, and the requests for them under way. A reply, an
 * edit or a delete changes any page of the thread, so all of them are asked again.
 */
export function clearThreadReplyPages(tid: string): void {
  threadGenerations.set(tid, (threadGenerations.get(tid) ?? 0) + 1);
  for (const key of threadPageKeys(replyPageCache.keys(), tid)) replyPageCache.delete(key);
  for (const key of threadPageKeys(replyPageInFlight.keys(), tid)) replyPageInFlight.delete(key);
}

/** A thread page's replies, with the thread's title and forum when the page names them. */
export function loadReplyPage(tid: string, page = 1, priority: "high" | "low" = "low"): Promise<ReplyPage> {
  const key = `${tid}:${page}`;
  const hit = replyPageCache.get(key);
  if (hit && Date.now() - hit.at < REPLY_PAGE_TTL_MS) return Promise.resolve({ ...hit.page, replies: [...hit.page.replies] });
  const pending = replyPageInFlight.get(key);
  if (pending) return pending;
  const generation = replyPageGeneration;
  const threadGeneration = threadGenerations.get(tid) ?? 0;
  const request = fetchReplyPage(tid, page, priority)
    .then((result) => {
      // Failures are not stored (they throw above), so the next open asks again. A request
      // whose in-flight entry was forgotten (a reply posted meanwhile) is not stored either.
      const current = generation === replyPageGeneration && threadGeneration === (threadGenerations.get(tid) ?? 0);
      if (current && replyPageInFlight.get(key) === request) storeReplyPage(key, result);
      return { ...result, replies: [...result.replies] };
    })
    .finally(() => {
      if (replyPageInFlight.get(key) === request) replyPageInFlight.delete(key);
    });
  replyPageInFlight.set(key, request);
  return request;
}

async function fetchReplyPage(tid: string, page: number, priority: "high" | "low" = "low"): Promise<ReplyPage> {
  if (DEMO) return { title: "帖子正文", fid: "2", replies: [] };
  const html = await request("GET", "viewthread.php", { query: [["tid", tid], ["page", String(page)]], priority });
  // Still the login page after the automatic sign-in (or with none): not a thread, so it fails.
  if (isLoginRequired(html)) throw new Error("阅读帖子需要登录");
  return { ...parseThreadPageInfo(html), replies: parseReplies(html) };
}

/** The thread page holding floor `pid` of thread `tid`, with its replies and the thread's title and forum. */
export async function loadFloorPage(tid: string, pid: string): Promise<{ page: number; title?: string; fid?: string; replies: Reply[] }> {
  const { html, page } = await findFloor(tid, pid);
  return { ...parseThreadPageInfo(html), page, replies: parseReplies(html) };
}

export async function loadReplies(tid: string, page = 1): Promise<Reply[]> {
  return (await loadReplyPage(tid, page)).replies;
}

export async function loadBookmarks(page = 1): Promise<Post[]> {
  return parseBookmarks(await request("GET", "my.php", { query: [["item", "favorites"], ["type", "thread"], ["page", String(page)]] }));
}

/** The threads the signed-in user started, newest first (`my.php?item=threads`). */
export async function loadMyThreads(page = 1): Promise<Post[]> {
  return parseMyThreads(await request("GET", "my.php", { query: [["item", "threads"], ["page", String(page)]] }));
}

/** The threads the signed-in user replied to, newest reply first (`my.php?item=posts`). */
export async function loadMyReplies(page = 1): Promise<Post[]> {
  return parseMyReplies(await request("GET", "my.php", { query: [["item", "posts"], ["page", String(page)]] }));
}

/** The correspondents in the private messages, one row each (`pm.php?filter=privatepm`). */
export async function loadPmUsers(page = 1): Promise<Post[]> {
  return parsePmUsers(await request("GET", "pm.php", { query: [["filter", "privatepm"], ["page", String(page)]] }));
}

/** The messages with one correspondent, all of them (`pm.php?uid=N`). */
export async function loadPmConversation(uid: string): Promise<PmMessage[]> {
  return parsePmConversation(await request("GET", "pm.php", { query: [["uid", uid], ["filter", "privatepm"], ["daterange", "5"]] }));
}

/**
 * Sends a private message to `uid` (`pm.php?action=send`), as the conversation's reply box
 * does, then reads the conversation back. `lastDay` is the day of the latest message shown
 * (`2026-6-24`), which the page sends along. Rejects when the new message is not in the
 * conversation after sending.
 */
export async function sendPm(uid: string, lastDay: string, content: string): Promise<PmMessage[]> {
  const hash = currentFormHash();
  if (!hash) throw new Error("尚未登录");
  const message = htmlEntities(content.replace(/\n/g, "\r\n"));
  await request("POST", `pm.php?action=send&uid=${uid}&pmsubmit=yes&infloat=yes&inajax=1`, {
    form: [["formhash", hash], ["handlekey", "pmreply"], ["lastdaterange", lastDay], ["message", message]],
  });
  const list = await loadPmConversation(uid);
  const first = htmlEntities(content.split("\n")[0].trim()).slice(0, 12);
  if (first && !list.some((m) => m.body.includes(first))) throw new Error("消息未能发送");
  return list;
}

/** Adds a thread to the favorites (`DiscuzAPI.bookmarkPost`). */
export async function bookmarkPost(tid: string): Promise<boolean> {
  const text = await request("GET", "my.php", { query: [["item", "favorites"], ["tid", tid], ["inajax", "1"], ["ajaxtarget", "favorite_msg"]] });
  return text.includes("此主题已成功添加到收藏夹中");
}

/** Removes a thread from the favorites (the site's own "remove" request). */
export async function removeBookmark(tid: string): Promise<boolean> {
  const text = await request("GET", "my.php", {
    query: [["item", "favorites"], ["action", "remove"], ["tid", tid], ["inajax", "1"], ["ajaxtarget", "favorite_msg"]],
  });
  return text.includes("此主题已成功从您的收藏夹中移除");
}

/** The user's UID and avatar (`DiscuzAPI.loadUser`). */
export async function loadUser(name: string): Promise<Author | undefined> {
  const html = await request("GET", "space.php", { query: [["username", name]] });
  return parseUser(html, name);
}

/**
 * The user's profile page: the account menu's fields, and the card a floor's author opens. Asking
 * by `uid` when it is known is one indexed lookup for the forum; the name is the fallback for a
 * page that carries no numeric id.
 */
export async function loadProfile(name: string, uid?: string): Promise<Profile> {
  const query: [string, string][] = uid && /^\d+$/.test(uid) ? [["uid", uid]] : [["username", name]];
  const html = await request("GET", "space.php", { query });
  return parseProfile(html, name);
}
