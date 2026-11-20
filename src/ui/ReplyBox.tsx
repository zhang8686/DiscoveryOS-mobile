// The reply box under a thread's posts and under a private-message conversation: a
// multiline field with the send button at its bottom-right corner, in the same row. The field
// is one line until it has the focus or has text. Both screens share this one.
// Pasted pictures show as thumbnails above the text; they have no remove control, and
// they go with the reply. Cmd+Enter sends (Ctrl+Enter elsewhere); Enter adds a line.
import { effect, Image, LayoutAnimation, Picker, reduceMotion, signal, Text, untracked, View, type PasteEvent, type ViewRef } from "nsh";
import { LineIcon } from "./lineIcons";
import { anchorToast, notify } from "./toast";
import { Input } from "nsh/base";
import { palette } from "./appearance";
import { keyboardIsOpen, textFieldFocused } from "./keyboard";
import { quoteAttribution } from "../discuz/quote";
import { PlaneIcon, RefreshIcon } from "./icons";
import type { PixelSize } from "./pixelSize";

export type Attached = { id: string; kind: "image" | "file"; name: string; preview: string; size: PixelSize | null };

// A pasted picture at half its pixel size, keeping its shape, and no taller than 300 pt (less while
// the keyboard is up, so the send row stays on screen). A format whose size is unknown shows as a
// 128 pt square, shrunk to the same limit.
const SCALE = 0.5;
const MAX_HEIGHT = 300;
const SQUARE = 128;

function Thumb(props: { src: string; size: PixelSize | null; maxHeight?: number }) {
  const limit = props.maxHeight ?? MAX_HEIGHT;
  const box = props.size && props.size.height > 0
    ? (() => {
        const height = Math.min(props.size!.height * SCALE, limit);
        return { width: (props.size!.width * height) / props.size!.height, height };
      })()
    : (() => {
        const side = Math.min(SQUARE, limit);
        return { width: side, height: side };
      })();
  // The box fixes the size; the picture fills it, so its own pixel size never takes over the layout.
  return (
    <View style={{ width: box.width, height: box.height, borderRadius: 6, overflow: "hidden" }}>
      <Image src={props.src} style={{ width: box.width, height: box.height, objectFit: "contain" }} />
    </View>
  );
}

// The text field grows with its text, up to MAX_FIELD: with the send row and the padding, the
// whole box is then 400 pt tall (without pictures). Past that the field scrolls.
const MIN_FIELD = 56;
const MAX_FIELD = 354;
// The field's height with one line of 14 pt text and its padding; the text is centred in it.
const ONE_LINE = 34;
// With the IME up the usable window is much shorter: the field stops growing at 120 pt and the
// attachment strip at 64 pt. The quote is always one line, so the field and send row stay visible
// even on a small phone; without the IME the field keeps its full range.
const IME_FIELD_MAX = 120;
const IME_ATTACH_MAX = 64;
// The collapsed box is a chip: its corners are semicircles, a radius of half its height (one line
// of the field plus the box's 8 pt padding on each side, 50 pt).
const CHIP_RADIUS = 25;

