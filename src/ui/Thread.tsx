// A thread's replies, pages, quote and reply draft (`PostDetailView` of the
// Swift app). The draft is kept per thread in the app's storage.
import { Clipboard, cleanup, colorScheme, createAnimatedValue, createMotion, effect, Image, List, signal, Storage, Text, View, type PasteEvent, type ListRef, type JSX, type ViewRef } from "nsh";
import { Dialog, TextView } from "nsh/base";
import { currentUser, deletePost, editPost, HOST, loadEditForm, postReply, ReplyRefused, uploadAttachment, uploadEditAttachment, type EditForm } from "../discuz/client";
import { bookmarkPost, clearThreadReplyPages, loadFloorPage, loadReplyPage, removeBookmark } from "../discuz/forum";
import { absolutize, absoluteUrl, attachmentLinks, fixDiscuzMarkup, fixImages, floorFromLink, isAttachmentUrl, mergePage, splitBrIntoParagraphs, threadIdFromLink, trimLeadingBlanks, type Post, type Reply } from "../discuz/parse";
import { draftToPost, postToDraft, replyQuoteInDraft, splitDraftQuote } from "../discuz/quote";
import { downloadAttachment } from "./downloads";
import { DISCUZ_EXTENSIONS, renderDiscuzNode } from "./discuzMarkup";
import { openLink } from "./links";
import { timeAgo } from "../discuz/timeAgo";
import { LoadingBar } from "./LoadingBar";
import { anchorToast, notify } from "./toast";
import { palette } from "./appearance";
import { LineIcon } from "./lineIcons";
import { openGallery, openImageViewer, postImages } from "./imageViewer";
import { BrowserIcon, BubbleIcon, LinkIcon, PencilIcon, StarIcon, TrashIcon } from "./icons";
import { ReplyCard } from "./ReplyCard";
import { ProfileSheet } from "./ProfileSheet";
import { avatarUrlForUid } from "../discuz/avatarUrl";
import { ReplyBox } from "./ReplyBox";
import { attachmentTag, createAttachments } from "./attachments";
import type { Attached } from "./ReplyBox";
import { pauseVideos } from "./videoPause";
import { displaySettings } from "./settings";
import { PmComposer } from "./PmComposer";
import { canSendReply } from "./replyGate";
import { bilibiliRefs } from "../bilibili/links";
import { BiliPlayer, BiliShortPlayer } from "./BiliPlayer";
import { douyinRefs } from "../douyin/links";
import { DouyinPlayer, DouyinShortPlayer } from "./DouyinPlayer";
import { xiaohongshuNoteLinks } from "../xiaohongshu/links";
import { videoLinksIn } from "../video/links";
import { VideoLinkPlayer } from "./VideoLinkPlayer";
import { XhsCard } from "./XhsCard";

// A picture by its name or its type; anything else is a file.
import { isFavorite, markFavorite } from "./favorites";

const draftKey = (tid: string) => `draft:${tid}`;

// The heavy HTML transform (fixDiscuzMarkup + fixImages + absolutize) per reply id, cached at
// module scope so it survives component remounts and re-renders: scrolling, re-rendering rows on
// hover, and re-opening a thread do not re-parse every body. Cleared on a full (page 1) reload,
// which is exactly when the forum may have sent fresh bodies (after a reply or an edit). The
// cache is bounded: browsing many threads would otherwise keep every floor's HTML forever.
const htmlCache = new Map<string, string>();
// A virtualized list keeps well under 20 floors on screen at once; 160 parsed bodies
// is enough for re-opening a thread and recent scrolling, without holding every
// floor of every thread ever visited (each body is a full HTML string).
const HTML_CACHE_LIMIT = 120;

/** Reads a reply's parsed HTML, or parses and stores it; evicts the oldest entries past the limit. */
function cachedBodyHtml(id: string, parse: () => string): string {
  const hit = htmlCache.get(id);
  if (hit !== undefined) {
    // Refresh its recency so the cache keeps the entries still in use.
    htmlCache.delete(id);
    htmlCache.set(id, hit);
    return hit;
  }
  const html = parse();
  htmlCache.set(id, html);
  if (htmlCache.size > HTML_CACHE_LIMIT) {
    // Drop the oldest quarter: the first entries are the longest-untouched.
    const drop = Math.floor(HTML_CACHE_LIMIT / 4);
    let n = 0;
    for (const key of htmlCache.keys()) {
      if (n++ >= drop) break;
      htmlCache.delete(key);
    }
  }
  return html;
}

// A Discuz post joins its text lines with `<br>`, which NSH's text view reads as
// one block with soft breaks. On Android the selectable text view's hit-test
// resolves a long press only against a block's first line — pressed on a later
// line it lands at the block's end, so the word under the finger is never the one
// selected and the handles start out collapsed there ("cannot drag, whole line
// only"). `splitBrIntoParagraphs` (in parse.ts) turns each `<br>` into a paragraph
// boundary so every visual line is its own block and the press lands on the right
// line. `LINE_STYLES` zeroes the paragraph margins so one paragraph per line reads
// as the single block it was.

// Zeroes a paragraph's vertical margins, so one paragraph per line reads as the
// single block it was. `styles` reach the `paragraph` part where `classes` does not.
const LINE_STYLES = { paragraph: { marginTop: 0, marginBottom: 0 } } as const;

