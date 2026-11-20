// Port of the regex helpers in `DiscuzAPI.swift`: `captureGroups` (its quirk:
// one match gives that match's groups, several give the whole matches),
// `htmlDecoded`, and the channel and thread rows of the forum pages.

import { forumTime } from "./timeAgo";

/** `String.captureGroups(regex:skipFirst:)`. */
export function captureGroups(text: string, pattern: string, skipFirst = false): string[] {
  const re = new RegExp(pattern, "gs");
  const matches = [...text.matchAll(re)];
  if (matches.length > 1) return matches.map((m) => m[0]);
  const match = matches[0];
  if (!match) return [];
  return Array.from(match).slice(skipFirst ? 1 : 0).map((g) => g ?? "");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodes the HTML entities a Discuz title can carry. */
export function htmlDecode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // A malformed entity can name a code point beyond Unicode or a lone surrogate; fromCodePoint
      // would throw and take down the whole page's parse. Keep the original text in that case.
      const valid = Number.isFinite(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/** `removingPercentEncoding`: the text, or itself when it is not valid escapes. */
export function removePercentEncoding(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export type Channel = { id: string; title: string; description: string; newPosts: number };
export type Post = {
  id: string;
  title: string;
  /** A coloured thread title, as the forum posted it (`<font color>` or a style). */
  color?: string;
  uid?: string;
  author?: string;
  at?: string;
  /** The reply count, when the page shows it (the user's own threads do not). */
  replies?: number;
  views?: number;
  lastReplyBy?: string;
  lastReplyAt?: string;
  /** The forum (channel) the thread is in, when the page names it. */
  fid?: string;
  /** A pinned (sticky) thread: its forum page lists it above the others, whatever its reply time. */
  pinned?: boolean;
  /** The thread carries pictures or files: its row on the forum page shows the attachment mark. */
  hasImages?: boolean;
  /** The start of the user's own reply, as the page shows it (My Replies). */
  excerpt?: string;
};

/** The channels on the index page (`DiscuzAPI.loadChannels`). */
/** A board's name, cleared of what a served page leaves on it: a trailing count (a parsing
 * leftover such as "iPhone 16 PM 23545"), and characters the device font has no glyph for
 * (they draw as boxes). */
export function cleanChannelTitle(raw: string): string {
  return htmlDecode(raw)
    .replace(/\s*\d{3,}\s*$/, "")
    .replace(/[\u{10000}-\u{10FFFF}]/gu, "")
    // Boxes on this device come from pictures (emoji), the replacement character, and private-use
    // glyphs (symbol fonts the app has not got).
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{FFFD}\u{E000}-\u{F8FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseChannels(html: string): Channel[] {
  const channels: Channel[] = [];
  for (const row of captureGroups(html, "<tr>.*?</tr>")) {
    const col = captureGroups(row, 'forumdisplay\\.php\\?fid=(\\d+).*?>([^<]+)</a>.*?<p>((?:[^<]+)?)<', true);
    if (col.length === 0) continue;
    const field = captureGroups(row, "今日: <strong>(\\d+)", true);
    const newPosts = field.length === 1 ? Number(field[0]) || 0 : 0;
    channels.push({ id: col[0], title: cleanChannelTitle(col[1]), description: col[2], newPosts });
  }
  return channels;
}

/** Channel links from any served page. Guests cannot read `index.php` (it is
 * challenged), but every forum page carries the channel nav in its links. */
export function parseChannelLinks(html: string): Channel[] {
  const found = new Map<string, Channel>();
  for (const m of html.matchAll(/forumdisplay\.php\?fid=(\d+)[^>]*>([^<]{1,60})<\/a>/g)) {
    const title = cleanChannelTitle(m[2]);
    if (!m[1] || !title || /^[\d\s&]+$/.test(title)) continue;
    if (!found.has(m[1])) found.set(m[1], { id: m[1], title, description: "", newPosts: 0 });
  }
  return [...found.values()];
}

/**
 * What a list row shows for a thread that carries pictures or files: Discuz marks it with a small
 * attachment icon beside the title (skins differ in the file they use), or says so in the image's
 * alternative text. The mark is read from the row rather than assumed; a row without one simply
 * has no `hasImages`, and the list draws no picture mark for it.
 */
const ATTACH_MARK =
  /attachimg\.gif|attach\.gif|image_s\.gif|attachicons\/(?:image|img)[^"]*\.gif|class="[^"]*\battach\b[^"]*"|alt="[^"]*(?:附件|图片)[^"]*"/i;

/** The threads on a forum page (`DiscuzAPI.loadPosts`). */
export function parsePosts(html: string, order: "dateline" | "lastpost" = "lastpost"): Post[] {
  const posts: Post[] = [];
  // Discuz marks sticky threads with <tbody id="stickythread_<tid>">. Parse it directly:
  // the old time-based guess breaks as soon as the list is sorted by dateline.
  const stickyIds = new Set<string>();
  for (const m of html.matchAll(/<tbody id="stickythread_(\d+)"/g)) stickyIds.add(m[1]);
  for (const row of captureGroups(html, "<tr>.*?</tr>")) {
    const col = captureGroups(
      row,
      '<span[^>]*><a href="viewthread\\.php\\?tid=(\\d+)[^>]*>([\\s\\S]*?)</a>.*?href="space\\.php\\?uid=(\\d+)">([^<]+)</a>.*<em>(\\d{4}-\\d{1,2}-\\d{1,2})</em>.*<td class="nums"><strong>(\\d+)</strong>/<em>(\\d+)</em></td>.*space\\.php\\?username=[^"]+">([^<]+)<.*lastpost">([^<]+)<',
      true,
    );
    if (col.length === 0) continue;
    // The post date sometimes carries the exact time in a `title` on the element around it (a
    // `<span>`, a link's tooltip, an `<em>`). When it does, the full date-time is used for the
    // "by post time" order and for the row's time, so today's threads read as minutes and hours.
    // It is looked for in the part of the row before the counts cell: the last-post cell also shows
    // a date, and its time is the reply's, not the thread's. No element is required, as skins
    // differ in which one carries it.
    const startPart = row.split(/<td[^>]*class="nums"/i)[0] ?? row;
    const atFull = /title="(\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?)"/.exec(startPart)?.[1]?.trim().replace("T", " ");
    // The list marks a thread that carries attachments: Discuz draws a small `attachimg.gif` (or an
    // image-type icon) beside the title, and some skins only say so in the image's alternative text.
    const hasImages = ATTACH_MARK.test(row);
    // The title may carry the forum's own colour (`<font color="red">`, a style); the text is
    // read without those tags, the colour kept for the row to draw.
    const rawTitle = col[1];
    const titleColor = /color\s*[:=]\s*["']?(#[0-9a-f]{3,8}|[a-z]+)/i.exec(rawTitle)?.[1];
    posts.push({
      id: col[0],
      title: htmlDecode(rawTitle.replace(/<[^>]*>/g, "")),
      color: titleColor,
      uid: col[2],
      author: removePercentEncoding(col[3]),
      at: atFull ?? col[4],
      replies: Number(col[5]) || 0,
      views: Number(col[6]) || 0,
      lastReplyBy: removePercentEncoding(col[7]),
      lastReplyAt: col[8],
      pinned: stickyIds.has(col[0]) || undefined,
      ...(hasImages ? { hasImages: true } : {}),
    });
  }
  // Sticky threads carry `stickythread_` ids whatever the order, so those are honoured directly.
  // On a `lastpost` page with none, the top run is guessed by last-reply times. On a `dateline`
  // page that guess is wrong — last-reply times are not monotonic there — and it would mark the
  // newest threads "pinned", which the list then hides under "hidden pinned", making the list look
  // mis-sorted. So the guess runs only for lastpost.
  if (order === "dateline") return posts;
  return stickyIds.size > 0 ? posts : markPinned(posts);
}

/**
 * Marks the pinned threads of a forum page. The page is sorted by last reply, newest first,
 * so a pinned thread shows up as an old one above a newer one. The pinned threads are the
 * top run before the last place where a thread's last reply is newer than the one above it.
 */
export function markPinned(posts: Post[]): Post[] {
  const times = posts.map((p) => forumTime(p.lastReplyAt));
  let boundary = 0;
  for (let i = 1; i < posts.length; i++) {
    const a = times[i - 1];
    const b = times[i];
    if (a !== null && b !== null && b > a) boundary = i;
  }
  return posts.map((p, i) => ({ ...p, pinned: i < boundary || undefined }));
}

/**
 * The threads a title search returns (`search.php`). Its rows differ from a
 * forum page's: the title link sits in `th.subject`, the forum is named, and
 * the keyword's highlight tags are stripped from the title.
 */
export function parseSearchResults(html: string): Post[] {
  const posts: Post[] = [];
  for (const row of captureGroups(html, "<tr>.*?</tr>")) {
    const id = /viewthread\.php\?tid=(\d+)/.exec(row)?.[1];
    const rawTitle = /<th class="subject">[\s\S]*?<a href="viewthread\.php\?tid=\d+[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(row)?.[1];
    if (!id || rawTitle === undefined) continue;
    const forum = /<td class="forum"><a href="forumdisplay\.php\?fid=(\d+)"/.exec(row)?.[1];
    const author = /<td class="author">[\s\S]*?<a href="space\.php\?uid=(\d+)">([^<]*)<\/a>[\s\S]*?<em>([^<]*)<\/em>/.exec(row);
    const nums = /<td class="nums"><strong>(\d+)<\/strong> \/ <em>(\d+)<\/em>/.exec(row);
    const last = /<td class="lastpost">[\s\S]*?<cite><a href="space\.php\?username=[^"]*">([^<]*)<\/a><\/cite>\s*<em><a[^>]*>([^<]*)<\/a><\/em>/.exec(row);
    posts.push({
      id,
      title: htmlDecode(rawTitle.replace(/<[^>]+>/g, "")).trim(),
      fid: forum,
      uid: author?.[1],
      author: author ? removePercentEncoding(author[2]) : undefined,
      at: author?.[3],
      replies: Number(nums?.[1]) || 0,
      views: Number(nums?.[2]) || 0,
      lastReplyBy: last ? removePercentEncoding(last[1]) : undefined,
      lastReplyAt: last?.[2],
      ...(ATTACH_MARK.test(row) ? { hasImages: true } : {}),
    });
  }
  return posts;
}

export type Author = { id: string; name: string; avatar: string };
export type Reply = {
  id: string;
  author: Author;
  at: string;
  /** The floor number (`#` in the page). */
  seq: number;
  /** The post's HTML body, as the page has it (Discuz's own markup). */
  body: string;
};

/** The replies on a thread page (`DiscuzAPI.loadReplies`). Bodies stay HTML:
 * the `TextView` renders HTML, so no Markdown conversion is needed. */
export function parseReplies(html: string): Reply[] {
  const replies: Reply[] = [];
  for (const row of html.split('<td class="postcontent postbottom">')) {
    const col = captureGroups(
      row,
      '<table id="pid(\\d+)".*?space\\.php\\?uid=(\\d+).*?>([^<]+)</a>.*href="space\\.php\\?uid=.*?<img src="([^"]+)".*<em>(\\d+)</em><sup>#</sup>.*<em id=.*?>发表于 ([^<]+)</em>.*(<div class="postmessage.*)$',
      true,
    );
    if (col.length === 0) continue;
    replies.push({
      id: col[0],
      // The attribute's `&amp;` is decoded here: `avatar.php?uid=1&amp;size=middle` is a query
      // with one parameter, not one called `amp;size`.
      author: { id: col[1], name: col[2], avatar: htmlDecode(col[3]) },
      at: col[5],
      seq: Number(col[4]) || -1,
      body: unescapeNumericEntities(col[6]),
    });
  }
  return replies;
}

/**
 * Undoes a second escaping of numeric character references (`&amp;#129309;` ->
 * `&#129309;`), which the reply pages use for emoji. Other text is left alone.
 */
export function unescapeNumericEntities(html: string): string {
  return html.replace(/&amp;(#x?[0-9a-fA-F]+;)/g, "&$1");
}

/** Makes relative `src` / `href` paths absolute against `base`, as the Swift
 * app's Markdown did with `baseURL`. Absolute, protocol-relative, `#` and
 * `javascript:` links are left alone. */
export function absolutize(html: string, base: string): string {
  return html.replace(/(src|href)="(?![a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|#)([^"]*)"/g, (_, attr: string, path: string) => {
    return `${attr}="${new URL(path, base).href}"`;
  });
}

/** The favorites page's threads (`DiscuzAPI.loadBookmarks`). */
export function parseBookmarks(html: string): Post[] {
  const posts: Post[] = [];
  for (const row of captureGroups(html, "<tr>.*?</tr>")) {
    const col = captureGroups(
      row,
      '<a href="viewthread\\.php\\?tid=(\\d+).*?>([^<]+)</a>.*?<a href="forumdisplay\\.php\\?fid=(\\d+).*?>([^<]+)</a>.*?<td class="nums">(\\d+)</td>.*?space\\.php\\?username[^>]+>([^<]+)</a>.*?lastpost">([^<]+)</a>',
      true,
    );
    if (col.length === 0) continue;
    // The row's author cell links the poster's space by uid; that uid builds the avatar URL
    // directly, instead of resolving the name through a profile page (which often comes back
    // without a picture, leaving the row a blank grey square).
    const uid = /space\.php\?uid=(\d+)/.exec(row)?.[1];
    posts.push({
      id: col[0],
      title: htmlDecode(col[1]),
      fid: col[2],
      uid,
      replies: Number(col[4]) || 0,
      lastReplyBy: removePercentEncoding(col[5]),
      lastReplyAt: col[6],
      ...(ATTACH_MARK.test(row) ? { hasImages: true } : {}),
    });
  }
  return posts;
}

/**
 * The threads the signed-in user started (`my.php?item=threads`). A row names the
 * thread, its forum, and its last poster and date; the page shows no reply count.
 */
export function parseMyThreads(html: string): Post[] {
  const posts: Post[] = [];
  for (const row of captureGroups(html, "<tr>.*?</tr>")) {
    const col = captureGroups(
      row,
      'viewthread\\.php\\?tid=(\\d+)[^"]*"[^>]*>([^<]+)</a>.*?forumdisplay\\.php\\?fid=(\\d+)"[^>]*>([^<]+)</a>.*?space\\.php\\?username=([^"]*)"[^>]*>([^<]+)</a>.*?goto=lastpost#lastpost"[^>]*>([^<]+)</a>',
      true,
    );
    if (col.length === 0) continue;
    // As on the favorites page, the row's space link carries the uid that names the avatar.
    const uid = /space\.php\?uid=(\d+)/.exec(row)?.[1];
    posts.push({
      id: col[0],
      title: htmlDecode(col[1]).trim(),
      fid: col[2],
      uid,
      lastReplyBy: removePercentEncoding(col[5]),
      lastReplyAt: col[6],
      ...(ATTACH_MARK.test(row) ? { hasImages: true } : {}),
    });
  }
  return posts;
}

/**
 * The threads the signed-in user replied to (`my.php?item=posts`). Each reply is two
 * table rows: the first names the thread (its `redirect` link carries the thread id
 * `ptid`), its forum, and the reply time; the next row holds the start of the reply
 * in a `th.lighttxt` cell spanning the columns.
 */
export function parseMyReplies(html: string): Post[] {
  const posts: Post[] = [];
  let last: Post | undefined;
  for (const row of captureGroups(html, "<tr>.*?</tr>")) {
    const col = captureGroups(
      row,
      'redirect\\.php\\?goto=findpost(?:&amp;|&)pid=\\d+(?:&amp;|&)ptid=(\\d+)"[^>]*>([^<]+)</a>.*?forumdisplay\\.php\\?fid=(\\d+)"[^>]*>[^<]*</a>.*?(\\d{4}-\\d{1,2}-\\d{1,2} \\d{1,2}:\\d{2})',
      true,
    );
    if (col.length > 0) {
      last = {
        id: col[0], title: htmlDecode(col[1]).trim(), fid: col[2], at: col[3], excerpt: "",
        ...(ATTACH_MARK.test(row) ? { hasImages: true } : {}),
      };
      posts.push(last);
      continue;
    }
    const text = /<th[^>]*class="lighttxt"[^>]*>([\s\S]*?)<\/th>/.exec(row)?.[1];
    // The list escapes the reply's entities twice (`&amp;#128077;`), so a second pass
    // turns them into the characters they stand for.
    if (last && text !== undefined) last.excerpt = htmlDecode(htmlDecode(text.replace(/<[^>]+>/g, ""))).trim();
  }
  return posts;
}

/** One private message in a conversation: its sender, when, its HTML body, and the sender's avatar. */
export type PmMessage = { author: string; at: string; body: string; avatar?: string };

const PM_TIME = /\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2}/;

/**
 * The correspondents in the private messages (`pm.php?filter=privatepm`): one row per
 * person, with the time of the latest message. Shaped as thread rows, so the list shows
 * them the same way; the row's title is the person's name.
 */
export function parsePmUsers(html: string): Post[] {
  const posts: Post[] = [];
  for (const item of captureGroups(html, "<li[^>]*>.*?</li>")) {
    const uid = /pm\.php\?uid=(\d+)(?:&amp;|&)filter=privatepm/.exec(item)?.[1];
    // The name is the link in `cite`; the latest message's time follows it.
    const name = /<cite><a href="space\.php\?uid=\d+"[^>]*>([^<]+)<\/a><\/cite>/.exec(item)?.[1];
    const at = PM_TIME.exec(item)?.[0];
    if (!uid || !name || !at) continue;
    const decoded = htmlDecode(name).trim();
    posts.push({ id: uid, uid, title: decoded, author: decoded, at, excerpt: "" });
  }
  return posts;
}

/**
 * The messages with one correspondent (`pm.php?uid=N`), in the order the page lists them.
 * Each message is an `li`: its sender in `cite`, the time after it, the text in
 * `div.summary`, and the sender's avatar image. Date headings are `li`s without a sender.
 */
export function parsePmConversation(html: string): PmMessage[] {
  const messages: PmMessage[] = [];
  for (const item of captureGroups(html, "<li[^>]*>.*?</li>")) {
    const author = /<cite>([\s\S]*?)<\/cite>/.exec(item)?.[1];
    const at = PM_TIME.exec(item)?.[0];
    const summary = /<div class="summary">([\s\S]*?)<\/div>/.exec(item)?.[1];
    if (!author || !at || summary === undefined) continue;
    const avatar = /<img src="([^"]+)"/.exec(item)?.[1];
    messages.push({
      author: htmlToText(author),
      at,
      // Line breaks in the source are layout whitespace; only `<br>` makes a new line.
      // The body stays HTML, as a thread reply's does, so both views decode it the same way.
      body: unescapeNumericEntities(summary),
      avatar: avatar ? htmlDecode(avatar) : undefined,
    });
  }
  return messages;
}

/** A login page's security questions (`logging.php?action=login`): the value the form posts as
 * `questionid`, and the question it asks. The forum's own list is used when the page has one. */
export function parseLoginQuestions(html: string): { id: number; text: string }[] {
  const select = /<select[^>]*name="questionid"[^>]*>([\s\S]*?)<\/select>/i.exec(html)?.[1];
  if (!select) return [];
  const questions: { id: number; text: string }[] = [];
  for (const m of select.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)<\/option>/gi)) {
    const text = htmlDecode(m[2]).trim();
    if (text) questions.push({ id: Number(m[1]), text });
  }
  return questions;
}

