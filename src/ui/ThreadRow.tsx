// One thread in a channel's list. A `List` recycles its rows for other threads as the user
// scrolls, so a row reads its thread through `item()` rather than holding it, and keeps no
// state of its own beyond its hover animation, which a hover-out always settles.
import { effect, Image, signal, Text, untracked, View } from "nsh";
import { LineIcon } from "./lineIcons";
import type { Post } from "../discuz/parse";
import { timeAgo } from "../discuz/timeAgo";
import { palette } from "./appearance";
import { displaySettings } from "./settings";
import { PixelDino } from "./PixelArt";
import { newRepliesSinceView } from "./history";

// The row's avatar follows the list text size, as the cards' avatars follow the body's.
function avatarSize(): number {
  const size = Math.round((32 * displaySettings().list) / 12.5);
  return Math.min(44, Math.max(26, size));
}

// The row's time, as the upstream DiscoveryOS-nsh shows it: the last reply's time when the forum
// gives one, otherwise the thread's start, through `timeAgo`. The forum's list page gives the
// start day alone with no clock, so this is the only stamp there with minutes — it is also what the
// list is normally sorted by.
function shownTime(p: Post): string | undefined {
  const when = p.lastReplyAt ?? p.at;
  return when ? timeAgo(when) : undefined;
}

// A count as the list has room for: 249 stays, 108894 reads as "108.9k".
function shortCount(n: number): string {
  if (n < 1000) return String(n);
  return `${Math.round(n / 100) / 10}k`;
}

// What the row needs: a title of up to two lines over the meta line, and never less than the
// avatar. A fixed height lets the virtualized list lay every row out in one pass.
function rowHeight(): number {
  const text = Math.round(displaySettings().list * 2.8 + 26);
  return Math.max(avatarSize() + 30, text);
}

export function ThreadRow(props: {
  item: () => Post;
  selected: () => boolean;
  avatar: () => string | undefined;
  // Whether the thread is a favorite: a solid star before its title.
  favorite: () => boolean;
  // Already read: its title goes muted and the row dims a little, so unread
  // threads stand out in the list.
  viewed: () => boolean;
  onPress: () => void;
  /** A long press (to hide the thread from the list). */
  onLongPress?: () => void;
}) {
  // No picture, or one that does not load: the app's own figure stands in, as on a floor's card.
  const missing = signal(false);
  // A `List` recycles rows: when this row is bound to another thread (or its avatar changes), the
  // failed-load flag from the old thread must go, or the new one shows a placeholder forever.
  effect(() => {
    const avatar = props.avatar();
    untracked(() => missing.set(false));
  });
  return (
    <View
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderRadius: 6,
        // A fixed height for the thread rows keeps every row the same size, so the virtualized list
        // lays them all out in one pass instead of measuring row by row (which made rows seem to
        // appear one after another). The height follows the avatar, so a larger list font does not
        // squeeze the picture. The "my replies" rows keep their own height (they add an excerpt).
        height: props.item().excerpt !== undefined ? undefined : rowHeight(),
        backgroundColor: props.selected() ? palette().selected : palette().surface,
        // A pinned thread sits at the top whatever its reply time, so it is greyed to read as pinned.
        opacity: props.item().pinned ? 0.5 : (props.viewed() && !props.selected() ? 0.62 : 1),
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {/* A colour box with the picture over it: no placeholder bitmap to decode per row (the app's
          own was a 24 KB base64 PNG, which is what made a long list feel heavy), and a short fade
          so a picture that is already cached appears at once. */}
      <View style={{ width: avatarSize(), height: avatarSize(), borderRadius: 7, overflow: "hidden", backgroundColor: palette().border, alignItems: "center", justifyContent: "center" }}>
        {props.avatar() && !missing() ? (
          <Image src={props.avatar()!} fadeDuration={90} onError={() => missing.set(true)} style={{ width: avatarSize(), height: avatarSize() }} />
        ) : (
          <PixelDino size={Math.round(avatarSize() * 0.9)} color={palette().muted} />
        )}
      </View>
      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        {/* A favorite's star is a span of the title's own text, so it sits on the first line and wraps with it. */}
        <Text style={{ numberOfLines: 2, fontSize: displaySettings().list, color: props.item().color ?? (props.viewed() ? palette().muted : palette().text), fontWeight: props.viewed() ? 400 : 600 }}>
          {props.favorite() ? <Text style={{ fontSize: 11, color: palette().muted }}>{"★ "}</Text> : null}
          {props.item().title}
        </Text>
        {props.item().excerpt !== undefined ? (
          // My Replies rows: the reply's text takes the second line, and the time moves to the right.
          props.item().excerpt ? <Text style={{ fontSize: 12, color: palette().muted }}>{props.item().excerpt}</Text> : null
        ) : (
          // The meta line, as the forum's own list draws it: who started the thread, how many
          // replied (a speech bubble), how many read it (an eye), a picture mark when the thread
          // carries pictures, and the time at the row's right edge. The counts line up under each
          // other down the list because every row draws them in this same order.
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Text style={{ fontSize: 11, color: palette().muted, flexShrink: 1, numberOfLines: 1 }}>
              {props.item().author ?? ""}
            </Text>
            {props.item().replies === undefined ? null : (
              <Text style={{ fontSize: 11, color: palette().muted, flexShrink: 0 }}>{`${shortCount(props.item().replies!)} 回复`}</Text>
            )}
            {/* The replies that arrived since the thread was last opened, as the forum marks them:
                a small tinted chip right after the count. A thread never opened has none, and one
                that gained none shows nothing. */}
            {newRepliesSinceView(props.item().id, props.item().replies) > 0 ? (
              <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: palette().selected, flexShrink: 0 }}>
                <Text style={{ fontSize: 10, fontWeight: 600, color: palette().link }}>
                  {`+${newRepliesSinceView(props.item().id, props.item().replies)}`}
                </Text>
              </View>
            ) : null}
            {/* A thread with pictures says so, in the same thin line as the other marks; one
                without them leaves the space empty. */}
            {props.item().hasImages ? <LineIcon name="image" size={12} /> : null}
            <View style={{ flex: 1, minWidth: 0 }} />
            <Text style={{ fontSize: 11, color: palette().muted, flexShrink: 0 }}>
              {shownTime(props.item()) ?? ""}
            </Text>
          </View>
        )}
      </View>
      {props.item().excerpt !== undefined ? (
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ fontSize: 11, color: palette().muted }}>{shownTime(props.item()) ?? ""}</Text>
        </View>
      ) : null}
    </View>
  );
}