// The thread's title shows in the header at the large size; the first post's
// own heading (its title, in the body) takes the small size the header had.
const OP_TITLE_STYLES = {
  heading: { fontSize: 16, fontWeight: 500 },
  heading1: { fontSize: 16, fontWeight: 500 },
  heading2: { fontSize: 16, fontWeight: 500 },
  heading3: { fontSize: 16, fontWeight: 500 },
} as const;

// `signedIn` gates what needs an account: the favorite star, quoting and replying.
// `onOpenThread` takes a press on a link to another 4d4y thread; `onBack` shows a Back control
// (a thread opened from a link, whose title and forum come from its first page).
// A round, translucent action disc. The thread's own actions and the jump buttons share one look,
// so the column's bottom right reads as one cluster.
function ActionDisc(props: { label: string; onPress: () => void; active?: boolean; node?: (ref: ViewRef | null) => void; children: JSX.Element }) {
  return (
    <View
      ref={(n: ViewRef | null) => props.node?.(n)}
      onPress={props.onPress}
      accessibilityLabel={props.label}
      style={{
        width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
        backgroundColor: props.active
          ? palette().selected
          : colorScheme() === "dark" ? "rgba(22, 27, 34, 0.72)" : "rgba(255, 255, 255, 0.82)",
        borderWidth: 1, borderColor: palette().border,
      }}
    >
      {props.children}
    </View>
  );
}

// The thread's actions, folded under the round control: the star, the browser and the link. A short
// upward entrance makes them rise out of it; `createMotion` rests at its end state, so a skipped
// motion still shows them.
function ThreadActions(props: { saved: boolean; onFavorite: () => void; onBrowser: () => void; onLink: () => void }) {
  const entrance = createMotion({ enter: "fadeInUp" });
  return (
    <View style={entrance.style}>
      <View style={{ alignItems: "center", gap: 8 }}>
        <ActionDisc label={props.saved ? "取消收藏" : "加入收藏"} onPress={props.onFavorite}>
          <StarIcon size={17} filled={props.saved} />
        </ActionDisc>
        <ActionDisc label="在浏览器中打开帖子" onPress={props.onBrowser}>
          <BrowserIcon size={17} />
        </ActionDisc>
        <ActionDisc label="复制帖子链接" onPress={props.onLink}>
          <LinkIcon size={17} />
        </ActionDisc>
      </View>
    </View>
  );
}