/** The user page's UID and avatar (`DiscuzAPI.loadUser`). Reads the two
 * independently so their order on the page does not matter. */
export function parseUser(html: string, name: string): Author | undefined {
  // Discuz prints `(UID: 123)`, but the space page's own markup varies; a bare `UID: 123`
  // or a `space.php?uid=` link names the same member, and either is enough for the avatar URL.
  const uid =
    /\(UID: (\d+)\)/.exec(html)?.[1] ??
    /\bUID:\s*(\d+)/.exec(html)?.[1] ??
    /space\.php\?uid=(\d+)/.exec(html)?.[1] ??
    "";
  const avatar =
    /<div class="avatar">\s*<img[^>]*\bsrc="([^"]+)"/i.exec(html)?.[1] ??
    /class="avatar"[^>]*>[\s\S]*?<img[^>]*\bsrc="([^"]+)"/i.exec(html)?.[1] ??
    "";
  if (!uid && !avatar) return undefined;
  return { id: uid, name, avatar: avatar ? htmlDecode(avatar) : "" };
}

/** What a user's profile page says about them, for the account menu. A field the page lacks is absent. */
export type Profile = {
  avatar?: string;
  group?: string;
  registered?: string;
  lastVisit?: string;
  lastPost?: string;
  postLevel?: string;
  readPermission?: string;
  posts?: string;
  dailyPosts?: string;
  essence?: string;
  pageViews?: string;
  onlineTotal?: string;
  onlineThisMonth?: string;
  credits?: string;
  prestige?: string;
  money?: string;
  /** Any further `<li>label: value</li>` line the page prints that the fields above do not name:
   *  the forum's markup differs between skins, and a card with a name and nothing else is worse
   *  than one that shows whatever the page does say. */
  extra?: { label: string; value: string }[];
};

