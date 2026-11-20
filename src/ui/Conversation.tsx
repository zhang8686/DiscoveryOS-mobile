// The private messages with one correspondent, shown in the open-thread column in the same
// post style as a thread: one card per message, the time in its meta line, and the thread's
// reply box under them.
import { createAnimatedValue, effect, List, signal, Storage, Text, untracked, View } from "nsh";
import { TextView } from "nsh/base";
import { loadPmConversation, sendPm } from "../discuz/forum";
import { absolutize, absoluteUrl, fixImages, threadIdFromLink, trimLeadingBlanks, type PmMessage, type Post } from "../discuz/parse";
import { HOST } from "../discuz/client";
import { palette } from "./appearance";
import { notify } from "./toast";
import { openLink } from "./links";
import { ReplyBox } from "./ReplyBox";
import { ReplyCard } from "./ReplyCard";
import { LineIcon } from "./lineIcons";

const draftKey = (uid: string) => `pm-draft:${uid}`;

// `onOpenThread` takes a press on a link to a 4d4y thread, which the thread column then shows.
// `onSwipeBack` returns to the list on a right swipe, as a thread does.
export function Conversation(props: {
  peer: () => Post;
  onOpenThread?: (tid: string) => void;
  onSwipeBack?: () => void;
  /** Portrait: opens the boards and message list, which stay out of the body's way there. */
  onOpenSidebars?: () => void;
}) {
  const messages = signal<PmMessage[] | null>(null);
  const draft = signal("");
  const sending = signal(false);
  // Each load gets a number; a reply to an earlier load is dropped when a newer one started.
  let latest = 0;

  // A right swipe goes back (the same gesture and thresholds as a thread's body).
  const backPan = createAnimatedValue(0);
  const onSwipeEnd = (e: any) => {
    const dx = e?.translation?.x ?? 0;
    const vx = e?.velocity?.x ?? 0;
    // The same default-level gesture as a thread's body: a short drag or a light flick goes back.
    if (!e?.cancelled && (dx > 60 || vx > 700)) props.onSwipeBack?.();
    backPan.set(0);
  };

  function load(uid: string) {
    const token = ++latest;
    messages.set(null);
    loadPmConversation(uid)
      .then((list) => {
        if (token === latest) messages.set(list);
      })
      .catch((e) => {
        if (token === latest) notify("pm-load", "私信加载失败，点此重试。", () => load(uid));
      });
    // The draft saved for this correspondent comes back with the conversation.
    Storage.getItem(draftKey(uid))
      .then((text) => {
        if (token === latest) draft.set(text ?? "");
      })
      .catch(() => undefined);
  }

  // The draft is stored once the typing pauses (or at once, after sending): a write on every
  // keystroke put the disk between the key and the screen.
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  function persistDraft(text: string, atOnce = false) {
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = undefined; }
    const write = () => { Storage.setItem(draftKey(props.peer().id), text).catch(() => undefined); };
    if (atOnce) { write(); return; }
    draftTimer = setTimeout(write, 500);
  }
  function setDraft(text: string) {
    draft.set(text);
    persistDraft(text);
  }

  async function send() {
    const uid = props.peer().id;
    const list = messages() ?? [];
    const lastDay = list.length > 0 ? list[list.length - 1].at.split(" ")[0] : "";
    sending.set(true);
    try {
      const fresh = await sendPm(uid, lastDay, draft());
      if (uid === props.peer().id) messages.set(fresh);
      setDraft("");
      persistDraft("", true);
    } catch (e) {
      notify("pm-send", `私信发送失败。 ${e instanceof Error ? e.message : ""}`.trim());
    } finally {
      sending.set(false);
    }
  }

  // Opening another correspondent loads its messages; the list is replaced, not merged.
  effect(() => {
    const uid = props.peer().id;
    untracked(() => load(uid));
  });

  return (
    <View
      pan={props.onSwipeBack ? { x: backPan } : undefined}
      panActivation={props.onSwipeBack ? { activeOffsetX: 18, failOffsetY: 10 } : undefined}
      onPanEnd={props.onSwipeBack ? onSwipeEnd : undefined}
      style={{ flex: 1 }}
    >
      <View style={{ padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
        {/* Portrait: the two list columns are hidden, so this opens them as an overlay. */}
        {props.onOpenSidebars ? (
          <View
            onPress={props.onOpenSidebars}
            accessibilityLabel="版块与私信列表"
            style={{ position: "absolute", left: 12, top: 8, width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
          >
            <LineIcon name="grip" size={17} />
          </View>
        ) : null}
        <Text style={{ fontSize: 22, fontWeight: 600, color: palette().text }}>{`和 ${props.peer().title} 的对话`}</Text>
      </View>
      {messages() === null ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 13, color: palette().muted }}>加载中…</Text>
        </View>
      ) : null}
      {messages() !== null && messages()!.length === 0 ? (
        <Text style={{ fontSize: 13, color: palette().muted, textAlign: "center", padding: 16 }}>暂无私信。</Text>
      ) : null}
      {messages() !== null && messages()!.length > 0 ? (
        <List
          style={{ flex: 1 }}
          contentStyle={{ padding: 12, gap: 12 }}
          each={messages()!}
          estimatedItemSize={180}
        >
          {(item) => (
            <ReplyCard
              avatar={item().avatar ? absoluteUrl(item().avatar!, HOST) : undefined}
              name={item().author}
              meta={item().at}
              body={
                <TextView
                  html={absolutize(trimLeadingBlanks(fixImages(item().body)), HOST)}
                  onLinkPress={(e) => {
                    const tid = threadIdFromLink(e.url);
                    if (tid && props.onOpenThread) props.onOpenThread(tid);
                    else void openLink(e.url);
                  }}
                />
              }
            />
          )}
        </List>
      ) : null}
      <ReplyBox draft={() => draft()} onDraft={(text) => setDraft(text)} sending={() => sending()} onSend={send} />
    </View>
  );
}