export function ReplyBox(props: {
  draft: () => string;
  onDraft: (text: string) => void;
  sending: () => boolean;
  uploading?: () => boolean;
  attachments?: () => Attached[];
  /** Whether the reply may be sent now. By default, any text. */
  canSend?: () => boolean;
  onSend: () => void;
  onPaste?: (e: PasteEvent) => void;
  /** Local files dropped on the box, as `file:` URLs. */
  onFileDrop?: (uris: string[]) => void;
  /** Files chosen from the system picker. When absent, no picker buttons show
   * (private messages, for instance, have no attachment upload). */
  onAttach?: (files: File[]) => void;
  /** The text field's handle, for the app to focus it (the `r` shortcut). */
  fieldRef?: (field: { focus(): void }) => void;
  /** The field's placeholder; "回复" by default. */
  placeholder?: string;
  /** The field's height when the box is open, and the height it grows to; the reply's by default. */
  minField?: number;
  maxField?: number;
  /** Whether the box folds to a chip while empty and unfocused (true by default). */
  collapsible?: boolean;
  /** A quoted passage shown above the field, read-only: the reader writes below it. Given as the
   *  box's `>` lines, the same form the draft uses, so the saved draft keeps its existing format. */
  quote?: () => string;
  /** An X at the right end of the quote block that drops the quote without touching the draft. */
  onRemoveQuote?: () => void;
  /** A Cancel button to the left of the send button, when given. */
  onCancel?: () => void;
  /** Whether the Cancel button shows now, when it is given (it shows by default). */
  cancelShown?: () => boolean;
}) {
  const sendable = () => (props.canSend ? props.canSend() : props.draft().length > 0) && !props.sending() && !props.uploading?.();
  // The box's own controls, so a message raised by one of them shows beside it: "回复已发布。"
  // by the send button, "有文件超过 10 MB，已跳过。" by the picker that chose it.
  let sendNode: ViewRef | undefined;
  let imageNode: ViewRef | undefined;
  let fileNode: ViewRef | undefined;
  // A phone has no drag-and-drop: the system picker is the visible entry.
  // Images are scaled natively before they reach the app, and oversized files
  // are skipped rather than read whole into memory.
  const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
  async function picked(files: File[]) {
    const usable = files.filter((f) => f.size <= MAX_ATTACH_BYTES);
    if (files.length > usable.length) notify("attach-size", "有文件超过 10 MB，已跳过。");
    if (usable.length > 0) props.onAttach?.(usable);
  }
  async function pickImages() {
    try {
      const list = await Picker.pickImages({ multiple: true, limit: 5, maxDimension: 1600, quality: 0.85 });
      await picked(list.map((p) => p.file));
    } catch {
      notify("attach-pick", "无法打开图片选择器。");
    }
  }
  async function pickFiles() {
    try {
      const list = await Picker.pickFiles({ multiple: true, limit: 5 });
      await picked(list.map((p) => p.file));
    } catch {
      notify("attach-pick", "无法打开文件选择器。");
    }
  }
  const pictures = () => props.attachments?.() ?? [];
  const floor = props.minField ?? MIN_FIELD;
  const ceiling = props.maxField ?? MAX_FIELD;
  // With the IME up the usable window is shorter: cap the open field and the attachment strip so
  // the send/clear button row stays on screen instead of being clipped. fieldHeight keeps the real
  // content height and restores when the IME hides.
  const imeOpen = keyboardIsOpen;
  const fieldCeiling = () => imeOpen() ? Math.min(ceiling, IME_FIELD_MAX) : ceiling;
  const attachCeiling = () => imeOpen() ? IME_ATTACH_MAX : MAX_HEIGHT;
  // Only the quote's attribution is shown. An old draft may still hold the whole quoted body; it is
  // kept in the saved text, but the read-only block shows author and time, like the web forum.
  const quoteText = () => {
    const q = props.quote?.();
    return q ? quoteAttribution(q) : "";
  };
  const fieldHeight = signal(floor);
  // The field is one line until it has the focus or has text; the send button stays in the
  // same row at the box's bottom-right corner in both states.
  const focused = signal(false);
  // A picture or an upload is content too, so the box stays open with them.
  const collapsed = () =>
    props.collapsible !== false && !focused() && !props.quote?.() && props.draft().length === 0 && pictures().length === 0 && !props.uploading?.();
  // The field's ref: it takes the focus back out when a reply is posted (the draft is cleared then;
  // a failed send keeps the draft and the focus).
  let field: { focus(): void; blur(): void } | undefined;
  let wasSending = false;
  effect(() => {
    const now = props.sending();
    untracked(() => {
      if (wasSending && !now && props.draft().length === 0) field?.blur();
      wasSending = now;
    });
  });
  // Switching between the chip and the field animates the layout change (240 ms, as the channel
  // column's glide); the change of the corner radius is not part of it, so it snaps.
  let lastCollapsed: boolean | null = null;
  effect(() => {
    const now = collapsed();
    untracked(() => {
      if (lastCollapsed !== null && now !== lastCollapsed && !reduceMotion()) {
        const curve = { type: "easeInEaseOut" as const };
        LayoutAnimation.configureNext({
          duration: 240,
          update: curve,
          create: { ...curve, property: "opacity" },
          delete: { ...curve, property: "opacity" },
        });
      }
      lastCollapsed = now;
    });
  });
  // The text the platform inserted with a file's paste or drop: a file's name or path, not
  // something the user typed. It is taken back out of the draft when it arrives.
  let inserted: string | null = null;
  const pathOf = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ""));
  const takeBack = (text: string) => {
    const old = props.draft();
    const taken = inserted;
    inserted = null;
    props.onDraft(text);
    if (taken && text.length === old.length + taken.length && text.includes(taken)) {
      // The draft as it was before the file's name or path went in.
      setTimeout(() => props.onDraft(old), 0);
    }
  };

  return (
    <View
      onFileDrop={(e: { uris: string[] }) => {
        inserted = e.uris.map(pathOf).join("\n");
        props.onFileDrop?.(e.uris);
      }}
      style={{
        alignSelf: "stretch",
        flexShrink: 0,
        margin: 12,
        padding: 8,
        gap: 4,
        borderRadius: collapsed() ? CHIP_RADIUS : 8,
        backgroundColor: palette().surface,
        // While a reply is being sent the whole box is dimmed, and its send icon turns.
        opacity: props.sending() ? 0.5 : 1,
      }}
    >
      {pictures().length > 0 ? (
        <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 4, maxHeight: attachCeiling() }}>
          {pictures().map((p) =>
            p.kind === "image" ? (
              <Thumb src={p.preview} size={p.size} maxHeight={attachCeiling()} />
            ) : (
              <View style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: palette().border, maxHeight: attachCeiling(), justifyContent: "center" }}>
                <Text style={{ fontSize: 13, color: palette().text, numberOfLines: 1, maxHeight: attachCeiling() }}>{p.name}</Text>
              </View>
            ),
          )}
        </View>
      ) : null}
      {/* Web-forum style: the read-only block shows only the quoted author and time. An old draft
          may still hold the whole quoted body — it stays in the saved text and is sent back as
          `[quote]`, it just no longer takes up the page while the reader is writing. */}
      {quoteText() ? (
        <View
          accessibilityLabel="引用的作者与时间，只读"
          style={{
            flexDirection: "row", gap: 8, marginHorizontal: 4, paddingVertical: 6, paddingHorizontal: 10,
            borderRadius: 6, backgroundColor: palette().bg,
            borderLeftWidth: 3, borderLeftColor: palette().link,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 12, lineHeight: 17, color: palette().link, numberOfLines: 1 }}>
              {quoteText()}
            </Text>
          </View>
          {props.onRemoveQuote ? (
            <View
              onPress={props.onRemoveQuote}
              accessibilityLabel="取消引用"
              style={{ width: 24, height: 24, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
            >
              <Text style={{ fontSize: 17, lineHeight: 20, color: palette().muted }}>×</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {/* Collapsed, the field and the send button share the chip's centre line; expanded, the button sits at the bottom. */}
      <View style={{ flexDirection: "row", alignItems: collapsed() ? "center" : "flex-end", gap: 8, flexShrink: 0 }}>
        <Input
          ref={(n) => {
            field = n as unknown as { focus(): void; blur(): void };
            if (n) props.fieldRef?.(field);
          }}
          placeholder={props.placeholder ?? "回复"}
          multiline={true}
          value={props.draft()}
          onChange={({ value: text }: { value: string }) => takeBack(text)}
          onPaste={(e: PasteEvent) => {
            if (e.files.length > 0 || e.uris.length > 0) inserted = e.text || null;
            props.onPaste?.(e);
          }}
          onFocus={() => { focused.set(true); textFieldFocused.set(true); }}
          onBlur={() => { focused.set(false); textFieldFocused.set(false); }}
          onContentSizeChange={({ size }: { size: { height: number } }) =>
            fieldHeight.set(Math.min(ceiling, Math.max(floor, Math.ceil(size.height) + 8)))
          }
          style={{
            flex: 1,
            height: collapsed() ? ONE_LINE : Math.min(fieldHeight(), fieldCeiling()),
            padding: 4,
            // The placeholder sits 3 pt further in, away from the chip's round end.
            paddingLeft: 7,
            // One line: the padding centres the 17 pt line in the field's height.
            paddingVertical: collapsed() ? (ONE_LINE - 17) / 2 : 4,
            fontSize: 14,
            // The field had no colour of its own: Android drew its text black, which disappeared
            // on the dark surface. Follow the palette, as the rest of the box does.
            color: palette().text,
            placeholderColor: palette().muted,
            caretColor: palette().link,
            backgroundColor: "transparent",
          }}
        />
        {props.draft().length > 0 ? (
          <View
            onPress={() => {
              inserted = null;
              props.onDraft("");
              field?.focus();
            }}
            accessibilityLabel="清空"
            style={{ width: 32, height: 28, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: palette().surface }}
          >
            <Text style={{ fontSize: 18, color: palette().muted }}>×</Text>
          </View>
        ) : null}
        {props.onAttach ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <View
              ref={(n: ViewRef | null) => { imageNode = n ?? undefined; }}
              onPress={() => { anchorToast(imageNode); pickImages(); }}
              accessibilityLabel="添加图片"
              style={{ width: 32, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: palette().surface }}>
              <LineIcon name="image" size={17} />
            </View>
            <View
              ref={(n: ViewRef | null) => { fileNode = n ?? undefined; }}
              onPress={() => { anchorToast(fileNode); pickFiles(); }}
              accessibilityLabel="添加附件"
              style={{ width: 32, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: palette().surface }}>
              <LineIcon name="paperclip" size={17} />
            </View>
          </View>
        ) : null}
        {props.uploading?.() ? (
          // The labels share the send button's 26 pt box (its icon and padding), so they centre on the plane.
          <View style={{ height: 26, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 12, color: palette().muted }}>正在上传…</Text>
            <RefreshIcon size={12} spinning={true} />
          </View>
        ) : null}
        {pictures().length > 0 && !props.uploading?.() ? (
          <View style={{ height: 26, justifyContent: "center" }}>
            <Text style={{ fontSize: 12, color: palette().muted }}>
              {`已添加 ${pictures().length} 个附件`}
            </Text>
          </View>
        ) : null}
        {props.onCancel && (props.cancelShown?.() ?? true) ? (
          <View onPress={props.onCancel} accessibilityLabel="取消" style={{ height: 26, justifyContent: "center", paddingHorizontal: 6 }}>
            <Text style={{ fontSize: 13, color: palette().muted }}>取消</Text>
          </View>
        ) : null}
        <View
          ref={(n: ViewRef | null) => { sendNode = n ?? undefined; }}
          onPress={sendable() ? () => { anchorToast(sendNode); props.onSend(); } : undefined}
          accessibilityLabel="发送"
          style={{ padding: 4, paddingRight: 7 }}
        >
          {props.sending() ? <RefreshIcon size={18} spinning={true} /> : <PlaneIcon size={18} enabled={() => sendable()} />}
        </View>
      </View>
    </View>
  );
}
