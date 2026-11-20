// The title search, in the thread list's header on a phone: an icon that opens a
// field; Return searches, ✕ closes the field. The search the list shows stays beside
// the icon while the field is closed, so the results can be reopened and cleared.
import { effect, LayoutAnimation, Overlay, reduceMotion, signal, Text, untracked, View, type ViewRef } from "nsh";
import { Input } from "nsh/base";
import { palette } from "./appearance";
import { SearchIcon } from "./icons";

/** Fades the next change of the search field: 240 ms, opacity only, so nothing slides or moves while the
 * field and icon come and go; unless the system asks for reduced motion. Call it before the change. */
export function animateSearchChange(): void {
  if (reduceMotion()) return;
  const curve = { type: "easeInEaseOut" as const };
  LayoutAnimation.configureNext({
    duration: 200,
    update: { ...curve, property: "opacity" },
    create: { ...curve, property: "opacity" },
    delete: { ...curve, property: "opacity" },
  });
}

/** What the search control shows and does: the field when open, else its icon (signed in only). */
export type SearchProps = {
  open: () => boolean;
  draft: () => string;
  signedIn: () => boolean;
  onDraft: (text: string) => void;
  onSubmit: (term: string) => void;
  onOpen: () => void;
  /** Hides the field when the list is scrolled or another control is pressed; the search and its results stay. */
  onHide: () => void;
  onClose: () => void;
  /** The search the threads show ("" for none): beside the icon while the field is closed. */
  term: () => string;
};

function Glyph(props: { label: string; title: string; onPress: () => void; size?: number }) {
  return (
    <View
      onPress={props.onPress}
      accessibilityLabel={props.title}
      style={{ width: 30, height: 30, borderRadius: 6, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ color: palette().muted, fontSize: props.size ?? 20 }}>{props.label}</Text>
    </View>
  );
}

/** The search field, opened from its icon: Return searches, ✕ closes it. */
export function SearchControl(props: SearchProps) {
  // The field's place, which the outside-press overlay is anchored to.
  const field = signal<ViewRef | null>(null);
  // The input's handle, focused when the field is shown.
  const input = signal<ViewRef | null>(null);
  const focusSoon = () => setTimeout(() => input()?.focus(), 0);
  const openAndFocus = () => {
    props.onOpen();
    focusSoon();
  };
  // The icon has no press while the field is open: the field takes the row's width.
  return (
    <>
      {props.signedIn() ? (
        <View
          onPress={props.open() ? undefined : openAndFocus}
          accessibilityLabel="搜索帖子"
          style={
            props.open()
              ? { width: 0, padding: 0, opacity: 0, overflow: "hidden" }
              : { padding: 4, borderRadius: 6, opacity: 1, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 34 }
          }
        >
          <SearchIcon size={17} />
          {!props.open() && props.term().length > 0 ? (
            <Text style={{ numberOfLines: 1, fontSize: 13, color: palette().text, maxWidth: 120 }}>
              {props.term()}
            </Text>
          ) : null}
        </View>
      ) : null}
      {props.open() ? (
        <View
          ref={(n) => field.set(n)}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            height: 34,
            paddingLeft: 8,
            paddingRight: 2,
            borderRadius: 17,
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().surface,
          }}
        >
          <SearchIcon size={15} />
          <Input
            ref={(n: ViewRef | null) => input.set(n)}
            onBlur={() => {
              // Losing the focus (to the reply box, a press elsewhere) hides the field.
              if (props.open()) props.onHide();
            }}
            placeholder="搜索帖子"
            value={props.draft()}
            onChange={({ value: text }: { value: string }) => props.onDraft(text)}
            onSubmit={({ text }: { text: string }) => props.onSubmit(text)}
            returnKeyType="search"
            accessibilityLabel="搜索帖子"
            style={{ flex: 1, height: 28, fontSize: 14, borderWidth: 0, backgroundColor: "transparent", color: palette().text, placeholderColor: palette().muted, caretColor: palette().link }}
          />
          <Glyph label="✕" title="关闭搜索" onPress={props.onClose} size={13} />
        </View>
      ) : null}
      {/* A press anywhere outside the field hides it. Presses still reach what is under them. */}
      {props.open() && field() ? (
        <Overlay anchor={field()} onPressOutside={props.onHide}>
          <View style={{ width: 0, height: 0 }} />
        </Overlay>
      ) : null}
    </>
  );
}