export function Thread(props: {
  fid: string;
  post: Post;
  signedIn?: boolean;
  onUnfavorited?: () => void;
  onSignInNeeded?: () => void;
  /** Opens a thread; with `pid`, at that floor (a floor link to another thread). */
  onOpenThread?: (tid: string, pid?: string) => void;
  onBack?: () => void;
  /** A right swipe in the body goes back (a thread opened from a link, or the list in portrait). */
  onSwipeBack?: () => void;
  /** Opens the boards and thread list, which stay out of the body's way. */
  onOpenSidebars?: () => void;
  /** The floor a link opened in this thread, shown first. */
  focusPid?: string;
}) {
  // The title and forum: the post's own, or those the first page names for a thread opened from a link.
  const title = signal(props.post.title);
  const fid = signal(props.fid);
  const replies = signal<Reply[]>([]);
  const page = signal(1);
  const more = signal(true);
  // The page whose load failed (its message and Refresh button show in the thread), or null.
  const failedPage = signal<number | null>(null);
  // Messages for actions that failed (a reply, a picture, favorites): one plain line each.
  // The page whose load failed, so Retry asks for that page again.
  const draft = signal("");
  // The quoted passage, kept apart from what the reader writes. It is saved as the leading `>`
  // lines of the same draft string, so drafts written by older builds still read back unchanged.
  const quoted = signal("");
  // The saved draft is read asynchronously. Once the reader types or quotes, it must not be
  // replaced by what the storage later returns (the same guard the new-thread screen uses).
  let typed = false;
  const sending = signal(false);
  // Whether the thread is in the favorites: the shared list, which the thread lists star from.
  const saved = () => isFavorite(props.post.id);
  // The thread's page on the forum, for the browser.
  const threadUrl = () => `${HOST}viewthread.php?tid=${props.post.id}`;

  // The header floats over the body and slides away while the posts scroll, so the text takes the
  // whole screen: NSH animates `opacity` and `transform` natively, not a box's height, so the bar
  // is an overlay that moves up via `translateY` and the list keeps its full height behind it
  // (its content only starts below the bar through its padding).
  const HEADER_H = 86;
  // The header's measured height. The posts start under it: reserving the nominal 86 pt left a
  // blank band between a one-line title and the first floor, so the padding follows what the
  // header actually takes (its title can be one line or two).
  const headerHeight = signal(72);
  const scrollOffset = createAnimatedValue(0);
  const titleShift = () =>
    scrollOffset.interpolate({ inputRange: [0, 80], outputRange: [0, -HEADER_H], extrapolate: "clamp" });
  const titleOpacity = () =>
    scrollOffset.interpolate({ inputRange: [0, 80], outputRange: [1, 0], extrapolate: "clamp" });

  // A right swipe in the body goes back. `panActivation` fails the gesture on a small vertical move
  // (so the list still scrolls and small gestures do not trigger it); only a clear, long rightward
  // swipe counts, so it is not easy to fire by accident. A selection in the text turns it off, as
  // that is a drag too — checked when the gesture ends rather than by taking the pan away, which
  // would render the body again mid-gesture.
  const backPan = createAnimatedValue(0);
  const onSwipeEnd = (e: any) => {
    const dx = e?.translation?.x ?? 0;
    const vx = e?.velocity?.x ?? 0;
    // The default-level gesture: a short rightward drag (or a light flick) is enough. The old
    // 150 pt / 1700 pt/s pair made the back action feel like it needed a deliberate haul.
    if (!e?.cancelled && (dx > 60 || vx > 700)) props.onSwipeBack?.();
    backPan.set(0);
  };

  // Opening a thread used to replace the column's content in a single frame. An opacity-only
  // entrance (no layout change, so the list never re-measures) makes the switch read as a
  // transition. `createMotion()` rests at opacity 1, so a skipped motion still shows the thread.
  const entrance = createMotion();
  effect(() => {
    void entrance.play("fadeIn", { duration: 180 });
  });
  cleanup(() => {
    ++fetchSeq;
    for (const t of timers) clearTimeout(t);
  });

  // (The HTML transform cache is module-level, declared above the component, so it survives
  // remounts and makes re-rendering rows and re-opening a thread instant.)
  function bodyHtml(r: Reply): string {
    return cachedBodyHtml(r.id, () => absolutize(trimLeadingBlanks(splitBrIntoParagraphs(fixDiscuzMarkup(fixImages(r.body)))), HOST));
  }

  // The pictures a post shows, read from the same transformed HTML the text view draws.
  const galleryOf = new Map<string, ReturnType<typeof postImages>>();
  function postPictures(r: Reply) {
    const hit = galleryOf.get(r.id);
    if (hit) return hit;
    const list = postImages(bodyHtml(r));
    galleryOf.set(r.id, list);
    return list;
  }

  /**
   * Opens the viewer at one of a post's pictures: the one tapped when the post's HTML names it,
   * and on its own when it does not (an attachment link, or a picture the transform dropped).
   */
  function openPostImage(r: Reply, full: string, display: string) {
    const list = postPictures(r);
    const index = list.findIndex((p) => p.url === full || p.display === display || p.display === full);
    if (index >= 0) openGallery(list, index);
    else openImageViewer(full, display);
  }

  // The pictures a reply shows (block images carry the original in `title`), so a
  // floor's header can offer a reliable "view pictures" entry — the text view's
  // own image press does not fire on Android.


  // True until the first reply page has loaded (or failed), so the thread shows a spinner instead of blank.
  const firstLoad = signal(true);
  // Pull-to-refresh on the reply list (at the top): reload this thread's pages.
  const refreshingThread = signal(false);

  let loadingMore = false;
  const loadingMoreShown = signal(false);
  // The thread's last page, as its pager reports it. `undefined` on a page with no pager.
  const lastPage = signal<number | undefined>(undefined);
  // A jump to the last page is one request; a second press waits for it.
  const jumping = signal(false);
  // The thread's actions (favorite, browser, link) folded under the round control at the bottom right.
  const toolboxOpen = signal(false);
  // The round control the thread's actions fold under: a message about one of them ("链接已复制。")
  // points at it.
  let toolboxNode: ViewRef | undefined;
  // A press on a floor's avatar: the author's profile card, which can open the message writer.
  const profileTarget = signal<{ id?: string; name: string; avatar?: string } | null>(null);
  // The private message being written, once the card's 发短信息 is pressed: the writer opens
  // straight away, with no other step in between.
  const pmCompose = signal<{ id: string; name: string } | null>(null);

  /**
   * A floor's picture, and the address to try if it is not there. The forum prints its own
   * `avatar.php?...` URL, which is a PHP request per floor — the page renders before the
   * pictures are even asked for, and each one waits its turn. The uploaded avatar has a static
   * file on the image host at a path built from the uid, which needs no PHP and is cached, so
   * that address is tried first and the page's own URL is kept as the fallback (a member who
   * never uploaded a picture has no static file).
   */
  function floorAvatar(author: Reply["author"]): { src?: string; fallback?: string } {
    const page = author.avatar ? absoluteUrl(author.avatar, HOST) : undefined;
    const still = avatarUrlForUid(author.id, "middle");
    if (!still) return { src: page };
    if (!page || page === still) return { src: still };
    return { src: still, fallback: page };
  }

  // The pictures of the floors just parsed are fetched at once, in parallel, so a row that
  // scrolls into view has its avatar already decoded instead of starting a request then.
  let prefetching = 0;
  const prefetched = new Set<string>();
  function prefetchAvatars(list: Reply[]): void {
    for (const r of list) {
      const { src } = floorAvatar(r.author);
      if (!src || prefetched.has(src) || prefetching >= 12) continue;
      prefetched.add(src);
      prefetching++;
      Image.prefetch(src).catch(() => undefined).finally(() => { prefetching--; });
    }
  }

  // A scroll pauses a video playing in the thread, so it never plays on off screen. Throttled:
  // the pause reaches the page at most a few times a second while the finger keeps moving.
  let lastVideoPause = 0;
  function onThreadScroll(e?: { offset?: { y?: number }; contentSize?: { height?: number }; size?: { height?: number } }): void {
    // The next page starts before the end of the thread is reached (the viewport is `size`).
    const rest = (e?.contentSize?.height ?? 0) - ((e?.offset?.y ?? 0) + (e?.size?.height ?? 0));
    if (rest < 1500) void loadMore();
    const now = Date.now();
    if (now - lastVideoPause < 200) return;
    lastVideoPause = now;
    pauseVideos();
  }

  // Each load gets a generation. A response from a superseded load (a refresh started while an
  // older "load more" was still in flight) must not overwrite the newer list or its state.
  let fetchSeq = 0;
  const timers: number[] = [];
  function later(fn: () => void, ms: number): void {
    timers.push(setTimeout(fn, ms));
  }
  function fetchPage(n: number) {
    const seq = ++fetchSeq;
    // The first page is what the reader is looking at: let it jump ahead of background warming
    // and avatar lookups in the shared request queue.
    return loadReplyPage(props.post.id, n, n === 1 ? "high" : "low")
      .then(({ title: pageTitle, fid: pageFid, lastPage: pageLast, replies: list }) => {
        if (seq !== fetchSeq) return;
        if (n === 1 && pageTitle) title.set(pageTitle);
        if (pageFid && !fid()) fid.set(pageFid);
        if (pageLast !== undefined) lastPage.set(pageLast);
        const merged = n === 1 ? { items: list, more: list.length > 0 } : mergePage(replies(), list);
        // Start the avatar requests before the rows are drawn, so the pictures have a head start
        // over the first frame instead of beginning at the same moment as the <Image> elements.
        prefetchAvatars(list);
        replies.set(merged.items);
        more.set(merged.more);
        page.set(n);
        failedPage.set(null);
        if (n === 1) {
          firstLoad.set(false);
          // A fresh thread starts at the top with its title showing. The transform cache is KEPT:
          // a cached reply page carries the same bodies, so re-transforming every reply on each
          // open only made opening a thread slower. It is cleared when a reply, edit or delete
          // changes the bodies (see send/saveEdit/removeReply, which call it before reloading).
          scrollOffset.set(0);
        }
        // Warm the next page in the background (after the first screen's pictures
        // start loading) so scrolling to "load more" — and its images — continues
        // without a network wait.
        if (merged.more) {
          const nextPage = n + 1;
          later(() => { void loadReplyPage(props.post.id, nextPage).catch(() => undefined); }, 800);
        }
      })
      .catch((e) => {
        if (seq !== fetchSeq) return;
        failedPage.set(n);
        if (n === 1) firstLoad.set(false);
      })
      .finally(() => {
        // Only the latest load owns the loading flag.
        if (seq !== fetchSeq) return;
        loadingMore = false;
        loadingMoreShown.set(false);
      });
  }

  function refreshThread() {
    if (refreshingThread()) return;
    refreshingThread.set(true);
    clearThreadReplyPages(props.post.id);
    void fetchPage(1).finally(() => refreshingThread.set(false));
  }

  function loadMore() {
    if (loadingMore || !more()) return;
    loadingMore = true;
    loadingMoreShown.set(true);
    fetchPage(page() + 1);
  }

  // One press to the first floor: the first page is always the list's start, so this is a scroll.
  function toFirstFloor() {
    repliesList?.scrollToOffset({ offset: 0, animated: true });
  }

  // One press to the last floor: still on an earlier page, ask for the thread's last page and
  // append it, then scroll to its end. The pages in between are not fetched (a long thread would
  // otherwise make this wait for dozens of requests); a pull-to-refresh starts the thread over.
  async function toLastFloor() {
    if (jumping()) return;
    const last = lastPage();
    if (last !== undefined && last > page()) {
      jumping.set(true);
      try {
        await fetchPage(last);
        // The last page is the end: no further "load more" past it.
        more.set(false);
      } finally {
        jumping.set(false);
      }
      // The rows need a layout pass before the list can scroll to its new end.
      later(() => repliesList?.scrollToEnd({ animated: true }), 120);
    } else {
      repliesList?.scrollToEnd({ animated: true });
    }
  }

  // The draft is stored once the typing pauses: writing it on every keystroke put a disk write
  // between the key and the screen, which is what made a long reply feel heavy to type.
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  function saveDraftSoon(text: string) {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftTimer = undefined;
      Storage.setItem(draftKey(props.post.id), text).catch(() => undefined);
    }, 500);
  }
  /** Quoted passage followed by the reader's own words, in the draft's `>`-line form. */
  function replyText(): string {
    return quoted() ? `${quoted()}\n\n${draft()}` : draft();
  }
  /** Persist the quote and the reader's text as one draft string, as before. */
  function saveDraftNow(): void {
    saveDraftSoon(replyText());
  }
  function setDraft(text: string) {
    typed = true;
    draft.set(text);
    saveDraftNow();
  }
  /** Quoting adds a read-only passage above the field; it never changes what the reader wrote. */
  function setQuoted(text: string) {
    typed = true;
    quoted.set(text);
    saveDraftNow();
  }

  async function send() {
    if (!canSendReply(replyText()) || sending() || uploading()) return;
    // The reply's text, then the pictures as their tags.
    // The quoted passage goes in front of the reader's own words; `draftToPost` turns the `>`
    // lines back into the forum's `[quote]`, exactly as when both were typed in one field.
    const words = replyText();
    const body = [draftToPost(words, HOST), ...attachments().map(attachmentTag)].join("\n");
    sending.set(true);
    try {
      await postReply(fid(), props.post.id, body);
      notify("reply", "回复已发布。");
      attachments.set([]);
      quoted.set("");
      setDraft("");
    } catch (e) {
      // The forum's own refusal (e.g. the 30-second limit) is shown as it words it.
      notify("reply-error", e instanceof ReplyRefused ? e.message : "回复发送失败，请重试。");
    } finally {
      sending.set(false);
    }
    // Reload the replies whether or not the post reported success: the server may have kept
    // the reply even when its answer was unclear, and the list should show what it holds.
    // The thread's cached pages are stale now, so they are asked again.
    clearThreadReplyPages(props.post.id);
    htmlCache.clear(); galleryOf.clear();
    replies.set([]);
    more.set(true);
    fetchPage(1);
  }

  // Pictures and files pasted or dropped into the reply: uploaded to the thread, sent as tags with the reply.
  const { attachments, uploading, onPaste, onFileDrop, addFiles } = createAttachments(
    (file, kind) => {
      // While a reply is edited, its pictures go through the edit form's own upload box.
      const current = editing();
      return current ? uploadEditAttachment(current.form, file, kind) : uploadAttachment(fid(), props.post.id, file, kind);
    },
    (name) => `无法上传 ${name}，请重试。`,
    "无法添加这个文件，请点「附件」重新选择。",
  );

  function quote(r: Reply) {
    setQuoted(replyQuoteInDraft(r, props.post.id));
    replyField?.focus();
  }

  // Shows floor `pid` of this thread: when the list does not have it, its page replaces the
  // replies (the posts after it load from there), then the list scrolls to the floor.
  async function showFloor(pid: string) {
    if (!replies().some((r) => r.id === pid)) {
      try {
        const found = await loadFloorPage(props.post.id, pid);
        if (found.title) title.set(found.title);
        if (found.fid && !fid()) fid.set(found.fid);
        replies.set(found.replies);
        prefetchAvatars(found.replies);
        htmlCache.clear(); galleryOf.clear();
        page.set(found.page);
        more.set(found.replies.length > 0);
        firstLoad.set(false);
      } catch (e) {
        firstLoad.set(false);
        notify("floor-error", "无法打开该帖。");
        return;
      }
    }
    const index = replies().findIndex((r) => r.id === pid);
    if (index < 0) return;
    // The list lays out the replies it was given before it can scroll to one of them.
    later(() => repliesList?.scrollToIndex({ index, viewPosition: 0 }), 0);
  }

  // A link to a floor: in this thread the floor is shown here; in another, that thread opens at it.
  function openFloor(pid: string, tid: string) {
    if (tid === props.post.id) void showFloor(pid);
    else props.onOpenThread?.(tid, pid);
  }

  // The reply the box is editing: its loaded edit form and the text in the box. While it is set, the
  // box edits that reply instead of composing a new one; the reply draft is kept aside.
  const editing = signal<{ pid: string; seq: number; form: EditForm; text: string } | null>(null);
  // Only the signed-in user's own replies can be edited.
  const isOwn = (r: Reply) => !!props.signedIn && currentUser() === r.author.name;

  // The reply's own pictures, set aside while an edit is open; the edit has its own.
  let replyPictures: Attached[] = [];

  async function startEdit(r: Reply) {
    if (sending() || uploading() || editing()) return;
    try {
      const form = await loadEditForm(fid(), props.post.id, r.id, 1);
      replyPictures = attachments();
      attachments.set([]);
      // The box shows the quotes as `>` lines; saving turns them back into the forum's quotes.
      editing.set({ pid: r.id, seq: r.seq, form, text: postToDraft(form.message) });
      replyField?.focus();
    } catch (e) {
      notify("edit-error", e instanceof ReplyRefused ? e.message : "无法编辑该回复，请重试。");
    }
  }

  function endEdit() {
    editing.set(null);
    attachments.set(replyPictures);
    replyPictures = [];
  }

  // The reply waiting for its delete to be confirmed in the dialog, or null.
  const pendingDelete = signal<{ pid: string; seq: number } | null>(null);

  // Deletes the confirmed reply, then shows the thread as the forum now holds it.
  async function removeReply() {
    const target = pendingDelete();
    pendingDelete.set(null);
    if (!target || sending() || uploading()) return;
    sending.set(true);
    try {
      const form = await loadEditForm(fid(), props.post.id, target.pid, 1);
      await deletePost(fid(), props.post.id, target.pid, 1, form);
      notify("delete", "回复已删除。");
    } catch (e) {
      notify("delete-error", e instanceof ReplyRefused ? e.message : "删除回复失败，请重试。");
    } finally {
      sending.set(false);
    }
    clearThreadReplyPages(props.post.id);
    htmlCache.clear(); galleryOf.clear();
    replies.set([]);
    more.set(true);
    fetchPage(1);
  }

  function cancelEdit() {
    // A picture still uploading would land in the reply's list, so the edit waits for it.
    if (uploading()) return;
    endEdit();
  }

  async function saveEdit() {
    const current = editing();
    if (!current || !canSendReply(current.text) || sending() || uploading()) return;
    // The pictures go with the text as tags, as a reply's do.
    const body = [draftToPost(current.text, HOST), ...attachments().map(attachmentTag)].join("\n");
    sending.set(true);
    try {
      await editPost(fid(), props.post.id, current.pid, 1, current.form, body);
      notify("edit", "回复已修改。");
      endEdit();
    } catch (e) {
      // The forum's own refusal is shown as it words it; the box keeps the text for another try.
      notify("edit-error", e instanceof ReplyRefused ? e.message : "保存修改失败，请重试。");
    } finally {
      sending.set(false);
    }
    // Reload the replies whether or not the save reported success, as after a reply: the cached
    // pages hold the old text, so they are dropped and the thread is asked again.
    clearThreadReplyPages(props.post.id);
    htmlCache.clear(); galleryOf.clear();
    replies.set([]);
    more.set(true);
    fetchPage(1);
  }

  // Adds the thread to the favorites, or removes it when it is saved.
  async function toggleFavorite() {
    try {
      if (saved()) {
        if (await removeBookmark(props.post.id)) {
          markFavorite(props.post.id, false);
          notify("favorite", "已取消收藏。");
          props.onUnfavorited?.();
        } else {
          notify("favorite-error", "取消收藏失败，请重试。");
        }
      } else if (await bookmarkPost(props.post.id)) {
        markFavorite(props.post.id, true, props.post.lastReplyAt ?? props.post.at);
        notify("favorite", "已加入收藏。");
      }
    } catch (e) {
      notify("favorite-error", "收藏失败，请重试。");
    }
  }

  // The thread's author (楼主) is the poster of floor #1, once the first page has loaded.
  const opId = () => replies().find((r) => r.seq === 1)?.author.id;
  let replyField: { focus(): void } | undefined;
  let repliesList: ListRef | undefined;
  // The list already knows the thread starter's uid: warm that avatar now, in parallel with the
  // page request, instead of waiting for the first floor to parse before asking for its picture.
  // ThreadRow uses `small`, this uses `middle` — a different file — so it is not cached already.
  const opAvatar = avatarUrlForUid(props.post.uid, "middle");
  if (opAvatar) Image.prefetch(opAvatar).catch(() => undefined);
  // Load the first page and the saved draft once.
  if (props.focusPid) void showFloor(props.focusPid);
  else fetchPage(1);
  Storage.getItem(draftKey(props.post.id))
    .then((text) => {
      if (typed) return;
      const parts = splitDraftQuote(postToDraft(text ?? ""));
      quoted.set(parts.quoted);
      draft.set(parts.own);
    })
    .catch(() => undefined);

  return (
    <View
      pan={props.onSwipeBack ? { x: backPan } : undefined}
      panActivation={props.onSwipeBack ? { activeOffsetX: 18, failOffsetY: 10 } : undefined}
      onPanEnd={props.onSwipeBack ? onSwipeEnd : undefined}
      style={{ flex: 1, alignSelf: "stretch", overflow: "hidden", opacity: entrance.opacity }}
    >
      {/* Under the title bar the title sits in the bar's caption area (the column extends up into it), centred
          on the bar's 44pt; it drags the window where nothing presses. With no bar, it keeps the top inset. */}
      <View
        // Its real height is what the posts are pushed down by: a one-line title and a two-line
        // one differ, and a fixed reserve left a blank band under the shorter title.
        onLayout={({ bounds }: { bounds: { size: { height: number } } }) => {
          const h = Math.round(bounds.size.height);
          if (h > 0 && h !== headerHeight()) headerHeight.set(h);
        }}
        style={{
          // The bar floats over the body, so it can slide away on scroll and let the text take its place.
          position: "absolute", left: 0, right: 0, top: 0, zIndex: 10,
          height: undefined,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 12,
          paddingVertical: 8,
          paddingTop: 20,
          // Two lines of a long title need the room; the title itself is drawn over the row.
          minHeight: 58,
          backgroundColor: palette().bg,
          transform: [{ translateY: titleShift() }],
          opacity: titleOpacity(),
          overflow: "hidden",
        }}
      >
        {/* Portrait: the two list columns are hidden, so this opens them as an overlay. */}
        {props.onOpenSidebars ? (
          <View
            onPress={props.onOpenSidebars}
            accessibilityLabel="版块与帖子列表"
            style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
          >
            <LineIcon name="grip" size={17} />
          </View>
        ) : null}
        {/* Back sits in the row, first, so the icons after it move right with it. */}
        {props.onBack ? (
          <View onPress={props.onBack} accessibilityLabel="返回" style={{ paddingVertical: 4, paddingHorizontal: 6 }}>
            <Text style={{ fontSize: 13, color: palette().muted }}>{"‹ 返回"}</Text>
          </View>
        ) : null}
        {/* The title is centred on the whole bar (a short one sits in the middle), and a long one
            wraps to a second line that starts at the first line's left edge. */}
        <View style={{ position: "absolute", left: 126, right: 12, top: 0, bottom: 0, justifyContent: "center", pointerEvents: "none" }}>
          <Text style={{ numberOfLines: 2, textAlign: "left", fontSize: 15, lineHeight: 19, fontWeight: 600, color: palette().text }}>{title()}</Text>
        </View>
      </View>
      {/* A virtualized list: only the replies near the viewport exist, and their views are
          reused as the user scrolls. Each row reads its reply through `item()`. */}
      <List
        style={{ flex: 1 }}
        contentStyle={{ padding: 12, gap: 12, paddingTop: headerHeight() + 8 }}
        each={replies()}
        estimatedItemSize={320}
        scrollValue={scrollOffset}
        onScroll={onThreadScroll}
        onLoadMore={loadMore}
        refreshing={refreshingThread()}
        onRefresh={() => refreshThread()}
        footer={() => <View>{loadingMoreShown() ? <LoadingBar /> : null}</View>}
        ref={(n: ListRef | null) => {
          repliesList = n ?? undefined;
        }}
      >
        {(item) => (
          <ReplyCard
            avatar={floorAvatar(item().author).src}
            avatarFallback={floorAvatar(item().author).fallback}
            name={item().author.name}
            isOp={opId() !== undefined && item().author.id === opId()}
            onAvatarPress={() => {
              profileTarget.set({ id: item().author.id, name: item().author.name, avatar: floorAvatar(item().author).src });
            }}
            meta={`#${item().seq} · ${timeAgo(item().at)}`}
            trailing={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {props.signedIn && isOwn(item()) ? (
                  <View onPress={() => void startEdit(item())} accessibilityLabel="编辑"
                    style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}>
                    <PencilIcon size={16} />
                  </View>
                ) : null}
                {props.signedIn && isOwn(item()) && item().seq !== 1 ? (
                  <View onPress={() => pendingDelete.set({ pid: item().id, seq: item().seq })} accessibilityLabel="删除"
                    style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}>
                    <TrashIcon size={16} />
                  </View>
                ) : null}
                <View onPress={() => props.signedIn ? quote(item()) : props.onSignInNeeded?.()}
                  accessibilityLabel="引用"
                  style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 6 }}>
                  <BubbleIcon size={16} />
                </View>
              </View>
            }
            body={
              // The text is selectable in place: with each `<br>` split into its own
              // paragraph (see `splitBrIntoParagraphs`), a long press lands on the right
              // line and the two handles drag freely. The selection color and the handle
              // color are one — set through `classes`, as only a class reaches it.
              <View style={{ gap: 12, alignSelf: "stretch" }}>
                <TextView
                  html={bodyHtml(item())}
                  selectable={true}
                  styles={{
                    root: { fontSize: displaySettings().body, lineHeight: Math.round(displaySettings().body * displaySettings().spacing) },
                    ...LINE_STYLES,
                    ...(item().seq === 1 ? OP_TITLE_STYLES : {}),
                  }}
                  classes={{ root: "selection:bg-blue-500" }}
                  extensions={DISCUZ_EXTENSIONS}
                  renderCustom={renderDiscuzNode}
                  onImagePress={(e: any) => {
                    // A picture opens the viewer on this post's pictures, at the one tapped, so the
                    // reader can step to the others without closing it and starting again. The
                    // original (full-size) URL the page carried rides in `title`; `src` is the
                    // compressed display copy.
                    const img = e?.image ?? e;
                    const src: string = img?.src ?? "";
                    const full: string = img?.title || src;
                    openPostImage(item(), full || src, src);
                  }}
                  onLinkPress={(e: any) => {
                    // A 4d4y thread link opens in this column; a file the post attaches is saved to Downloads;
                    // any other link opens in the system browser. A picture (or its attachment) opens the zoomable viewer.
                    // A quote's arrow goes to its floor (see `openFloor`).
                    const url: string | undefined = e?.url ?? e?.href ?? e?.link;
                    if (!url) return;
                    const floor = floorFromLink(url);
                    if (floor) {
                      openFloor(floor.pid, floor.ptid);
                      return;
                    }
                    // A picture, or a Discuz attachment that is really an image, opens the viewer at
                    // its place among this post's pictures.
                    // A bare image URL opens the viewer. An attachment opens it only when its
                    // linked file name is a picture; a .zip/.txt/.pdf goes to the download path
                    // below instead of being handed to the image decoder.
                    const attachment = isAttachmentUrl(url)
                      ? attachmentLinks(item().body).find((a) => absoluteUrl(a.url, HOST) === url)
                      : undefined;
                    const imageExt = /\.(?:jpg|jpeg|png|gif|webp|bmp)(?:[?#]|$)/i;
                    const isPicture = imageExt.test(url)
                      || (isAttachmentUrl(url) && !!attachment && imageExt.test(attachment.name));
                    if (isPicture) {
                      openPostImage(item(), url, url);
                      return;
                    }
                    const tid = threadIdFromLink(url);
                    if (tid && props.onOpenThread) {
                      props.onOpenThread(tid);
                    } else if (isAttachmentUrl(url)) {
                      void downloadAttachment(url, attachment?.name ?? "download");
                    } else {
                      void openLink(url);
                    }
                  }}
                />
                {/* Bilibili videos the post links to play under its text (the text view cannot show a player). */}
                {bilibiliRefs(item().body).map((ref) => ("url" in ref ? <BiliShortPlayer url={ref.url} /> : <BiliPlayer video={ref} />))}
                {douyinRefs(item().body).map((ref) => ("url" in ref ? <DouyinShortPlayer url={ref.url} /> : <DouyinPlayer id={ref.id} />))}
                {videoLinksIn(item().body).map((url) => (
                  <VideoLinkPlayer url={url} />
                ))}
                {xiaohongshuNoteLinks(item().body).map((link) => (
                  <XhsCard link={link} />
                ))}
              </View>
            }
          />
        )}
      </List>
      {/* Loading and failure show centred over the list (which is empty while they show). */}
      {firstLoad() && replies().length === 0 && failedPage() === null ? (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <View style={{ alignItems: "center", paddingVertical: 16, gap: 8 }}>
            <LoadingBar />
            <Text style={{ fontSize: 12, color: palette().muted }}>正在加载帖子…</Text>
          </View>
        </View>
      ) : null}
      {profileTarget() ? (
        <ProfileSheet
          uid={profileTarget()!.id}
          name={profileTarget()!.name}
          avatar={profileTarget()!.avatar}
          // A page that names no uid cannot be written to: the card then shows only the fields.
          onMessage={profileTarget()!.id ? () => {
            const t = profileTarget();
            if (!t?.id) return;
            profileTarget.set(null);
            // Straight into the writer: the card is the only step between the avatar and the text.
            pmCompose.set({ id: t.id, name: t.name });
          } : undefined}
          onClose={() => profileTarget.set(null)}
        />
      ) : null}
      {pmCompose() ? (
        <PmComposer
          uid={pmCompose()!.id}
          name={pmCompose()!.name}
          onClose={() => pmCompose.set(null)}
        />
      ) : null}
      {failedPage() !== null ? (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
          <View style={{ alignItems: "center", padding: 16, gap: 8 }}>
            <Text style={{ fontSize: 13, color: palette().muted }}>回复加载失败。</Text>
            <View
              onPress={() => fetchPage(failedPage()!)}
              accessibilityLabel="刷新"
              style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: palette().border }}
            >
              <Text style={{ fontSize: 13, color: palette().text }}>刷新</Text>
            </View>
          </View>
        </View>
      ) : null}
      {/* The bottom-right cluster, clear of the reply box: the thread's actions folded under a round
          control, then the two jump buttons. The action discs rise out above the control (absolutely
          positioned, so the jump buttons never move). A press anywhere else folds them away. */}
      {toolboxOpen() ? (
        <View
          onPress={() => toolboxOpen.set(false)}
          accessibilityLabel="收起帖子操作"
          style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 19 }}
        />
      ) : null}
      <View style={{ position: "absolute", right: 14, bottom: 104, alignItems: "center", gap: 8, zIndex: 20 }}>
          {toolboxOpen() ? (
            <View style={{ position: "absolute", right: 0, bottom: replies().length > 0 ? 136 : 48, alignItems: "center" }}>
              <ThreadActions
                saved={saved()}
                onFavorite={() => {
                  anchorToast(toolboxNode);
                  toolboxOpen.set(false);
                  if (props.signedIn) toggleFavorite();
                  else props.onSignInNeeded?.();
                }}
                onBrowser={() => {
                  anchorToast(toolboxNode);
                  toolboxOpen.set(false);
                  void openLink(threadUrl());
                }}
                onLink={() => {
                  anchorToast(toolboxNode);
                  toolboxOpen.set(false);
                  Clipboard.writeText(threadUrl());
                  notify("copy-link", "链接已复制。");
                }}
              />
            </View>
          ) : null}
          <ActionDisc
            label={toolboxOpen() ? "收起帖子操作" : "帖子操作"}
            active={toolboxOpen()}
            node={(n) => { toolboxNode = n ?? undefined; }}
            onPress={() => toolboxOpen.set(!toolboxOpen())}
          >
            <LineIcon name="grip" size={18} />
          </ActionDisc>
          {/* Jump buttons only once there are floors to jump between. */}
          {replies().length > 0 ? (
            <>
              <ActionDisc label="回到第一楼" onPress={toFirstFloor}>
                <LineIcon name="chevronUp" size={18} />
              </ActionDisc>
              <View style={{ opacity: jumping() ? 0.5 : 1 }}>
                <ActionDisc label="跳到最后一楼" onPress={jumping() ? () => undefined : () => void toLastFloor()}>
                  <LineIcon name="chevronDown" size={18} />
                </ActionDisc>
              </View>
            </>
          ) : null}
        </View>
      {/* The reply box is always visible under the thread. Signed out, sending
        a reply opens the sign-in sheet instead of silently doing nothing. */}
      <View style={{ alignSelf: "stretch" }}>
        {/* Shown while the box edits a reply: which floor, and that Send saves the edit. */}
        {editing() ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingTop: 12 }}>
              <Text style={{ fontSize: 12, color: palette().muted }}>{`正在编辑 #${editing()!.seq}`}</Text>
            </View>
        ) : null}
        {/* The box edits the reply under edit, and composes a new reply otherwise. */}
        <ReplyBox
            onFileDrop={onFileDrop}
            onAttach={addFiles}
            quote={() => (editing() ? "" : quoted())}
            onRemoveQuote={() => {
              // Drop only the quote: the reader's own words and attachments stay untouched.
              setQuoted("");
              replyField?.focus();
            }}
            draft={() => editing()?.text ?? draft()}
            onDraft={(text) => {
              const current = editing();
              if (current) editing.set({ ...current, text });
              else setDraft(text);
            }}
            sending={() => sending()}
            uploading={() => uploading()}
            attachments={() => attachments()}
            canSend={() => editing() ? canSendReply(editing()!.text) : canSendReply(replyText())}
            onSend={() => {
              if (!props.signedIn) { props.onSignInNeeded?.(); return; }
              if (editing()) void saveEdit(); else void send();
            }}
            onPaste={onPaste}
            onCancel={cancelEdit}
            cancelShown={() => editing() !== null}
            fieldRef={(field) => {
              replyField = field;
            }}
        />
      </View>
      {/* Deleting asks first. The button is red: the reply cannot be brought back. */}
      {pendingDelete() ? (
        // The popup fills the window and centres the card, which a dialog would otherwise leave at its top left.
        <Dialog
          animation="fade"
          onCancel={() => pendingDelete.set(null)}
          style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}
          backdropStyle={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0, 0, 0, 0.3)" }}
        >
          <View style={{ width: 320, padding: 20, gap: 12, borderRadius: 12, backgroundColor: palette().bg }}>
            <Text style={{ fontSize: 15, fontWeight: 600, color: palette().text }}>{`删除 #${pendingDelete()!.seq} 这条回复？`}</Text>
            <Text style={{ fontSize: 13, color: palette().muted }}>删除后无法恢复。</Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
              <View
                onPress={() => pendingDelete.set(null)}
                accessibilityLabel="取消"
                style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6, borderWidth: 1, borderColor: palette().border }}
              >
                <Text style={{ fontSize: 13, color: palette().text }}>取消</Text>
              </View>
              <View
                onPress={() => void removeReply()}
                accessibilityLabel="删除"
                style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6, backgroundColor: palette().danger }}
              >
                <Text style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>删除</Text>
              </View>
            </View>
          </View>
        </Dialog>
      ) : null}
    </View>
  );
}