/** The profile page's fields (`space.php?username=`), each read from its own line. */
const PROFILE_KNOWN = new Set([
  "用户组", "注册日期", "上次访问", "最后发表", "帖子级别", "发帖数级别", "阅读权限", "帖子数", "帖子",
  "日均发帖", "平均每日发帖", "精华", "页面访问量", "总计在线", "本月在线", "积分", "威望", "金钱",
  "好友数", "主题数",
]);

export function parseProfile(html: string, name: string): Profile {
  const field = (pattern: string): string | undefined => {
    const value = captureGroups(html, pattern, true)[0]?.trim();
    return value ? htmlDecode(value) : undefined;
  };
  const extra = extraFields(html);
  return {
    avatar: parseUser(html, name)?.avatar,
    group: field('用户组: <a[^>]*>([^<]+)</a>'),
    registered: field('<li>注册日期: ([^<]+)</li>'),
    lastVisit: field('<li>上次访问: ([^<]+)</li>'),
    lastPost: field('<li>最后发表: ([^<]+)</li>'),
    postLevel: field('<li>发帖数级别: ([^<]*?)\\s*(?:<img[^>]*>\\s*)?</li>'),
    readPermission: field('<li>阅读权限: ([^<]+)</li>'),
    posts: field('<li>帖子: (\\d+) 篇'),
    dailyPosts: field('平均每日发帖: ([^<]+?) 篇'),
    essence: field('<li>精华: (\\d+) 篇'),
    pageViews: field('<li>页面访问量: (\\d+)'),
    onlineTotal: field('总计在线 <em>([^<]+)</em> 小时'),
    onlineThisMonth: field('本月在线 <em>([^<]+)</em> 小时'),
    credits: field('<h3 class="blocktitle lightlink">积分: (\\d+)</h3>'),
    prestige: field('威望: (\\d+)'),
    money: field('金钱: (\\d+)'),
    ...(extra.length > 0 ? { extra } : {}),
  };
}

