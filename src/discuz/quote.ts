// Quotes in the reply box: each quoted line starts with `> `, and the first line carries the
// floor's author, time and ids. A quote made in the app is brief — author and time only, like the
// web forum's quote link — while an old draft or a quote read back from a post may still carry
// body lines. The post sent to Discuz gets the forum's own `[quote]` BBCode; the box and the BBCode
// convert both ways, so a saved draft with a quote (or a quote read back from a post) is shown
// again, with only its attribution visible in the read-only block.
import type { Reply } from "./parse";

/** The floor a quote comes from: who wrote it, when, and the post and thread ids. */
export type QuoteSource = { author: string; at: string; pid: string; ptid: string };

// `> 作者 发表于 时间 [pid:… ptid:…]`, without the `> ` (the attribution line of a quote).
const ATTRIBUTION = /^(.+?) 发表于 (.+?) \[pid:(\d+) ptid:(\d+)\]$/;
// A quoted line in the box.
const QUOTED_LINE = /^>/;
// A forum quote's meta line: the grey author and time, and the arrow that links to the floor
// (`[url=…findpost…][img]back.gif[/img][/url]`).
const META = /\[size=2\]\[color=#999999\](.+?) 发表于 (.+?)\[\/color\]\s*\[url=([^\]]+)\]\[img\][^[]*\[\/img\]\[\/url\]\[\/size\]/;
// The innermost `[quote]…[/quote]`: its content holds no quote tags, so nested quotes are
// taken one level at a time.
const QUOTE = /\[quote\]((?:(?!\[\/?quote\])[\s\S])*)\[\/quote\]/i;

/** The short web-forum attribution of a quote draft: author and time, without the ids. */
export function quoteAttribution(draft: string): string {
  const first = (draft.split("\n")[0] ?? "").replace(/^> ?/, "");
  const head = ATTRIBUTION.exec(first);
  return head ? `${head[1]} 发表于 ${head[2]}` : first;
}

/** A quote of `source` with `body` (plain text, one line each), as box text: no trailing newline. */
export function quoteInDraft(source: QuoteSource, body: string): string {
  const attribution = `> ${source.author} 发表于 ${source.at} [pid:${source.pid} ptid:${source.ptid}]`;
  const lines = body.length > 0 ? body.split("\n").map(quotedLine) : [];
  return [attribution, ...lines].join("\n");
}

/** A reply quoted into the box: only its author and time, as a web forum's brief quote. */
export function replyQuoteInDraft(reply: Reply, ptid: string): string {
  return quoteInDraft({ author: reply.author.name, at: reply.at, pid: reply.id, ptid }, "");
}

/** The leading `>` run of a draft, split from what the reader wrote after it. */
export function splitDraftQuote(text: string): { quoted: string; own: string } {
  const lines = text.split("\n");
  let end = 0;
  while (end < lines.length && QUOTED_LINE.test(lines[end])) end += 1;
  if (end === 0) return { quoted: "", own: text };
  // One blank line between the quote and the reply is layout, not part of either.
  let ownAt = end;
  if (ownAt < lines.length && lines[ownAt].trim() === "") ownAt += 1;
  return { quoted: lines.slice(0, end).join("\n"), own: lines.slice(ownAt).join("\n") };
}

/** The box's text as the Discuz post: every run of `>` lines becomes a `[quote]`. */
export function draftToPost(text: string, host: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!QUOTED_LINE.test(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && QUOTED_LINE.test(lines[i])) {
      block.push(lines[i].replace(/^> ?/, ""));
      i += 1;
    }
    out.push(quoteToPost(block, host));
  }
  return out.join("\n");
}

/** The post's quotes, as the box shows them: each `[quote]` becomes its `>` lines. */
export function postToDraft(text: string): string {
  let out = text;
  let match = QUOTE.exec(out);
  while (match) {
    out = out.slice(0, match.index) + quoteToDraft(match[1]) + out.slice(match.index + match[0].length);
    match = QUOTE.exec(out);
  }
  return out;
}

function quotedLine(line: string): string {
  return line === "" ? ">" : `> ${line}`;
}

// The block's lines, with one `>` taken off each. Its body is converted again, so nested
// quotes come out nested.
function quoteToPost(block: string[], host: string): string {
  const head = ATTRIBUTION.exec(block[0] ?? "");
  const body = draftToPost(head ? block.slice(1).join("\n") : block.join("\n"), host).replace(/^\n+|\n+$/g, "");
  if (!head) return `[quote]${body}[/quote]`;
  const [, author, at, pid, ptid] = head;
  const meta =
    `[size=2][color=#999999]${author} 发表于 ${at}[/color] ` +
    `[url=${host}redirect.php?goto=findpost&pid=${pid}&ptid=${ptid}][img]${host}images/common/back.gif[/img][/url][/size]`;
  // A brief quote (author and time only) stays on one line, as the web forum writes it.
  if (body === "") return `[quote]${meta}[/quote]`;
  return `[quote] ${body}\n${meta}[/quote]`;
}

// One quote's content, from a `[quote]`: its meta line (when it has one) becomes the
// attribution, and the rest its quoted lines.
function quoteToDraft(content: string): string {
  const meta = META.exec(content);
  const body = (meta ? content.replace(meta[0], "") : content).trim();
  const lines = body === "" ? [] : body.split("\n").map(quotedLine);
  const pid = meta ? /[?&]pid=(\d+)/.exec(meta[3])?.[1] : undefined;
  const ptid = meta ? /[?&]ptid=(\d+)/.exec(meta[3])?.[1] : undefined;
  if (!meta || !pid || !ptid) return lines.join("\n");
  const attribution = `> ${meta[1]} 发表于 ${meta[2]} [pid:${pid} ptid:${ptid}]`;
  return [attribution, ...lines].join("\n");
}
