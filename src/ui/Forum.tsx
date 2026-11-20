// The signed-in screens, one at a time, as a phone shows them: the open thread, or the
// thread list with the boards beside it, or the boards — the 3-2-1 ladder over the body.
// Components run once, so the views switch inside JSX, not by early return.
import { BackHandler } from "nsh/mobile";
import { computed, createAnimatedValue, effect, LayoutAnimation, reduceMotion, type ViewRef, type ListRef, List, Scroll, signal, Storage, Text, untracked, View, windowSize, type JSX } from "nsh";
import { Dialog } from "nsh/base";
import { hideThread, isHidden } from "./hiddenThreads";
import { DEMO, clearReplyPageCache, loadBookmarks, loadChannels, loadMyReplies, loadMyThreads, loadPmUsers, loadPosts, loadReplyPage, searchThreads } from "../discuz/forum";
import { avatarUrlForUid } from "../discuz/avatarUrl";
import { userAvatar } from "../discuz/avatarCache";
import { loadNoticeCounts } from "../discuz/notifications";
import { cleanChannelTitle, mergePage, parseChannels, type Channel, type Post } from "../discuz/parse";
import { BUILTIN_CHANNELS, mergeChannels } from "../discuz/channels";
import { Thread } from "./Thread";
import { NewThread } from "./NewThread";
import { Conversation } from "./Conversation";
import { LoadingBar } from "./LoadingBar";
import { channelIcon } from "./channelIcon";
import { BoardIcon, PencilIcon, RefreshIcon } from "./icons";
import { LineIcon, type IconName } from "./lineIcons";
import { palette } from "./appearance";
import { saveLastPlace } from "./lastPlace";
import { Placeholder } from "./Placeholder";
import { PixelDino } from "./PixelArt";
import { displaySettings } from "./settings";
import { anchorToast, notify } from "./toast";
import { ThreadRow } from "./ThreadRow";
import { clearFavoriteIds, isFavorite, reconcileFavorites } from "./favorites";
import { historyEntries, isViewed, recordView } from "./history";
import { groupHistory } from "./historyGroups";
import { animateSearchChange, SearchControl, type SearchProps } from "./SearchControl";

// The boards beside the thread list, and the same folded to a rail of icons: the phone's
// first rung gives the list the rest of the width when the boards are folded away.
const BOARD_WIDTH = 168;
const BOARD_RAIL_WIDTH = 56;

// The name whose avatar a row shows: a channel's thread author. Favorites rows
// carry no author, so they show the last replier's avatar instead.
function avatarName(p: Post): string | undefined {
  return p.author ?? p.lastReplyBy;
}

// Rows that carry only a poster's name (favorites, my threads) cannot build an
// avatar URL directly — that needs a numeric uid. Resolve it through the user's
// profile once (cached a day in avatarCache), keep it here so the synchronous row
// prop can read it, and re-render when it arrives. "" remembers a miss.
const avatarByName = signal<Record<string, string>>({});
const avatarPending = new Set<string>();
const avatarQueue: string[] = [];
let avatarActive = 0;
// Cap concurrent profile lookups so a list of many names cannot crowd out the
// thread/list requests the user is waiting on.
const AVATAR_CONCURRENCY = 3;
function resolveAvatarByName(name: string | undefined): void {
  if (!name || avatarPending.has(name) || avatarByName()[name] !== undefined) return;
  avatarPending.add(name);
  avatarQueue.push(name);
  pumpAvatars();
}
function pumpAvatars(): void {
  while (avatarActive < AVATAR_CONCURRENCY && avatarQueue.length > 0) {
    const name = avatarQueue.shift()!;
    avatarActive++;
    userAvatar(name)
      .then((url) => { avatarByName.set({ ...avatarByName(), [name]: url ?? "" }); })
      .catch(() => { avatarByName.set({ ...avatarByName(), [name]: "" }); })
      .finally(() => { avatarPending.delete(name); avatarActive--; pumpAvatars(); });
  }
}

/** A row's avatar URL: by uid when known, else by the poster's name once resolved. */
function avatarFor(p: Post): string | undefined {
  return avatarUrlForUid(p.uid) ?? (avatarByName()[avatarName(p) ?? ""] || undefined);
}

/** A count in short form: 999 stays, 2389 reads as "2.4k". */
function compactCount(n: number): string {
  if (n < 1000) return String(n);
  const k = Math.floor(n / 100) / 10;
  return `${k}k`;
}

/** A row of the threads column: a section's title, or a thread. */
type ListRow = { kind: "header"; title: string } | { kind: "post"; post: Post };
type HistoryRow = ListRow;

/** The thread a row shows. A title row has none: it is never drawn as a thread, so the empty
 * thread here only keeps the types whole. */
const postOf = (r: ListRow): Post => (r.kind === "post" ? r.post : { id: "", title: "" });
const titleOf = (r: ListRow): string => (r.kind === "header" ? r.title : "");

/** A failed load: what to say, and what Retry does. */
interface Failed {
  message: string;
  retry: () => void;
}

// The first page of each list as it last loaded, keyed by list. Opening a list again
// shows it at once while its refresh runs. Cleared on sign-out: an account sees more.
// The newest lists are also kept in storage, so a launch shows the board read last time before
// the network answers; the refresh then replaces them (stale-while-revalidate).
type CachedList = { items: Post[]; more: boolean; at: number };
const listCache = new Map<string, CachedList>();
const LIST_CACHE_STORE = "visual:list-cache";
const LIST_CACHE_KEEP = 6;
const LIST_CACHE_MEMORY = 12;
const LIST_CACHE_TTL = 24 * 60 * 60 * 1000;
Storage.getItem(LIST_CACHE_STORE).then((saved) => {
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved) as Record<string, CachedList>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed)) {
      if (entry && Array.isArray(entry.items) && now - (entry.at ?? 0) < LIST_CACHE_TTL) listCache.set(key, entry);
    }
  } catch { /* a stale store is dropped */ }
}).catch(() => undefined);

let listCacheSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveListCache(): void {
  if (listCacheSaveTimer) clearTimeout(listCacheSaveTimer);
  listCacheSaveTimer = setTimeout(() => {
    const newest = [...listCache.entries()].sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, LIST_CACHE_KEEP);
    const out: Record<string, CachedList> = {};
    for (const [key, entry] of newest) out[key] = entry;
    Storage.setItem(LIST_CACHE_STORE, JSON.stringify(out)).catch(() => undefined);
  }, 600);
}

// The channel list changes rarely: drawing the last one at launch makes the boards pane instant
// while the new list loads.
const CHANNELS_STORE = "visual:channels";
const cachedChannels = signal<Channel[] | null>(null);
Storage.getItem(CHANNELS_STORE).then((saved) => {
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved) as Channel[];
    if (Array.isArray(parsed) && parsed.length > 0) cachedChannels.set(parsed);
  } catch { /* a stale store is dropped */ }
}).catch(() => undefined);

const FAVORITES_KEY = "favorites";
const MY_THREADS_KEY = "my-threads";
const MY_REPLIES_KEY = "my-replies";
const MESSAGES_KEY = "messages";
/** A board's list order: by its threads' start time, or by their last reply (the default). */
type SortOrder = "dateline" | "lastpost";

// Each board keeps its own order, remembered between runs: one board read by post time stays so
// while another stays on last-reply order. A board with no setting uses last-reply order.
const sortOrders = signal<Record<string, SortOrder>>({});
Storage.getItem("visual:sort-orders").then((saved) => {
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const orders: Record<string, SortOrder> = {};
      for (const [fid, order] of Object.entries(parsed as Record<string, unknown>)) {
        if (order === "dateline" || order === "lastpost") orders[fid] = order;
      }
      sortOrders.set(orders);
    }
  } catch { /* a stale value simply falls back to last-reply order */ }
}).catch(() => undefined);

const sortFor = (fid?: string | null): SortOrder =>
  fid && sortOrders()[fid] === "dateline" ? "dateline" : "lastpost";

/** Remembers a board's order. */
function setSortFor(fid: string, order: SortOrder) {
  sortOrders.set({ ...sortOrders(), [fid]: order });
  Storage.setItem("visual:sort-orders", JSON.stringify(sortOrders())).catch(() => undefined);
}

const forumKey = (fid: string) => `forum:${fid}:${sortFor(fid)}`;

/** Persisted view option: sort by thread start or last reply. */
let DEMO_PREVIEW_OPENED = false;

// Where the threads list was left (the row at the viewport's start and how far into it), so the
// pane opened over a thread shows the list exactly where it was. Kept per list title.
let listViewport: { key: string; y: number } | null = null;
// When a pane was last shown: a swipe still travelling from the pane below must not step it again.
let paneOpenedAt = 0;
// The list's title (its cache key) and when the next page was last asked for: set while rendering,
// read from the scroll handler, so a scroll event does not touch signals.
let listTitleKey = "";
let listPrefetchAt = 0;
// How far the list is from its end, as of the last scroll event: read when scrolling stops.
let listRest = Number.POSITIVE_INFINITY;
// Set when the reader enters a thread: the list's background warming then stops asking for more
// pages, so those requests stop competing with the thread's own first page and its avatars.
let warmingStopped = false;

const searchKey = (term: string) => `search:${term}`;

/** One channel in the list: its icon and title with its new-post count, or in the rail its
 * icon with the count as a badge. Hovering and being selected fade a tint in and out. */
