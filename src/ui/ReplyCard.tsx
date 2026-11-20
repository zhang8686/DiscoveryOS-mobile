// One post in the forum's style: the avatar on the left, and beside it the meta line over
// the body. Threads and private-message conversations both show their posts this way.
import { colorScheme, Image, signal, Text, View, type JSX } from "nsh";
import { palette } from "./appearance";
import { displaySettings } from "./settings";
import { PixelDino } from "./PixelArt";

// The avatar's size follows the body text the reader chose: the picture is the floor's face, and
// it should grow with the words beside it rather than stay a fixed square in larger text.
const AVATAR_BASE = 36;
const BODY_BASE = 15;
function avatarSize(): number {
  const size = Math.round((AVATAR_BASE * displaySettings().body) / BODY_BASE);
  return Math.min(52, Math.max(30, size));
}

export function ReplyCard(props: {
  avatar?: string;
  name: string;
  /** Whether the post is by the thread's author (楼主), shown as a tag beside the name. */
  isOp?: boolean;
  /** Opens the author's profile card (pressing their avatar). */
  onAvatarPress?: () => void;
  /** A second address for the picture: used when the first one has none (a member whose static
   *  avatar file does not exist, e.g. one who never uploaded a picture). */
  avatarFallback?: string;
  meta: string;
  /** Controls at the end of the meta line, such as Quote. */
  trailing?: JSX.Element | null;
  body: JSX.Element;
}) {
  const side = avatarSize();
  // A member without a picture, or a picture that does not load, shows the app's own figure
  // instead of an empty square: the row still has a face, and the list does not look broken.
  const missing = signal(false);
  // The address actually drawn: the fast one first, the page's own after it fails.
  const triedFallback = signal(false);
  const src = () => (triedFallback() ? props.avatarFallback : props.avatar);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        padding: 10,
        borderRadius: 8,
        backgroundColor: palette().surface,
      }}
    >
      {/* Two columns, as the Swift app: the avatar on the left, and beside it the meta line
          over the body, so the body starts under the name. */}
      {/* The picture is the way into the author's card. A colour behind it instead of a placeholder
          bitmap: the app's own placeholder was a 24 KB base64 PNG, decoded again for every avatar,
          which is what made a list of floors feel heavy as it scrolled. The picture is drawn over
          the box as soon as it decodes, and a member without one gets the app's own figure. */}
      <View
        onPress={props.onAvatarPress}
        accessibilityLabel={props.onAvatarPress ? `查看 ${props.name} 的资料` : undefined}
        style={{ width: side, height: side, borderRadius: 6, overflow: "hidden", backgroundColor: palette().border }}
      >
        {src() && !missing() ? (
          <Image
            src={src()!}
            fadeDuration={60}
            onError={() => {
              if (!triedFallback() && props.avatarFallback) triedFallback.set(true);
              else missing.set(true);
            }}
            style={{ width: side, height: side }}
          />
        ) : (
          <View style={{ width: side, height: side, alignItems: "center", justifyContent: "center" }}>
            <PixelDino size={Math.round(side * 0.92)} color={palette().muted} />
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: Math.round(displaySettings().body * 0.88), color: palette().text }}>{props.name}</Text>
          {props.isOp ? (
            // Dark orange on the dark surface, dark blue on the light one.
            <View style={{ paddingHorizontal: 2, paddingVertical: 1, borderRadius: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: 600, color: colorScheme() === "dark" ? "#d9822b" : "#2f5f9e" }}>楼主</Text>
            </View>
          ) : null}
          <Text style={{ fontSize: Math.round(displaySettings().body * 0.8), color: palette().muted }}>{props.meta}</Text>
          {props.trailing}
        </View>
        {props.body}
      </View>
    </View>
  );
}