/** The profile's remaining `label: value` lines, for a skin whose markup names other fields. */
function extraFields(html: string): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const m of html.matchAll(/<li>\s*([^<:：]{2,10})\s*[:：]\s*([^<]{1,40})<\/li>/g)) {
    const label = m[1].trim();
    const value = htmlDecode(m[2]).trim();
    // The member's own id and addresses are not profile reading: `(UID 205208)` and the two IP
    // lines are the page's account details, not what the card is for.
    if (!label || !value || PROFILE_KNOWN.has(label)) continue;
    if (/UID|IP|ＩＰ/i.test(label)) continue;
    if (out.some((r) => r.label === label)) continue;
    out.push({ label, value });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * A page's HTML as plain text, for quoting (the Swift app quotes Markdown). Whitespace
 * reads as a browser shows it: the line breaks and indentation in the markup are spaces,
 * `<br>` and block ends are line breaks, and runs of blank lines collapse to one.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/\r?\n/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return htmlDecode(text)
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The floor a 4d4y `findpost` link opens (`redirect.php?goto=findpost&pid=…&ptid=…`, the arrow
 * of a quote): its post and thread. Any other link gives `undefined`.
 */
export function floorFromLink(href: string): { pid: string; ptid: string } | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.hostname !== "4d4y.com" && !url.hostname.endsWith(".4d4y.com")) return undefined;
  if (!/(^|\/)redirect\.php$/.test(url.pathname) || url.searchParams.get("goto") !== "findpost") return undefined;
  const pid = url.searchParams.get("pid");
  const ptid = url.searchParams.get("ptid");
  if (!pid || !ptid || !/^\d+$/.test(pid) || !/^\d+$/.test(ptid)) return undefined;
  return { pid, ptid };
}