function ChannelRow(props: {
  channel: Channel;
  selected: () => boolean;
  railed: () => boolean;
  onPress: () => void;
  sorting: () => boolean;
  dragging: () => boolean;
  onLongPress: () => void;
  onDragStart: (y: number) => void;
  onDragMove: (y: number) => void;
  onDragEnd: () => void;
  onNudge: (delta: number) => void;
}) {
  // Touch devices have no hover and no entrance transition: 19 channel rows
  // each owning two animated values, a motion and an effect made the sidebar
  // visibly janky. Selection and dragging are plain static styles now.
  const c = props.channel;
  const pillWidth = Math.min(22, Math.ceil(compactCount(c.newPosts).length * 5.2) + 4);
  const sorting = props.sorting;
  return (
    <View
      onPress={sorting() ? undefined : props.onPress}
      onLongPress={props.onLongPress}
      onStartShouldSetResponder={sorting() ? () => false : undefined}
      onMoveShouldSetResponder={sorting() ? (_e: any, g: any) => { props.onDragStart(g.y0); return true; } : undefined}
      onResponderGrant={sorting() ? () => true : undefined}
      onResponderMove={sorting() ? (e: any) => props.onDragMove(e.pageY) : undefined}
      onResponderRelease={sorting() ? () => props.onDragEnd() : undefined}
      onResponderTerminate={sorting() ? () => props.onDragEnd() : undefined}
      accessibilityLabel={c.title}
      style={{
        minHeight: 36, justifyContent: "center",
        paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6,
        alignItems: props.railed() ? "center" : undefined,
        backgroundColor: props.dragging() || props.selected() ? palette().selected : "transparent",
        opacity: props.dragging() ? 0.85 : 1,
      }}
    >
      {props.railed() ? (
        <View>
          <View><LineIcon name={channelIcon(c.title)} size={17} /></View>
          {sorting() ? <LineIcon name="grip" size={12} /> : null}
          {c.newPosts > 0 ? (
            <View style={{ position: "absolute", top: -4, left: 6, width: pillWidth, height: 13,
                           borderRadius: 6.5, overflow: "hidden", backgroundColor: palette().surface }}>
              <Text style={{ numberOfLines: 1, fontSize: 9, color: palette().muted, paddingLeft: 2, lineHeight: 13 }}>
                {compactCount(c.newPosts)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: sorting() ? 4 : 6 }}>
          {sorting() ? <LineIcon name="grip" size={12} /> : null}
          <View style={{ width: sorting() ? 18 : 20, alignItems: "center" }}>
            <LineIcon name={channelIcon(c.title)} size={17} />
          </View>
          <Text style={{ fontSize: displaySettings().board, color: palette().text, flex: 1, numberOfLines: 1 }}>{channelName(c)}</Text>
          {sorting() ? (
            <>
              <View onPress={() => props.onNudge(-1)} accessibilityLabel="上移一个位置"
                style={{ width: 20, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 5, backgroundColor: palette().surface }}>
                <Text style={{ fontSize: 13, color: palette().muted }}>↑</Text>
              </View>
              <View onPress={() => props.onNudge(1)} accessibilityLabel="下移一个位置"
                style={{ width: 20, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 5, backgroundColor: palette().surface }}>
                <Text style={{ fontSize: 13, color: palette().muted }}>↓</Text>
              </View>
            </>
          ) : (c.newPosts > 0 ? <Text style={{ fontSize: 12, color: palette().muted }}>{compactCount(c.newPosts)}</Text> : null)}
        </View>
      )}
    </View>
  );
}

/** A board's name as the app shows it. A page can leave "…" (or nothing) where the name should be;
 * the built-in list names the same board, so that name is used, and only a board the list does not
 * know falls back to its number. */
function channelName(c: Channel): string {
  const cleaned = cleanChannelTitle(c.title ?? "").replace(/[.…\s:：·\-—_]+$/u, "");
  const known = BUILTIN_CHANNELS.find((b) => b.id === c.id);
  // A name needs two letters or digits: a page that leaves "…" or a stray glyph where the board's
  // name should be gives the built-in name (for a board the list knows) rather than "…".
  if ((cleaned.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2) return cleaned;
  if (known) return known.title;
  return cleaned || `板块 ${c.id}`;
}

// `user` is the signed-in name, or null. The forum lists channels and threads for
// everyone; signing in or out reloads the channel list, since an account sees more.
export function Forum(props: {
  footer?: (compact: boolean) => JSX.Element;
  user: () => string | null;
  /** True while the saved session is being restored: the channel list waits for the answer. */
  restoring?: () => boolean;
  onSignInNeeded?: () => void;
}) {
  const channels = signal<Channel[] | null>(cachedChannels());
  // The boards fold to a rail of icons so the thread list beside them takes the width.
  const boardsFolded = signal(false);
  Storage.getItem("visual:boards-folded").then((v) => { if (v === "0" || v === "1") boardsFolded.set(v === "1"); }).catch(() => undefined);
  // The cached list may finish loading after this component is built. It is applied once, at
  // startup: watching `channels()` here used to fill the just-cleared signed-in list back in on
  // sign-out until the guest list arrived.
  let cacheApplied = false;
  effect(() => {
    const cached = cachedChannels();
    if (cacheApplied || !cached) return;
    cacheApplied = true;
    if (!channels()) channels.set(cached);
  });
  const channel = signal<Channel | null>(null);
  // The open board's own order; a personal list has none (it keeps the forum's default).
  const sortOrder = () => sortFor(channel()?.id);
  const favorites = signal(false);
  // The signed-in user's own threads, shown like favorites: their own column-1 entry.
  const mine = signal(false);
  // The threads the user replied to: a third list in the same section.
  const replies = signal(false);
  // Private messages: a list of correspondents, and the one whose messages are open.
  const messages = signal(false);
  // The threads opened on this device, newest first and in sections by when they were opened.
  // Its rows are a snapshot taken when the list opens, so a thread opened from it keeps its place.
  const history = signal(false);
  const historyRows = signal<HistoryRow[]>([]);
  const peer = signal<Post | null>(null);
  // Writing a new thread in the channel open in the threads column; the thread column shows the form.
  const composing = signal(false);
  const thread = signal<Post | null>(null);
  // Threads opened from a 4d4y link in the open thread, the last one shown in its column; Back pops one.
  // The threads column and its selection stay as they were.
  // Threads opened from a link in the open thread, the last one shown. `focus` is the floor a link opened.
  const detour = signal<(Post & { focus?: string })[]>([]);
  const posts = signal<Post[]>([]);
  const page = signal(1);
  const more = signal(false);

  // Title search: the term whose results the threads column shows (null while browsing a
  // channel or favorites), whether the search field is open, and what it holds.
  const searchTerm = signal<string | null>(null);
  const searchOpen = signal(false);
  const searchDraft = signal("");


  // Channels with no new posts sit under More. More opens as a menu; the channel the user
  // picks from it is pinned into the list until another channel opens.
  const moreOpen = signal(false);
  // Keep the list short by default: show the first four boards (the user's own
  // order, so the ones they drag up are the ones they see). The rest tuck under
  // the "More" stack and one clearly labelled row expands them all.
  const showAllChannels = signal(false);
  // Sort and pinned controls are used rarely: one small chip folds them away.
  const filtersOpen = signal(false);
  Storage.getItem("visual:filters-open").then((v) => {
    if (v === "0" || v === "1") filtersOpen.set(v === "1");
  }).catch(() => undefined);
  function toggleFilters() {
    const next = !filtersOpen();
    filtersOpen.set(next);
    Storage.setItem("visual:filters-open", next ? "1" : "0").catch(() => undefined);
  }
  Storage.getItem("visual:channels-all").then((v) => {
    if (v === "0" || v === "1") showAllChannels.set(v === "1");
  }).catch(() => undefined);
  function toggleShowAllChannels() {
    const next = !showAllChannels();
    showAllChannels.set(next);
    Storage.setItem("visual:channels-all", next ? "1" : "0").catch(() => undefined);
    if (!next) moreOpen.set(false);
    animateListChange();
  }
  const pinned = signal<string | null>(null);

  // Unread badges for the personal section: private messages, and replies to my
  // own threads ("帖子消息"). Read from the forum's header while signed in;
  // 0 hides the badge. Polled, not pushed: the forum has no push channel.
  const pmUnread = signal(0);
  const noticeUnread = signal(0);
  async function refreshNotify() {
    if (!props.user()) {
      pmUnread.set(0);
      noticeUnread.set(0);
      return;
    }
    const counts = await loadNoticeCounts();
    if (!counts) return; // keep whatever we had: no badge flashing to zero
    if (counts.pm >= 0) pmUnread.set(counts.pm);
    if (counts.notice >= 0) noticeUnread.set(counts.notice);
  }

  // Touch arrangement: the user's channel order, remembered between launches.
  const channelOrder = signal<string[]>([]);
  Storage.getItem("visual:channel-order").then((v) => {
    if (!v) return;
    try {
      const ids = JSON.parse(v) as unknown;
      if (Array.isArray(ids)) channelOrder.set(ids.filter((x): x is string => typeof x === "string"));
    } catch { /* a stale value simply falls back to the forum's own order */ }
  }).catch(() => undefined);
  const sortingMode = signal(false);
  // The thread a long press asked to hide; the confirm dialog shows while this is set.
  const pendingHide = signal<Post | null>(null);
  const draggingId = signal<string | null>(null);
  let dragStartY = 0;
  let dragStartIndex = 0;
  const ROW_STEP = 38;

  /** Channels in the user's order; channels never arranged yet stay at the end. */
  const orderedChannels = () => {
    const all = channels() ?? [];
    const order = channelOrder();
    if (order.length === 0) return all;
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...all].sort((a, b) => {
      const ra = rank.get(a.id) ?? 10000 + all.indexOf(a);
      const rb = rank.get(b.id) ?? 10000 + all.indexOf(b);
      return ra - rb;
    });
  };
  const currentOrder = () => orderedChannels().map((c) => c.id);
  function persistOrder(ids: string[]) {
    channelOrder.set(ids);
    Storage.setItem("visual:channel-order", JSON.stringify(ids)).catch(() => undefined);
  }
  function moveChannelTo(id: string, to: number) {
    const ids = currentOrder();
    const from = ids.indexOf(id);
    if (from < 0 || to < 0 || to >= ids.length || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    persistOrder(ids);
  }
  function nudgeChannel(id: string, delta: number) {
    const ids = currentOrder();
    moveChannelTo(id, ids.indexOf(id) + delta);
  }
  function toggleSortingMode() {
    const next = !sortingMode();
    sortingMode.set(next);
    if (next) notify("arrange", "按住版块上下拖动即可调整顺序，点「完成」保存。");
  }

  // Folded: the first four boards, plus the board the user last opened from More
  // (it stays pinned to the list until another board opens). Expanded: all of them.
  const FOLDED_COUNT = 4;
  const listed = () => {
    const all = orderedChannels();
    if (showAllChannels()) return all;
    const top = all.slice(0, FOLDED_COUNT);
    const pin = pinned();
    if (pin && !top.some((c) => c.id === pin)) {
      const picked = all.find((c) => c.id === pin);
      if (picked) return [...top, picked];
    }
    return top;
  };
  const hidden = () => {
    const all = orderedChannels();
    if (showAllChannels()) return [];
    const shown = new Set(listed().map((c) => c.id));
    return all.filter((c) => !shown.has(c.id));
  };

  // Screens move horizontally, the way a back swipe moves them: a screen entered comes from the
  // right while the screen it covers leaves to the left at the same speed, so the two read as one
  // pushing the other; a step back runs the whole thing the other way. Only `translateX` moves —
  // there is no cross-fade — so no screen is ever half-drawn over another, nothing is laid out
  // twice, and a list keeps its scroll position.
  const SLIDE_MS = 260;
  const bodyX = createAnimatedValue(0);
  // While a screen slides in over the ladder it is drawn above it; at rest the ladder is opaque and
  // the body lies under it.
  const bodyTop = signal(false);
  // Which move is current: a navigation begun mid-slide takes over, so an older animation never
  // puts the body back where the newer one has it.
  let slideSeq = 0;

  /** A screen of the body entered from the right (a step forward) or the left (a step back). */
  function enterBody(dir: "push" | "pop"): void {
    if (reduceMotion()) { bodyX.set(0); return; }
    const seq = ++slideSeq;
    bodyX.set(dir === "push" ? windowSize().width : -windowSize().width);
    void bodyX.timing(0, { duration: SLIDE_MS, easing: "easeOut" }).then(() => {
      if (seq === slideSeq) bodyX.set(0);
    }).catch(() => undefined);
  }

  /**
   * A step forward into the body: it enters from the right while the ladder under it leaves to the
   * left, both by a screen's width and in step, so the list is pushed off rather than replaced.
   * The ladder goes once it is off the screen, not at the press.
   */
  function pushBody(): void {
    const overPane = paneShown() !== null;
    if (reduceMotion()) {
      bodyX.set(0);
      bodyTop.set(false);
      if (overPane) closePaneAtOnce();
      return;
    }
    const w = windowSize().width;
    const seq = ++slideSeq;
    bodyTop.set(true);
    bodyX.set(w);
    const arrived = bodyX.timing(0, { duration: SLIDE_MS, easing: "easeOut" });
    void arrived.catch(() => undefined);
    if (overPane) {
      void panePan.timing(-w, { duration: SLIDE_MS, easing: "easeOut" }).then(() => {
        if (seq !== slideSeq) return;
        closePaneAtOnce();
        bodyTop.set(false);
      }).catch(() => undefined);
    } else {
      // Nothing under it: the screen is home once it has stopped.
      void arrived.then(() => { if (seq === slideSeq) bodyTop.set(false); });
    }
  }

  /** A step back: the body leaves to the right while the ladder returns from the left. */
  function popBodyOut(): void {
    bodyTop.set(false);
    if (reduceMotion() || (!thread() && !peer() && !composing())) { bodyX.set(0); return; }
    const seq = ++slideSeq;
    void bodyX.timing(windowSize().width, { duration: SLIDE_MS, easing: "easeOut" }).then(() => {
      // Home again: when the ladder covers it the reset is invisible, and if the ladder has
      // already gone the body must still come back — otherwise it stays off screen until the next
      // navigation.
      if (seq === slideSeq) bodyX.set(0);
    }).catch(() => undefined);
  }

  // Opening or closing More, and pinning a channel, fades the list's change. Only
  // opacity is animated: moving 19 rows with a layout animation dropped frames on
  // a phone, while a compositor-only fade stays smooth and avoids a hard jump.
  // Touch targets still react at once — no position or size is ever animated.
  function animateListChange() {
    if (reduceMotion()) return;
    const curve = { type: "easeInEaseOut" as const };
    LayoutAnimation.configureNext({
      duration: 220,
      update: { ...curve, property: "opacity" },
      create: { ...curve, property: "opacity" },
      delete: { ...curve, property: "opacity" },
    });
  }
  // The Android back key: close the most recent overlay first, then step out
  // of the open thread, and only then let the system exit the app.
  // Whether the ladder has been used to step away from the current body: after a reader has gone
  // body → list → boards → closed, one more Back leaves the thread instead of reopening the list,
  // so the ladder is no longer a loop that can never be exited.
  let ladderUsed = false;
  effect(() => {
    const body = thread()?.id ?? peer()?.id ?? composing();
    untracked(() => { ladderUsed = false; void body; });
  });
  function leaveBody(): void {
    if (composing()) { composing.set(false); enterBody("pop"); return; }
    // Detours are the body's own stack: step out of those before leaving the thread.
    if (detour().length > 0) { backFromLink(); return; }
    thread.set(null);
    peer.set(null);
    popBodyOut();
  }
  try {
    BackHandler.on("press", () => {
      if (moreOpen()) { collapseMore(); return true; }
      if (searchTerm() !== null || searchOpen()) { closeSearch(); return true; }
      // A new-thread form is body content: Back closes it, never exits the app.
      if (composing()) { leaveBody(); return true; }
      // Portrait's ladder steps back one rung: list → boards → away.
      if (portraitPane() !== null) { paneBack(); return true; }
      if (detour().length > 0) { backFromLink(); return true; }
      if (thread() || peer()) {
        // Portrait: the first Back opens the list pane over the body (3 → 2); after a full trip
        // through the ladder, Back leaves the thread instead of reopening it.
        if (!ladderUsed) { ladderUsed = true; portraitPane.set("list"); return true; }
        leaveBody(); return true;
      }
      return false;
    });
  } catch { /* a platform without a back key */ }

  function toggleMore() {
    animateListChange();
    moreOpen.set(!moreOpen());
  }
  // Going to any other channel or list closes More; picking from More keeps it open.
  function collapseMore() {
    if (!moreOpen()) return;
    animateListChange();
    moreOpen.set(false);
  }





  // Portrait gives the body the whole width, and navigates as a 3-2-1 ladder over it: the thread
  // (3), its list (2), the boards (1). A right swipe or Back opens the list over the body, again
  // opens the boards, again puts the panes away. Picking a board goes forward to its list; picking
  // a thread goes back to the body. A launch starts on the boards.
  const portraitPane = signal<"list" | "boards" | null>(null);
  // The pane follows a right swipe back up the ladder.
  const panePan = createAnimatedValue(0);
  // What is drawn: the pane that is opening, staying, or leaving. `portraitPane` is what the app
  // means; this follows it a step behind, so a close can play before the pane is taken away.
  const paneShown = signal<"list" | "boards" | null>(null);
  // The pane is a screen of the ladder, over the body: a step back slides it in from the left while
  // the body leaves to the right, and a step forward pushes it off the same way. It moves through
  // the very value its swipe uses (`panePan`), so entry, exit and the gesture follow one path, and
  // only a translation is animated — the lists inside are never re-laid out.
  const paneFade = createAnimatedValue(1);
  const paneWidth = () => windowSize().width;
  // A pane closed by a rightward swipe keeps going that way; one closed by the back arrow or a
  // screen stepping in over it leaves to its own side.
  let paneExitRight = false;
  // The pane is to go without an exit motion (the body has covered it).
  let paneSkipExit = false;
  /** Takes the ladder away at once: the screen that stepped in over it covers it now. */
  function closePaneAtOnce(): void {
    if (portraitPane() === null && paneShown() === null) {
      // Nothing to animate away: clear the flag here, since the effect will not run to consume it.
      paneSkipExit = false;
      panePan.set(0);
      paneFade.set(1);
      return;
    }
    paneSkipExit = true;
    portraitPane.set(null);
  }
  effect(() => {
    const target = portraitPane();
    untracked(() => {
      if (target !== null) {
        if (paneShown() === target) return;
        const previous = paneShown();
        const w = paneWidth();
        paneShown.set(target);
        // Within the ladder (boards ↔ list) the one pane changes what it holds: there is no second
        // screen to push, so it swaps at once rather than sliding a blank pane in. A pane opening
        // over the body is a step back, and enters from the left, the way the body leaves to the
        // right.
        if (previous !== null) return;
        paneFade.set(0.45);
        if (reduceMotion()) {
          panePan.set(0);
          paneFade.set(1);
          return;
        }
        panePan.set(-w);
        void panePan.timing(0, { duration: SLIDE_MS, easing: "easeOut" }).catch(() => undefined);
        void paneFade.timing(1, { duration: SLIDE_MS, easing: "easeOut" }).catch(() => undefined);
        return;
      }
      if (paneShown() === null) return;
      if (paneSkipExit) {
        paneSkipExit = false;
        paneShown.set(null);
        panePan.set(0);
        paneFade.set(1);
        return;
      }
      // Closing: out the side it was going, then taken away (a new open wins the race).
      const out = paneExitRight ? paneWidth() : -paneWidth();
      paneExitRight = false;
      if (reduceMotion()) {
        paneShown.set(null);
        panePan.set(0);
        paneFade.set(1);
        return;
      }
      void paneFade.timing(0, { duration: SLIDE_MS, easing: "easeIn" }).catch(() => undefined);
      void panePan.timing(out, { duration: SLIDE_MS, easing: "easeIn" }).then(() => {
        if (portraitPane() === null) {
          paneShown.set(null);
          panePan.set(0);
          paneFade.set(1);
        }
      }).catch(() => undefined);
    });
  });
  effect(() => {
    // Never the bare placeholder full screen: with nothing in the body — no thread and no
    // conversation, no new-thread form — the boards show. A conversation and the form count as
    // body content, or opening one from the list would be covered by the pane at once.
    if (!thread() && !peer() && !composing() && portraitPane() === null) {
      portraitPane.set("boards");
      // The board column is what a launch shows: its unread counts are refreshed at once, with
      // the cached numbers on screen while the fresh ones arrive.
      untracked(() => reloadChannels(true));
    }
  });

  /** Steps back one rung of the portrait ladder; false if a slide was in progress. */
  function paneBack(): boolean {
    // A screen is stepping in over the ladder and is taking it away: the back key has nothing to
    // step back to until that has played out.
    if (bodyTop() && paneShown() !== null) return false;
    const pane = portraitPane();
    if (pane === "list") {
      paneOpenedAt = Date.now();
      portraitPane.set("boards");
      // The board column refreshes its unread counts when it comes back.
      void reloadChannels(true);
      return true;
    }
    portraitPane.set(null);
    return true;
  }
  /** Shows a pane over the body; only portrait has panes. */
  function showPane(pane: "list" | "boards") {
    paneOpenedAt = Date.now();
    // A pane opening over a screen pushes that screen aside, the way it was pushed off before.
    if (paneShown() === null) popBodyOut();
    portraitPane.set(pane);
    // Coming back to the board column refreshes its unread counts at once.
    if (pane === "boards") void reloadChannels(true);
  }

  // Saves the channel and thread now open (favorites save no channel).
  function savePlace() {
    saveLastPlace({ channel: favorites() || mine() || replies() || messages() || history() ? null : channel(), thread: thread() });
  }

  // A phone launch opens on the boards (the first rung), not on the thread read last time: the
  // place is still saved, so the board the user was reading is one tap away.

  let loadingMore = false;

  const loadingMoreShown = signal(false);
  // A page after the first that fails is retried by the next scroll to the end. Only after
  // MORE_FAILURES in a row does the list's end show the failure with a Retry button.
  const MORE_FAILURES = 3;
  let moreFailures = 0;
  const moreError = signal<Failed | null>(null);
  // The first page of a channel or of favorites is loading and nothing is cached for it:
  // the column shows placeholder rows in place of the list. `listRequest` drops answers
  // that were overtaken by a later pick.
  const listLoading = signal(false);
  // True while page 1 of the open list is fetched, cached or not: the refresh icon spins.
  const refreshing = signal(false);
  let listRequest = 0;

  // Loads page `n` of a list (a channel's threads or the favorites) and merges it in;
  // page 1 replaces the list and is cached under `key`.
  function fetchList(load: (n: number) => Promise<Post[]>, n: number, key: string) {
    if (n === 1) warmingStopped = false;
    const request = n === 1 ? ++listRequest : listRequest;
    if (n === 1) refreshing.set(true);
    load(n)
      .then((list) => {
        if (request !== listRequest) return;
        moreFailures = 0;
        moreError.set(null);
        const merged = n === 1 ? { items: list, more: list.length > 0 } : mergePage(posts(), list);
        more.set(merged.more);
        posts.set(merged.items);
        if (n === 1) {
          listCache.set(key, { items: merged.items, more: merged.more, at: Date.now() });
          if (listCache.size > LIST_CACHE_MEMORY) {
            const oldest = [...listCache.entries()].sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0))[0];
            if (oldest) listCache.delete(oldest[0]);
          }
          saveListCache();
        }
        // The favorites loaded so far are saved, and saved favorites the list has dropped are pruned.
        if (key === FAVORITES_KEY) reconcileFavorites(merged.items, !merged.more);
        page.set(n);
        // A search with hits is done: its field hides, and the results and the header stay.
        if (n === 1 && list.length > 0 && key === searchKey(searchTerm() ?? "")) {
          animateSearchChange();
          searchOpen.set(false);
        }
        // Warm the first few reply pages after the list settles, one at a time: enough that opening
        // one of the first rows is instant, gentle enough not to compete with the list's own
        // pictures and avatars for the connection.
        if (n === 1 && !DEMO) {
          setTimeout(() => {
            let i = 0;
            const next = () => {
              if (warmingStopped || i >= Math.min(5, list.length)) return;
              const p = list[i++];
              if (!p.id) { next(); return; }
              void loadReplyPage(p.id, 1).finally(() => { if (!warmingStopped) setTimeout(next, 80); });
            };
            next();
          }, 350);
        }
      })
      .catch((e) => {
        if (request !== listRequest) return;
        if (n === 1) {
          notify("list", "帖子加载失败，点此重试。", () => {
            listLoading.set(true);
            fetchList(load, 1, key);
          });
          return;
        }
        moreFailures++;
        if (moreFailures >= MORE_FAILURES) {
          moreError.set({ message: "加载更多帖子失败。", retry: () => loadMore() });
          notify("more", "加载更多帖子失败。 Tap to retry.", () => {
            moreError.set(null);
            moreFailures = 0;
            loadMore();
          });
        }
      })
      .finally(() => {
        // An overtaken page must not release the lock held by the newer page.
        if (request !== listRequest) return;
        loadingMore = false;
        loadingMoreShown.set(false);
        listLoading.set(false);
        if (n === 1) refreshing.set(false);
      });
  }

  function loadMore(quiet = false) {
    // Search results are one page: there is no next page to fetch.
    if (searchTerm() !== null) return;
    // Once the end shows Retry, scrolling does not fetch again: the button does.
    if (loadingMore || !more() || moreError()) return;
    // Favorites page the same way as a channel: the next page of the favorites.
    if (favorites()) {
      loadingMore = true;
      if (!quiet) loadingMoreShown.set(true);
      fetchList((p) => loadBookmarks(p), page() + 1, FAVORITES_KEY);
    } else if (mine()) {
      loadingMore = true;
      if (!quiet) loadingMoreShown.set(true);
      fetchList((p) => loadMyThreads(p), page() + 1, MY_THREADS_KEY);
    } else if (replies()) {
      loadingMore = true;
      if (!quiet) loadingMoreShown.set(true);
      fetchList((p) => loadMyReplies(p), page() + 1, MY_REPLIES_KEY);
    } else if (messages()) {
      loadingMore = true;
      if (!quiet) loadingMoreShown.set(true);
      fetchList((p) => loadPmUsers(p), page() + 1, MESSAGES_KEY);
    } else if (channel()) {
      const c = channel()!;
      loadingMore = true;
      if (!quiet) loadingMoreShown.set(true);
      fetchList((p) => loadPosts(c.id, p, sortFor(c.id)), page() + 1, forumKey(c.id));
    }
  }

  // Opens a list: from the cache at once when it is there, placeholder rows otherwise;
  // either way its first page is fetched and replaces what is shown.
  function openList(key: string, load: (n: number) => Promise<Post[]>, keepPane = false) {
    detour.set([]);
    // Portrait: a board or personal list opens as the list pane over the body (unless the launch
    // fills it in place, keeping the boards beside it).
    if (!keepPane) showPane("list");
    const cached = listCache.get(key);
    posts.set(cached ? cached.items : []);
    more.set(cached ? cached.more : true);
    page.set(1);
    moreFailures = 0;
    moreError.set(null);
    listLoading.set(!cached);
    fetchList(load, 1, key);
  }

  function showFavorites() {
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    pinned.set(null);
    favorites.set(true);
    mine.set(false);
    replies.set(false);
    messages.set(false);
    history.set(false);
    channel.set(null);
    thread.set(null);
    openList(FAVORITES_KEY, (p) => loadBookmarks(p));
    savePlace();
  }

  function showMine() {
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    mine.set(true);
    favorites.set(false);
    replies.set(false);
    messages.set(false);
    history.set(false);
    channel.set(null);
    thread.set(null);
    openList(MY_THREADS_KEY, (p) => loadMyThreads(p));
    savePlace();
  }

  function showReplies() {
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    replies.set(true);
    messages.set(false);
    history.set(false);
    favorites.set(false);
    mine.set(false);
    channel.set(null);
    thread.set(null);
    openList(MY_REPLIES_KEY, (p) => loadMyReplies(p));
    savePlace();
  }

  function showMessages() {
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    messages.set(true);
    history.set(false);
    favorites.set(false);
    mine.set(false);
    replies.set(false);
    channel.set(null);
    thread.set(null);
    peer.set(null);
    openList(MESSAGES_KEY, (p) => loadPmUsers(p));
    savePlace();
  }

  // The history, as sections of threads. Its rows are taken now, from the history as it stands,
  // and the threads column shows them with no further loading: every thread is already there.
  function showHistory() {
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    history.set(true);
    favorites.set(false);
    mine.set(false);
    replies.set(false);
    messages.set(false);
    channel.set(null);
    thread.set(null);
    peer.set(null);
    snapshotHistory();
    // Portrait: the history is a list, so it opens the list pane over the boards.
    showPane("list");
    savePlace();
  }

  // Takes the history's rows as they stand now, for the list the threads column shows.
  function snapshotHistory() {
    const sections = groupHistory(historyEntries(), new Date());
    const rows: HistoryRow[] = [];
    for (const s of sections) {
      rows.push({ kind: "header", title: s.title });
      for (const p of s.posts) rows.push({ kind: "post", post: p });
    }
    detour.set([]);
    historyRows.set(rows);
    posts.set(sections.flatMap((s) => s.posts));
    more.set(false);
    moreError.set(null);
    listLoading.set(false);
    refreshing.set(false);
  }

  function openChannel(c: Channel, keepPane = false) {
    composing.set(false);
    collapseMore();
    searchTerm.set(null);
    searchOpen.set(false);
    favorites.set(false);
    mine.set(false);
    replies.set(false);
    messages.set(false);
    history.set(false);
    channel.set(c);
    // A channel from More stays in the list while it is open; any other pick sends it back.
    pinned.set(c.newPosts === 0 ? c.id : null);
    thread.set(null);
    openList(forumKey(c.id), (p) => loadPosts(c.id, p, sortFor(c.id)), keepPane);
    savePlace();
  }

  function openThread(p: Post) {
    // Stop warming other threads: the pages already warming finish, but no new ones start, leaving
    // the connection to this thread's own page and avatars.
    warmingStopped = true;
    // The ladder stays under the screen as it slides in, and goes once it has been pushed off; that
    // is what makes the press read as stepping into the thread rather than replacing the list.
    pushBody();
    composing.set(false);
    if (messages()) {
      detour.set([]);
      peer.set(p);
      return;
    }
    // Opened from the history, the thread shows as it does from its channel.
    detour.set([]);
    thread.set(p);
    // A thread opened from a list is recorded. A 4d4y link's thread opens through openLinkedThread instead, and is not.
    recordView(p);
    savePlace();
  }

  // A 4d4y thread link pressed in the open thread: its thread replaces the column's, until Back.
  function openLinkedThread(tid: string, pid?: string) {
    pushBody();
    detour.set([...detour(), { id: tid, title: "", focus: pid }]);
  }

  function backFromLink() {
    enterBody("pop");
    detour.set(detour().slice(0, -1));
  }

  // Shows the threads whose titles contain `term`, in the threads column. The channel or
  // favorites open before it stays selected in the column, and closing search returns to it.
  function openSearch(term: string) {
    composing.set(false);
    const t = term.trim();
    if (!t) return;
    searchTerm.set(t);
    searchOpen.set(true);
    searchDraft.set(t);
    openList(searchKey(t), () => searchThreads(t));
  }

  // Closes the search field. With results showing, the channel or favorites they replaced
  // comes back; an empty search only hides the field.
  function closeSearch() {
    const wasSearching = searchTerm() !== null;
    searchTerm.set(null);
    searchOpen.set(false);
    searchDraft.set("");
    if (!wasSearching) return;
    if (favorites()) {
      openList(FAVORITES_KEY, (p) => loadBookmarks(p));
    } else if (mine()) {
      openList(MY_THREADS_KEY, (p) => loadMyThreads(p));
    } else if (replies()) {
      openList(MY_REPLIES_KEY, (p) => loadMyReplies(p));
    } else if (messages()) {
      openList(MESSAGES_KEY, (p) => loadPmUsers(p));
    } else if (history()) {
      snapshotHistory();
    } else if (channel()) {
      const c = channel()!;
      openList(forumKey(c.id), (p) => loadPosts(c.id, p, sortFor(c.id)));
    } else {
      posts.set([]);
      more.set(false);
    }
  }

  // A new thread goes into the board open in the list: not into favorites, the user's own posts
  // or replies, messages, or the results of a title search.
  const canCompose = () => !!props.user() && !!channel() && !favorites() && !mine() && !replies() && !messages() && !history() && searchTerm() === null;
  function openComposer() {
    if (!canCompose()) return;
    // The form is body content, so it steps in over the list the same way a thread does.
    pushBody();
    composing.set(true);
  }
  // After a post: the board's list reloads, and the new thread opens when the forum showed it.
  function threadPosted(thread: Post | undefined) {
    const c = channel();
    composing.set(false);
    if (c) openChannel(c);
    if (thread) openThread(thread);
  }
  const searchProps: SearchProps = {
    open: searchOpen,
    draft: searchDraft,
    term: () => searchTerm() ?? "",
    signedIn: () => !!props.user(),
    onDraft: (text: string) => searchDraft.set(text),
    // Submitting searches; the field hides once the results arrive with hits (see fetchList).
    onSubmit: openSearch,
    onOpen: () => {
      animateSearchChange();
      searchOpen.set(true);
    },
    // A press outside the field: the field hides, and its draft goes back to the search shown.
    onHide: () => {
      animateSearchChange();
      searchOpen.set(false);
      searchDraft.set(searchTerm() ?? "");
    },
    onClose: () => {
      animateSearchChange();
      closeSearch();
    },
  };

  // The threads column's title: the search it shows, else the channel or list open.
  const headerTitle = () =>
    searchTerm() !== null ? `包含 “${searchTerm()}” 的帖子` : favorites() ? "收藏" : mine() ? "我的主题" : replies() ? "我的回复" : messages() ? "私信" : history() ? "历史" : channel() ? channelName(channel()!) : "帖子";

  // Nothing is open yet (no channel, list or search), so the column has nothing to list.
  const nothingPicked = () =>
    searchTerm() === null && !favorites() && !mine() && !replies() && !messages() && !history() && !channel();

  // The rows the threads column lists: the history's sections, or the threads as they are.
  // `computed` keeps the array stable until the posts (or the hidden set or the history) change,
  // so an unrelated re-render does not hand the list a new array and re-render every row.
  // Threads the user hid ("隐藏该贴") are left out.
  const listRows = computed(
    (): ListRow[] =>
      history()
        ? historyRows().filter((r) => (r.kind !== "post" ? true : !isHidden(r.post.id)))
        : posts().filter((p) => !isHidden(p.id)).map((post): ListRow => ({ kind: "post", post })),
  );

  // True while the channel list is being fetched: the refresh icon dims and ignores presses.
  const channelsLoading = signal(false);

  // Only the newest request may set the list, so an earlier answer cannot
  // replace a later one (a signed-out load finishing after a signed-in one).
  let channelsRequest = 0;

  // `quiet` drops a failure silently: after sign-out, the channel list may refuse
  // the signed-out view, and that is expected rather than an error to show.
  function reloadChannels(quiet = false) {
    if (channelsLoading()) return;
    channelsLoading.set(true);
    const request = ++channelsRequest;
    loadChannels()
      .then((list) => {
        if (request !== channelsRequest) return;
        // A page that carries no "今日" counts (all zeros) keeps the last numbers instead of
        // wiping them: the board column should not go blank between refreshes.
        const prev = new Map((channels() ?? []).map((c) => [c.id, c.newPosts]));
        const fresh = list.every((c) => c.newPosts === 0)
          ? list.map((c) => ({ ...c, newPosts: prev.get(c.id) ?? 0 }))
          : list;
        channels.set(fresh);
        cachedChannels.set(fresh);
        Storage.setItem(CHANNELS_STORE, JSON.stringify(fresh)).catch(() => undefined);
        // Preview only: open the first channel and thread so the three-column layout is visible.
        if (DEMO && list.length > 0 && !DEMO_PREVIEW_OPENED) {
          DEMO_PREVIEW_OPENED = true;
          openChannel(list.find((c) => c.title === "Discovery") ?? list[0]);
          setTimeout(() => { const first = posts()[0]; if (first) openThread(first); }, 350);
        }
      })
      .catch((e) => {
        if (request !== channelsRequest || quiet) return;
        // Signed out, a failed channel list is not an error to report: the sign-in dialog is what is needed.
        if (!props.user()) {
          props.onSignInNeeded?.();
          return;
        }
        notify("channels", "版块加载失败，点此重试。", () => reloadChannels());
      })
      .finally(() => {
        if (request === channelsRequest) channelsLoading.set(false);
      });
  }

  // Refresh the open list: favorites or the channel's threads, from page 1.
  function refreshThreads() {
    // Refreshed in place: the rows stay until the new page replaces them, so the list does not
    // blink through an empty frame (the old path also cleared the thread and re-ran the layout
    // animation, which read as a flash while scrolling).
    const term = searchTerm();
    if (term !== null) { fetchList(() => searchThreads(term), 1, searchKey(term)); return; }
    if (favorites()) { fetchList((p) => loadBookmarks(p), 1, FAVORITES_KEY); return; }
    if (mine()) { fetchList((p) => loadMyThreads(p), 1, MY_THREADS_KEY); return; }
    if (replies()) { fetchList((p) => loadMyReplies(p), 1, MY_REPLIES_KEY); return; }
    if (messages()) { fetchList((p) => loadPmUsers(p), 1, MESSAGES_KEY); return; }
    if (history()) { snapshotHistory(); return; }
    const c = channel();
    if (c) fetchList((p) => loadPosts(c.id, p, sortFor(c.id)), 1, forumKey(c.id));
  }

  // Load the channel list on launch, and again on every sign-in or sign-out. Signing
  // out closes the open list and thread: a hidden channel, or favorites, needs an
  // account, so its threads must not stay on screen. A list still loading is dropped.
  // Whether the previous run saw a signed-in user: null on launch, so only a real sign-out is quiet.
  let notifyTimer: number | undefined;
  const wasSignedIn = signal<boolean | null>(null);
  effect(() => {
    const signedIn = !!props.user();
    // Read outside `untracked`, so the effect runs again the moment the restore answers.
    const pending = props.restoring?.() ?? false;
    // A launch with saved cookies asks for the boards once, as the member: asking now would load
    // them signed out and load them again a second later.
    if (!signedIn && pending) return;
    untracked(() => {
      // Thread pages are per account too: sign-in and sign-out both drop them.
      clearReplyPageCache();
      if (!signedIn) {
        listRequest++;
        // Search needs an account: its field and results go with the sign-out.
        searchTerm.set(null);
        searchOpen.set(false);
        searchDraft.set("");
        // Cached lists are per account: they go with the sign-out.
        listCache.clear();
        Storage.removeItem(LIST_CACHE_STORE).catch(() => undefined);
        clearFavoriteIds();
        // The signed-in channel list goes too: the reload below brings the signed-out one.
        channels.set(null);
        favorites.set(false);
        mine.set(false);
        replies.set(false);
        messages.set(false);
        history.set(false);
        channel.set(null);
        thread.set(null);
        posts.set([]);
        page.set(1);
        more.set(false);
        listLoading.set(false);
        refreshing.set(false);
        loadingMoreShown.set(false);
        loadingMore = false;
        moreFailures = 0;
        moreError.set(null);
      }
      reloadChannels(wasSignedIn() === true && !signedIn);
      // Keep the unread badges fresh: once now, then every 90 s while signed in.
      if (notifyTimer !== undefined) { clearInterval(notifyTimer); notifyTimer = undefined; }
      if (signedIn) {
        // The list's own request goes first; the badges can arrive a moment later.
        setTimeout(() => { void refreshNotify(); }, 900);
        notifyTimer = setInterval(() => { void refreshNotify(); }, 90000);
      } else {
        pmUnread.set(0);
        noticeUnread.set(0);
      }
      wasSignedIn.set(signedIn);
    });
  });

  // One personal-section row: a line icon, a label and a 48dp touch target.
  // These stay visible when signed out; tapping offers the sign-in sheet.
  // Avatars for name-only rows (favorites, my threads): resolve each once when the
  // list changes. userAvatar dedups and caches, and untracked keeps this effect from
  // re-running when the names resolve.
  effect(() => {
    const ps = posts();
    untracked(() => {
      for (const p of ps) if (!p.uid) resolveAvatarByName(avatarName(p));
      // "My replies" rows carry no poster at all; they fall back to my own avatar.
      if (props.user()) resolveAvatarByName(props.user() ?? undefined);
    });
  });

  function requireSignIn(action: () => void) {
    if (!props.user()) {
      notify("sign-in", "登录后即可查看此项内容。");
      props.onSignInNeeded?.();
      return;
    }
    action();
  }

  function navRow(o: { icon: IconName; label: string; active: () => boolean; onPress: () => void; badge?: () => number; railed?: () => boolean }): JSX.Element {
    const isRail = () => (o.railed ? o.railed() : boardsFolded());
    const size = isRail() ? 19 : 17;
    const count = o.badge ? o.badge() : 0;
    const badge = count > 0 ? (
      <View
        style={{
          position: "absolute", top: -5, left: size - 8,
          minWidth: 14, height: 14, paddingHorizontal: 3, borderRadius: 7,
          backgroundColor: "#e5484d", alignItems: "center", justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 9, color: "#ffffff", numberOfLines: 1 }}>
          {count > 99 ? "99+" : String(count)}
        </Text>
      </View>
    ) : null;
    const iconBlock = (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <LineIcon name={o.icon} size={size} />
        {badge}
      </View>
    );
    return (
      <View
        onPress={o.onPress}
        accessibilityLabel={count > 0 ? `${o.label}，${count} 条未读` : o.label}
        style={{
          minHeight: 36,
          justifyContent: "center",
          paddingVertical: 4,
          paddingHorizontal: isRail() ? 4 : 8,
          borderRadius: 6,
          backgroundColor: o.active() ? palette().selected : "transparent",
        }}
      >
        {isRail() ? (
          <View style={{ alignItems: "center" }}>{iconBlock}</View>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {iconBlock}
            <Text style={{ fontSize: displaySettings().board, color: palette().text, flex: 1 }}>{o.label}</Text>
          </View>
        )}
      </View>
    );
  }

  // A channel row: its icon, title and count, or the icon and badge in the rail.
  function renderChannel(c: Channel, railedFn: () => boolean = boardsFolded) {
    const selected = () => searchTerm() === null && !favorites() && !mine() && !replies() && !messages() && !history() && channel()?.id === c.id;
    return (
      <ChannelRow
        channel={c} selected={selected} railed={railedFn}
        onPress={() => openChannel(c)}
        sorting={() => sortingMode()}
        dragging={() => draggingId() === c.id}
        onLongPress={() => { if (!sortingMode()) toggleSortingMode(); }}
        onDragStart={(y) => {
          dragStartY = y;
          draggingId.set(c.id);
          dragStartIndex = currentOrder().indexOf(c.id);
        }}
        onDragMove={(y) => {
          const id = draggingId();
          if (!id) return;
          const n = currentOrder().length;
          const to = Math.max(0, Math.min(n - 1, dragStartIndex + Math.round((y - dragStartY) / ROW_STEP)));
          moveChannelTo(id, to);
        }}
        onDragEnd={() => draggingId.set(null)}
        onNudge={(d) => nudgeChannel(c.id, d)}
      />
    );
  }

  // The thread the body shows: the last one opened from a link, else the list's thread.
  const shownThread = () => (detour().length > 0 ? detour()[detour().length - 1] : thread());

  // The account row under the boards; `ChannelColumn` has its own `props`, so it reads this one.
  const forumFooter = props.footer;
  // The signed-in name, read by ThreadsColumn through the forum's props (its own are the pane's).
  const forumUser = props.user;

  // The boards: the channel list with its unfold/arrange controls, the personal entries and the
  // account row. Folded, it is a rail of icons and counts so the thread list beside it takes the
  // width; unfold it from the same header control, or from the rail's own button.
  function ChannelColumn(): JSX.Element {
    const isRail = () => boardsFolded();
    // The boards' refresh: "版块加载失败，点此重试。" points at it.
    let channelsNode: ViewRef | undefined;
    return (
      <View style={{ width: isRail() ? BOARD_RAIL_WIDTH : BOARD_WIDTH, borderRightWidth: 1, borderColor: palette().border }}>
        <View
          style={{
            paddingTop: 12,
            paddingHorizontal: isRail() ? 0 : 12,
            paddingBottom: 4,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: isRail() ? "center" : "space-between",
          }}
        >
          {isRail() ? null : <Text style={{ fontSize: 13, fontWeight: 600, color: palette().muted }}>版块</Text>}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            {isRail() ? null : (
              <View
                ref={(n: ViewRef | null) => { channelsNode = n ?? undefined; }}
                onPress={channelsLoading() ? undefined : () => { anchorToast(channelsNode); reloadChannels(); }}
                accessibilityLabel="刷新版块"
                style={{ minWidth: 34, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
              >
                <RefreshIcon size={14} enabled={!channelsLoading()} spinning={channelsLoading()} />
              </View>
            )}
            <View
              onPress={() => {
                // The same fold the swipe does; the list beside it takes the width back at once.
                boardsFolded.set(!boardsFolded());
                Storage.setItem("visual:boards-folded", boardsFolded() ? "1" : "0").catch(() => undefined);
              }}
              accessibilityLabel={boardsFolded() ? "展开版块" : "收起版块"}
              style={{
                minWidth: 34, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 6,
                // Folded, the same icon sits on a tint: the row says what the press will do without
                // swapping the picture for an arrow.
                backgroundColor: boardsFolded() ? palette().selected : "transparent",
              }}
            >
              <BoardIcon size={17} />
            </View>
          </View>
        </View>
        <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: isRail() ? 4 : 8, paddingBottom: 6, gap: 2 }}>
          {/* The fold chip and the arrange chip, side by side at the top of the list. */}
          {(channels()?.length ?? 0) > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, justifyContent: isRail() ? "center" : "flex-start" }}>
              {isRail() ? null : (
                <View
                  onPress={toggleShowAllChannels}
                  accessibilityLabel={showAllChannels() ? "收起，只看前四个版块" : "展开全部版块"}
                  style={{ flex: 1, minHeight: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, borderRadius: 6, backgroundColor: palette().surface }}
                >
                  <LineIcon name={showAllChannels() ? "chevronUp" : "list"} size={14} />
                  <Text style={{ fontSize: 11, color: palette().muted, flex: 1, numberOfLines: 1 }}>
                    {showAllChannels() ? `收起 · 前 ${FOLDED_COUNT} 个` : `展开全部 ${channels()?.length ?? 0} 个`}
                  </Text>
                </View>
              )}
              {/* The sorting grip is hidden in the rail: a three-line icon there reads as a menu.
                  Expanded, the button and its behaviour are unchanged. */}
              {isRail() ? null : (
                <View
                  onPress={toggleSortingMode}
                  accessibilityLabel={sortingMode() ? "完成排序" : "调整版块顺序"}
                  style={{ minWidth: 44, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: sortingMode() ? palette().selected : palette().surface }}
                >
                  <Text style={{ fontSize: 11, color: sortingMode() ? palette().link : palette().muted }}>
                    {sortingMode() ? "完成" : "排序"}
                  </Text>
                </View>
              )}
            </View>
          ) : null}
          {listed().map((c) => renderChannel(c))}
          {/* The boards without new posts, in place under one row: a tap shows them, another hides them. */}
          {hidden().length > 0 ? (
            <View>
              <View
                onPress={toggleMore}
                accessibilityLabel="更多版块"
                style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32, paddingHorizontal: isRail() ? 4 : 8, borderRadius: 6, backgroundColor: isRail() ? "transparent" : palette().surface }}
              >
                <LineIcon name={moreOpen() ? "chevronUp" : "list"} size={14} />
                {isRail() ? null : (
                  <Text style={{ fontSize: 11, color: palette().muted, flex: 1, numberOfLines: 1 }}>
                    {moreOpen() ? "收起更多版块" : `更多版块 ${hidden().length}`}
                  </Text>
                )}
              </View>
              {moreOpen() ? hidden().map((c) => renderChannel(c)) : null}
            </View>
          ) : null}
        </Scroll>
        <View style={{
          borderTopWidth: 1, borderColor: palette().border,
          paddingHorizontal: isRail() ? 4 : 8, paddingTop: 4, paddingBottom: 4,
          flexShrink: 0,
        }}>
          {/* The five personal entries. Signed out, a tap opens the sign-in sheet instead of hiding
              them; the four thread lists carry the forum's unread counts. */}
          {navRow({ icon: "star", label: "收藏", active: () => favorites() && searchTerm() === null, onPress: () => requireSignIn(showFavorites) })}
          {navRow({ icon: "doc", label: "我的主题", active: () => mine() && searchTerm() === null, onPress: () => requireSignIn(showMine), badge: () => noticeUnread() })}
          {navRow({ icon: "bubble", label: "我的回复", active: () => replies() && searchTerm() === null, onPress: () => requireSignIn(showReplies) })}
          {navRow({ icon: "mail", label: "私信", active: () => messages() && searchTerm() === null, onPress: () => requireSignIn(showMessages), badge: () => pmUnread() })}
          {navRow({ icon: "clock", label: "历史", active: () => history() && searchTerm() === null, onPress: () => requireSignIn(showHistory) })}
        </View>
        {forumFooter ? forumFooter(isRail()) : null}
      </View>
    );
  }

  // The thread list: the second rung. It fills the window when it is opened alone, and takes what
  // the boards leave when they sit beside it. A back arrow returns to the boards.
  function ThreadsColumn(props: { onBack?: () => void; width?: number } = {}): JSX.Element {
    let threadsList: ListRef | undefined;
    // The order row hides as the threads scroll up and returns at the top: only when the list has
    // the window to itself (the full-screen pane), where its rows are the whole screen. The title
    // row above it never moves.
    const collapsing = !!props.onBack;
    const orderHeight = signal(0);
    const listScroll = createAnimatedValue(0);
    const floating = () => collapsing && listRows().length > 0;
    // The room the order row takes: none when this list has no order setting (favorites, the user's
    // own threads, messages, history, a search), which also keeps a stale height from leaving a gap.
    // The order row's height is measured on layout; until then use the same 40 pt the slide
    // animation assumes, so the list's top padding does not jump on the first frame.
    const orderRoom = () => (channel() && searchTerm() === null ? (orderHeight() || 40) : 0);
    const orderShift = () =>
      listScroll.interpolate({ inputRange: [0, 80], outputRange: [0, -(orderHeight() || 40)], extrapolate: "clamp" });
    const orderOpacity = () =>
      listScroll.interpolate({ inputRange: [0, 60], outputRange: [1, 0], extrapolate: "clamp" });
    // The list's refresh: a failure message ("帖子加载失败，点此重试。") points at the button that
    // started the load.
    let refreshNode: ViewRef | undefined;
    listTitleKey = headerTitle();
    // The list's scroll offset, taken from its own scroll events, kept for the pane to restore.
    // Measuring the position natively on every scroll is what made scrolling stutter.
    function rememberViewport(e: { offset?: { y?: number }; contentSize?: { height?: number }; size?: { height?: number } }): void {
      listViewport = { key: listTitleKey, y: e?.offset?.y ?? 0 };
      listRest = (e?.contentSize?.height ?? 0) - ((e?.offset?.y ?? 0) + (e?.size?.height ?? 0));
      // The header's motion follows the offset: up as the rows go up, back at the top.
      if (collapsing) listScroll.set(Math.max(0, e?.offset?.y ?? 0));
    }

    // The next page is asked for once the finger stops: fetching and inserting rows mid-scroll
    // was what made the list stutter. Two screens ahead, so it is there before the end is reached.
    function onListScrollEnd(): void {
      if (listRest >= 2000) return;
      const now = Date.now();
      if (now - listPrefetchAt < 400) return;
      listPrefetchAt = now;
      void loadMore(true);
    }
    // A different list (another board, favorites, a search) starts at its top: the header comes
    // back with it, even if the last list was scrolled with the header tucked away.
    effect(() => {
      headerTitle();
      untracked(() => {
        listScroll.set(0);
        // Switching lists inside the already-open pane (e.g. starting or closing a search) keeps
        // `paneShown` at "list", so the pane effect below does not run: start the new list at its
        // top rather than at the old list's scroll offset.
        if (paneShown() !== null) {
          listViewport = null;
          threadsList?.scrollToOffset({ offset: 0, animated: false });
        }
      });
    });
    // Reopening the list over a thread puts it back where it was: the same rows in the same places.
    effect(() => {
      const pane = paneShown();
      if (pane !== "list") return;
      untracked(() => {
        const saved = listViewport && listViewport.key === headerTitle() ? listViewport : null;
        const tid = thread()?.id;
        const index = tid ? listRows().findIndex((r) => r.kind === "post" && r.post.id === tid) : -1;
        setTimeout(() => {
          if (saved) threadsList?.scrollToOffset({ offset: saved.y, animated: false });
          else if (index >= 0) threadsList?.scrollToIndex({ index, animated: false });
        }, 80);
      });
    });
    return (
      <View style={{ width: props.width ?? windowSize().width, borderRightWidth: 1, borderColor: palette().border }}>
        {/* The title row stays put: the board's name, the search field, the new-thread pencil and
            the refresh button are how the list is driven, so they never scroll away. */}
        <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          {props.onBack ? (
            <View
              onPress={props.onBack}
              accessibilityLabel="返回板块栏"
              style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
            >
              <LineIcon name="chevronLeft" size={20} />
            </View>
          ) : null}
          {/* The board's name, with a small red dot while notices or private messages wait. */}
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
            <Text style={{ fontSize: 16, fontWeight: 600, color: palette().text, numberOfLines: 1, flexShrink: 1 }}>{headerTitle()}</Text>
            {noticeUnread() + pmUnread() > 0 ? (
              <View accessibilityLabel="有未读提醒或短消息" style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#e5484d" }} />
            ) : null}
          </View>
          <SearchControl {...searchProps} />
          {canCompose() ? (
            <View
              onPress={openComposer}
              accessibilityLabel="发新帖"
              style={{ minWidth: 34, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
            >
              <PencilIcon size={17} />
            </View>
          ) : null}
          <View
            ref={(n: ViewRef | null) => { refreshNode = n ?? undefined; }}
            onPress={refreshing() || (!favorites() && !mine() && !replies() && !messages() && !history() && !channel()) ? undefined : () => { anchorToast(refreshNode); refreshThreads(); }}
            accessibilityLabel="刷新帖子"
            style={{ minWidth: 34, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
          >
            <RefreshIcon size={14} enabled={!refreshing() && (favorites() || mine() || replies() || messages() || history() || !!channel())} spinning={refreshing()} />
          </View>
        </View>
        {/* Below the title: the order row over the list. Once the list has rows and fills the
            window, the order row floats — it slides away while the threads scroll up, so the rows
            run through the space it leaves, and comes back when the list is back at its top. Beside
            the boards it stays in place, as there it is one column of two. */}
        <View style={{ flex: 1, overflow: "hidden" }}>
        <View
          onLayout={({ bounds }: { bounds: { size: { height: number } } }) => {
            const h = Math.round(bounds.size.height);
            if (h > 0 && h !== orderHeight()) orderHeight.set(h);
          }}
          style={floating() ? {
            position: "absolute", left: 0, right: 0, top: 0, zIndex: 8,
            backgroundColor: palette().bg,
            transform: [{ translateY: orderShift() }],
            opacity: orderOpacity(),
          } : undefined}
        >
        {/* Only a board's threads carry an order setting, and each board remembers its own. */}
        {channel() && searchTerm() === null ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingBottom: 6 }}>
            <View
              onPress={toggleFilters}
              accessibilityLabel={filtersOpen() ? "收起筛选" : "展开筛选"}
              style={{ width: 30, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 5, backgroundColor: palette().surface }}
            >
              <LineIcon name={filtersOpen() ? "chevronUp" : "list"} size={14} />
            </View>
            {filtersOpen() ? (
              <>
                <View onPress={() => { const c = channel(); if (c && sortOrder() !== "dateline") { setSortFor(c.id, "dateline"); refreshThreads(); } }}
                  accessibilityLabel="按发帖时间排序"
                  style={{ height: 28, justifyContent: "center", alignItems: "center", paddingHorizontal: 8, borderRadius: 5, backgroundColor: sortOrder() === "dateline" ? palette().selected : palette().surface }}>
                  <Text style={{ fontSize: 11, color: palette().text }}>发帖时间</Text>
                </View>
                <View onPress={() => { const c = channel(); if (c && sortOrder() !== "lastpost") { setSortFor(c.id, "lastpost"); refreshThreads(); } }}
                  accessibilityLabel="按回帖时间排序"
                  style={{ height: 28, justifyContent: "center", alignItems: "center", paddingHorizontal: 8, borderRadius: 5, backgroundColor: sortOrder() === "lastpost" ? palette().selected : palette().surface }}>
                  <Text style={{ fontSize: 11, color: palette().text }}>回帖时间</Text>
                </View>
                <View style={{ flex: 1 }} />
                <Text style={{ fontSize: 10, color: palette().muted }}>长按帖子可隐藏</Text>
              </>
            ) : (
              <Text style={{ fontSize: 11, color: palette().muted, flex: 1 }}>
                {sortOrder() === "dateline" ? "按发帖时间" : "按回帖时间"}
              </Text>
            )}
          </View>
        ) : null}
        </View>
        {searchTerm() !== null && !listLoading() && posts().length === 0 ? (
          <Text style={{ fontSize: 13, color: palette().muted, textAlign: "center", padding: 16 }}>没有找到包含 “{searchTerm()}” 的帖子。</Text>
        ) : null}
        {history() && searchTerm() === null && historyRows().length === 0 ? (
          <Text style={{ fontSize: 13, color: palette().muted, textAlign: "center", padding: 16 }}>你打开过的帖子会显示在这里。</Text>
        ) : null}
        {listLoading() ? (
          <View style={{ flex: 1, alignItems: "center", paddingTop: 28 }}>
            <LoadingBar />
          </View>
        ) : nothingPicked() ? (
          <Placeholder
            title="选择一个版块以查看帖子。"
            detail={forumUser() ? undefined : "登录后即可查看收藏、主题、回复和私信。"}
          />
        ) : (
        // A virtualized list: only the rows near the viewport exist, and they are reused as the
        // user scrolls. Its end (loading, failure, or "no more threads") is the footer.
        <List
          style={{ flex: 1 }}
          // The rows start under the order row, and scroll up through its place as it slides away:
          // the list keeps the whole height, only its content is pushed down.
          contentStyle={{ padding: 6, gap: 3, paddingTop: floating() ? orderRoom() + 6 : 6 }}
          each={listRows()}
          ref={(n: ListRef | null) => { threadsList = n ?? undefined; }}
          onScroll={rememberViewport}
          onScrollEnd={onListScrollEnd}
          estimatedItemSize={72}
          onLoadMore={loadMore}
          refreshing={refreshing()}
          onRefresh={() => refreshThreads()}
          footer={() => (
            <View>
              {loadingMoreShown() ? <LoadingBar /> : null}
              {!more() && posts().length > 0 && !loadingMoreShown() ? (
                <Text style={{ fontSize: 13, color: palette().muted, textAlign: "center", padding: 16 }}>没有更多帖子了。</Text>
              ) : null}
            </View>
          )}
        >
          {(row) => (
            // A section title of the history, or a thread. The row's thread is read through `row()`.
            row().kind === "header" ? (
              <Text style={{ fontSize: 11, color: palette().muted, paddingTop: 10, paddingBottom: 2, paddingHorizontal: 8 }}>{titleOf(row())}</Text>
            ) : (
              <ThreadRow
                item={() => postOf(row())}
                selected={() => (messages() ? peer() : thread())?.id === postOf(row()).id}
                avatar={() => avatarFor(postOf(row())) ?? (replies() ? (avatarByName()[forumUser() ?? ""] || undefined) : undefined)}
                // The favorites list is all favorites, so its rows carry no star.
                favorite={() => !favorites() && !!forumUser() && isFavorite(postOf(row()).id)}
                viewed={() => isViewed(postOf(row()).id)}
                onPress={() => openThread(postOf(row()))}
                onLongPress={() => pendingHide.set(postOf(row()))}
              />
            )
          )}
        </List>
        )}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, alignSelf: "stretch" }}>
      <View style={{ flex: 1, alignSelf: "stretch", flexDirection: "row" }}>
        {/* The body: the open thread (or the conversation, or the new-thread form). A screen
            entered slides in from the right while the ladder under it is pushed off to the left;
            a step back runs the other way. It is drawn over the ladder only while it slides in. */}
        <View style={{ flex: 1, alignSelf: "stretch", transform: [{ translateX: bodyX }], zIndex: bodyTop() ? 27 : 0 }}>
          {composing() && canCompose() ? (
            <NewThread
              fid={channel()!.id}
              channel={channel()!.title}
              onPosted={threadPosted}
              onClose={() => { composing.set(false); enterBody("pop"); }}
            />
          ) : messages() && peer() && detour().length === 0 ? (
            <Conversation
              peer={() => peer()!}
              onOpenThread={openLinkedThread}
              onSwipeBack={() => showPane("list")}
              onOpenSidebars={() => showPane("boards")}
            />
          ) : shownThread() ? (
            <Thread
              // A thread from a link has no forum of its own here: its first page names it.
              fid={detour().length > 0 ? "" : (shownThread()!.fid ?? channel()?.id ?? "")}
              post={shownThread()!}
              signedIn={!!props.user()}
              onSignInNeeded={props.onSignInNeeded}
              focusPid={detour().length > 0 ? detour()[detour().length - 1].focus : undefined}
              onOpenThread={openLinkedThread}
              onOpenSidebars={() => showPane("boards")}
              onBack={detour().length > 0 ? backFromLink : () => showPane("list")}
              // A right swipe in the thread body returns to the list; a thread opened from a link
              // returns to the one before it.
              onSwipeBack={detour().length > 0 ? backFromLink : () => showPane("list")}
              onUnfavorited={() => {
                // In the favorites list, the removed thread leaves the list.
                if (favorites() && detour().length === 0) posts.set(posts().filter((p) => p.id !== thread()?.id));
              }}
            />
          ) : (
            <View
              onPress={() => showPane("boards")}
              accessibilityLabel="打开版块与帖子列表"
              style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}
            >
              <PixelDino size={120} />
              <Text style={{ fontSize: 13, color: palette().muted }}>选择一个帖子</Text>
              <View onPress={() => showPane("boards")} style={{ paddingVertical: 6, paddingHorizontal: 12 }}>
                <Text style={{ fontSize: 13, color: palette().link }}>浏览版块与帖子</Text>
              </View>
            </View>
          )}
        </View>
        {/* The ladder over the body: the list (2) or the boards beside it (1). A right swipe
            steps back one rung; the dimmed body does the same. */}
        {paneShown() !== null ? (
          <>
            <View
              onPress={() => portraitPane.set(null)}
              accessibilityLabel="关闭浮层，回到正文"
              style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0, 0, 0, 0.35)", zIndex: 25, opacity: paneFade }}
            />
            <View
              pan={{ x: panePan }}
              panActivation={{ activeOffsetX: 18, failOffsetY: 10 }}
              onPanEnd={(e: any) => {
                // The pane follows the finger, so it is put back with a short motion rather than
                // jumping to zero when the gesture ends without a step.
                const settle = () => { void panePan.timing(0, { duration: 140 }).catch(() => undefined); };
                // The swipe that opened this pane is still travelling: only a new one steps back.
                if (Date.now() - paneOpenedAt < 350) { settle(); return; }
                const dx = e?.translation?.x ?? 0;
                const vx = e?.velocity?.x ?? 0;
                const right = !e?.cancelled && (dx > 60 || vx > 700);
                const left = !e?.cancelled && (dx < -60 || vx < -700);
                if (right) {
                  // The boards beside the list fold to a rail of icons: a right swipe over the pane
                  // opens them first, and the next one leaves the pane. A left swipe folds them.
                  if (paneShown() === "boards" && boardsFolded()) {
                    boardsFolded.set(false);
                    Storage.setItem("visual:boards-folded", "0").catch(() => undefined);
                  } else {
                    // The pane leaves to the right, the way the finger was moving — only if it
                    // really stepped back (a slide in progress may refuse the step).
                    if (paneBack()) paneExitRight = true;
                  }
                } else if (left && paneShown() === "boards" && !boardsFolded()) {
                  boardsFolded.set(true);
                  Storage.setItem("visual:boards-folded", "1").catch(() => undefined);
                }
                settle();
              }}
              style={{
                position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 26,
                width: windowSize().width,
                flexDirection: "row",
                backgroundColor: palette().bg,
                borderRightWidth: 1, borderColor: palette().border,
              }}
            >
              {/* The boards come with the list beside them, filling the window; the body stays
                  behind them untouched. The list alone takes the window once a board opens. */}
              {paneShown() === "list" ? (
                <ThreadsColumn onBack={paneBack} width={windowSize().width} />
              ) : (
                <>
                  <ChannelColumn />
                  <ThreadsColumn width={windowSize().width - (boardsFolded() ? BOARD_RAIL_WIDTH : BOARD_WIDTH)} />
                </>
              )}
            </View>
          </>
        ) : null}
      </View>

      {pendingHide() ? (
        // The same centered card style as the thread's delete dialog.
        <Dialog
          animation="fade"
          onCancel={() => pendingHide.set(null)}
          style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}
          backdropStyle={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0, 0, 0, 0.3)" }}
        >
          <View style={{ width: 320, padding: 20, gap: 12, borderRadius: 12, backgroundColor: palette().bg }}>
            <Text style={{ fontSize: 15, fontWeight: 600, color: palette().text }}>隐藏该贴？</Text>
            <Text style={{ fontSize: 13, color: palette().muted, numberOfLines: 2 }}>{pendingHide()!.title}</Text>
            <Text style={{ fontSize: 12, color: palette().muted }}>隐藏后不再显示在此帖子列表中。</Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
              <View
                onPress={() => pendingHide.set(null)}
                accessibilityLabel="取消"
                style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6, borderWidth: 1, borderColor: palette().border }}
              >
                <Text style={{ fontSize: 13, color: palette().text }}>取消</Text>
              </View>
              <View
                onPress={() => { const p = pendingHide(); if (p) hideThread(p.id); pendingHide.set(null); }}
                accessibilityLabel="隐藏该贴"
                style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6, backgroundColor: palette().danger }}
              >
                <Text style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>隐藏该贴</Text>
              </View>
            </View>
          </View>
        </Dialog>
      ) : null}
    </View>
  );
}