/**
 * Appends a fetched page to the list. Paging ends when a page is empty, or when
 * its first item is already loaded: past its end, Discuz serves the last page
 * again. A short page is not an end, since the page size is the forum's own
 * setting and not always the same as the one asked for.
 */
export function mergePage<T extends { id: string }>(
  loaded: T[],
  incoming: T[],
): { items: T[]; more: boolean } {
  if (incoming.length === 0) return { items: loaded, more: false };
  // Discuz repeats its sticky threads at the top of every page, so a page can start with a
  // thread already listed and still hold new ones. The list ends only when nothing is new
  // (a page past the end repeats the last one it has).
  const seen = new Set(loaded.map((x) => x.id));
  const fresh = incoming.filter((x) => !seen.has(x.id));
  if (fresh.length === 0) return { items: loaded, more: false };
  return { items: [...loaded, ...fresh], more: true };
}

/** An absolute URL for a path on the forum (`DiscuzAPI`'s relative paths). */
export function absoluteUrl(path: string, base: string): string {
  return new URL(path, base).href;
}

/**
 * The thread a 4d4y link opens: `viewthread.php?tid=` or `forum.php?mod=viewthread&tid=`
 * on `4d4y.com` or one of its subdomains. Any other link gives `undefined`.
 */
export function threadIdFromLink(href: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.hostname !== "4d4y.com" && !url.hostname.endsWith(".4d4y.com")) return undefined;
  const isThread =
    /(^|\/)viewthread\.php$/.test(url.pathname) || (/(^|\/)forum\.php$/.test(url.pathname) && url.searchParams.get("mod") === "viewthread");
  const tid = url.searchParams.get("tid");
  if (!isThread || !tid || !/^\d+$/.test(tid)) return undefined;
  return tid;
}

/**
 * A thread page's title and forum (`fid`), as the page names them: the subject
 * heading, else the page `<title>` (`subject - channel - site`) without its
 * site and channel suffixes.
 */
export function parseThreadPageInfo(html: string): { title?: string; fid?: string; lastPage?: number } {
  const subject = /<span id="thread_subject">([\s\S]*?)<\/span>/.exec(html)?.[1];
  const pageTitle = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const fid = /forumdisplay\.php\?fid=(\d+)/.exec(html)?.[1];
  let fromTitle = pageTitle?.replace(/\s+-\s+[^-]*$/, "");
  const channel = fid ? new RegExp(`forumdisplay\\.php\\?fid=${fid}"[^>]*>([^<]+)</a>`).exec(html)?.[1]?.trim() : undefined;
  if (fromTitle && channel) {
    const suffix = ` - ${htmlDecode(channel)}`;
    if (htmlDecode(fromTitle).endsWith(suffix)) fromTitle = htmlDecode(fromTitle).slice(0, -suffix.length);
  }
  const title = subject ? htmlDecode(subject.replace(/<[^>]*>/g, "")).trim() : fromTitle ? htmlDecode(fromTitle).trim() : undefined;
  // Only add the key when the pager names it, so a page without one keeps the shape callers knew.
  const lastPage = parseLastPage(html);
  return { title: title || undefined, fid, ...(lastPage !== undefined ? { lastPage } : {}) };
}

/**
 * A thread's last page. Discuz's pager prints `当前页/总页数` in
 * `<em id="page">2/9</em>`; failing that, the largest `page=` a pager link asks
 * for. `undefined` when the page carries no pager (a one-page thread, or a
 * signed-out notice), so the jump-to-last control simply scrolls to the end.
 */
export function parseLastPage(html: string): number | undefined {
  const marked = /<em[^>]*id="page"[^>]*>\s*\d+\s*\/\s*(\d+)\s*<\/em>/i.exec(html)?.[1];
  let last = marked ? Number(marked) : 0;
  for (const m of html.matchAll(/(?:[?&]|&amp;)page=(\d+)/gi)) last = Math.max(last, Number(m[1]));
  return last > 0 ? last : undefined;
}

/** Drops the empty lines a post starts with (`<br>`, or empty paragraphs and
 * blocks), which would otherwise show as a blank band under the author line. */
export function trimLeadingBlanks(html: string): string {
  let out = html;
  let previous: string;
  do {
    previous = out;
    out = out.replace(/^\s*(?:<br\s*\/?>|<(p|div|span)\b[^>]*>(?:\s|&nbsp;)*<\/\1>)/i, "");
  } while (out !== previous);
  return out;
}

/** The pictures of a Discuz post. Discuz wraps a picture as
 * `<a href="javascript:;"><img onclick="zoom(this, 'full.jpg')" src="thumb">`;
 * the full picture is in `zoom`, else `file=`, else `src=` (a placeholder such
 * as a loading image is skipped for `file=`). A picture is its own block that
 * fills the column; smilies keep their size. */
export function fixImages(html: string): string {
  // Discuz's hidden attachment spans and their menus are not content: the
  // TextView does not hide `display: none`, so they would show (as the small
  // attachment icons).
  // Discuz lays the body out in a table: a picture's percentage width would
  // then resolve against the cell's content, so the table becomes plain blocks.
  const flat = html.replace(/<(table|tr|td|th)\b[^>]*>/gi, "<div>").replace(/<\/(table|tr|td|th)>/gi, "</div>");
  const visible = flat
    .replace(/<span\b[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, "")
    // A block that links a file is kept: the file's link is how the post offers it.
    .replace(/<div class="t_attach"[\s\S]*?<\/div>\s*<\/div>/gi, (block) => (attachmentLinks(block).length > 0 ? block : ""));
  // A script-only link around a picture is just the picture.
  const unwrapped = visible.replace(/<a\b[^>]*href="javascript:[^"]*"[^>]*>\s*(<img\b[^>]*>)\s*<\/a>/gi, "$1");
  return unwrapped.replace(/<img\b([^>]*)>/gi, (whole, attrs: string) => {
    const src = /\bsrc="([^"]*)"/i.exec(attrs)?.[1];
    const file = /\bfile="([^"]+)"/i.exec(attrs)?.[1];
    const zoom = /zoom\(this,\s*'([^']+)'/i.exec(attrs)?.[1];
    const placeholder = !src || /loading|none\.gif|common\/|smilies\//i.test(src);
    // `zoom()` points at the multi-megabyte original. The page already carries
    // a small copy for display; use it here and keep the original only for the
    // full-screen viewer, so a picture appears quickly on a phone connection.
    const small = placeholder ? (file ?? src) : src;
    const full = zoom ?? small;
    if (!small) return whole;
    if (/images\/(default|attachicons|common)\//i.test(small)) return "";
    if (/smilies\//i.test(small)) {
      const kept = attrs
        .replace(/\bsrc="[^"]*"/i, "")
        .replace(/\bfile="[^"]*"/i, "")
        .replace(/\bonclick="[^"]*"/i, "")
        .replace(/\s+/g, " ").trim();
      return `<img src="${small}"${kept ? " " + kept : ""}>`;
    }
    // The site's own compressed display copy loads fast; width=100% keeps the drawn size
    // unchanged whatever the source's pixel size. A tap on the picture opens the original in the
    // zoomable viewer through onLinkPress. No inline style: the text view's HTML reader did not
    // take it, and a body laid out at the picture's own size pushed the players out of reach.
    const original = absoluteUrl(full ?? small, HOST_BASE);
    const kept = attrs
      .replace(/\bsrc="[^"]*"/i, "")
      .replace(/\bfile="[^"]*"/i, "")
      .replace(/\bonclick="[^"]*"/i, "")
      .replace(/\s(width|height)="[^"]*"/gi, "")
      .replace(/\s+/g, " ").trim();
    return `<p><a href="${original}"><img src="${small}"${kept ? " " + kept : ""} width="100%"></a></p>`;
  });
}

// Discuz's `[size=N]` as the pixel size of the font (1 to 7).
const FONT_SIZES = [10, 13, 16, 18, 24, 32, 48];

/** Where the `</div>` closing the `<div>` whose content starts at `from` begins, or -1. */
function closingDivStart(html: string, from: number): number {
  const tag = /<(\/?)div\b[^>]*>/gi;
  tag.lastIndex = from;
  let depth = 1;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index;
  }
  return -1;
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A URL for an HTML attribute value: `&`, `"`, `<` and `>` escaped so a query string survives. */
const escapeAttr = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The lines of a Discuz `[code]` block: each `<li>` is a line (closing tag optional), with the
 * copy button's label dropped and the newlines the markup puts around each line removed. */
function codeLines(inner: string): string[] {
  const withoutButton = inner.replace(/<([a-z]+)\b[^>]*>\s*复制代码\s*<\/\1>/gi, "").replace(/复制代码/g, "");
  const parts = withoutButton.split(/<li\b[^>]*>/i);
  const lines =
    parts.length > 1
      ? parts.slice(1).map((part) => part.replace(/<\/li\s*>[\s\S]*$/i, "").replace(/<\/?ol\b[^>]*>[\s\S]*$/i, ""))
      : withoutButton.replace(/<br\s*\/?>/gi, "\n").split("\n").filter((line) => line.trim() !== "");
  return lines.map((line) => htmlDecode(line.replace(/<[^>]+>/g, "")).replace(/^[\r\n]+|[\r\n]+$/g, ""));
}

/** Discuz's `[code]` block as one monospace block, every line kept as written. */
function codeBlockHtml(inner: string): string {
  return `<pre><code>${escapeHtml(codeLines(inner).join("\n"))}</code></pre>`;
}

/** Discuz's `[code]` (a `div.blockcode` of numbered lines) rewritten as a `<pre><code>` block, which the
 * TextView shows in monospace with its line breaks kept. The other BBCode the forum renders as HTML (`<font>`
 * for color and size, links, pictures, quotes) is left for the TextView's extensions and its own parsing.
 * Run after `fixImages`. */
export function fixDiscuzMarkup(html: string): string {
  let out = "";
  let at = 0;
  const codeOpen = /<div\b[^>]*class="blockcode"[^>]*>/gi;
  for (let m = codeOpen.exec(html); m; m = codeOpen.exec(html)) {
    const close = closingDivStart(html, m.index + m[0].length);
    if (close < 0) break;
    const end = html.indexOf(">", close) + 1;
    // Slice up to the real start of the closing tag: skins write `</div >` or `</DIV>` too, so
    // subtracting a fixed "</div>".length cut into the code or left a piece of the tag behind.
    const inner = html.slice(m.index + m[0].length, close);
    out += html.slice(at, m.index) + codeBlockHtml(inner);
    at = end;
    codeOpen.lastIndex = end;
  }
  return (out + html.slice(at))
    // A media embed (an iframe, or the forum's [media] BBCode left as text) draws as nothing in
    // the text view: a link stands in its place, and the player under the post plays it.
    .replace(/<iframe\b[^>]*\bsrc="([^"]+)"[^>]*>[\s\S]*?<\/iframe>/gi, (_, src: string) => `<p><a href="${src}">▶ ${src}</a></p>`)
    .replace(/\[media(?:=[^\]]*)?\]([\s\S]*?)\[\/media\]/gi, (_, body: string) => `<p><a href="${body.trim()}">▶ ${body.trim()}</a></p>`);
}

/**
 * Splits a post's `<br>` line breaks into paragraph boundaries (`</p><p>`), so
 * NSH's text view lays each visual line out as its own block. The selectable text
 * view resolves a long press against a block's lines; a block that spans several
 * `<br>` lines hits only its first line, so a press on a later line lands at the
 * block's end. One paragraph per line makes the press land on the right line.
 * `<pre>` and `<code>` blocks are left alone — their own `\n` breaks stay put.
 * Run after `fixDiscuzMarkup` and `fixImages`.
 */
export function splitBrIntoParagraphs(html: string): string {
  if (!/<br\s*\/?>/i.test(html)) return html;
  const openTag = (chunk: string) => chunk.replace(/<br\s*\/?>/gi, "</p><p>");
  let out = "";
  let at = 0;
  const codeBlock = /<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi;
  for (let m = codeBlock.exec(html); m; m = codeBlock.exec(html)) {
    out += openTag(html.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + openTag(html.slice(at));
}

/** The style of a Discuz `<font>` (`[color=…]` and `[size=N]`): a hex or a plain color name, and the font size in pixels. */
export function discuzFontStyle(attributes: Record<string, string>): { color?: string; fontSize?: number } {
  const color = attributes.color?.trim() ?? "";
  const size = Number(attributes.size);
  const style: { color?: string; fontSize?: number } = {};
  if (/^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(color)) style.color = color;
  if (Number.isInteger(size) && size >= 1 && size <= FONT_SIZES.length) style.fontSize = FONT_SIZES[size - 1];
  return style;
}

/** A post's file attachment: the link's address (as the page has it) and the file name it shows. */
export type Attachment = { url: string; name: string };

// `<a href="…">name</a>` whose text has no picture in it.
const LINK_WITH_TEXT = /<a\b[^>]*?\bhref="([^"]*)"[^>]*>((?:(?!<img\b)[\s\S])*?)<\/a>/gi;

/**
 * The file attachments a post links to. Discuz links each one to its download page
 * (`attachment.php?aid=` or `forum.php?mod=attachment&aid=`), named by its link text. A
 * picture's link wraps an `<img>`, so it is not a file and is left to `fixImages`.
 */
export function attachmentLinks(html: string): Attachment[] {
  const files: Attachment[] = [];
  for (const [, href, inner] of html.matchAll(LINK_WITH_TEXT)) {
    const url = htmlDecode(href);
    if (!isAttachmentUrl(url)) continue;
    const name = htmlDecode(inner.replace(/<[^>]*>/g, "")).trim();
    if (name) files.push({ url, name });
  }
  return files;
}

/**
 * Whether a link is a Discuz attachment download on `4d4y.com` (or a subdomain), over http
 * or https. A relative link is the forum's own (resolved against `HOST_BASE`).
 */
export function isAttachmentUrl(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href, HOST_BASE);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.hostname !== "4d4y.com" && !url.hostname.endsWith(".4d4y.com")) return false;
  return /(^|\/)(attachment|attach)\.php$/.test(url.pathname) || url.searchParams.get("mod") === "attachment";
}

/** The forum's base URL, for relative paths (`DiscuzAPI.host`). */
export const HOST_BASE = "https://www.4d4y.com/forum/";
