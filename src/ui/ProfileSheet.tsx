// The card a floor's author opens when their name is pressed: what the forum's own profile page
// says about them — group, dates, post counts, online hours, credits — and the way to write them a
// private message. It loads on open, so a press shows the card at once and the numbers fill in.
import { effect, Image, signal, Text, View, windowSize } from "nsh";
import { loadProfile } from "../discuz/forum";
import type { Profile } from "../discuz/parse";
import { palette } from "./appearance";
import { PixelDino } from "./PixelArt";

/** The profile's text fields (not the avatar, and not the catch-all `extra` list). */
type ProfileField = Exclude<keyof Profile, "avatar" | "extra">;

/** The profile rows, in the order the forum prints them: the label, and the field it shows. */
export const PROFILE_ROWS: [string, ProfileField][] = [
  ["用户组", "group"],
  ["注册日期", "registered"],
  ["上次访问", "lastVisit"],
  ["最后发表", "lastPost"],
  ["帖子级别", "postLevel"],
  ["阅读权限", "readPermission"],
  ["帖子数", "posts"],
  ["日均发帖", "dailyPosts"],
  ["精华", "essence"],
  ["页面访问量", "pageViews"],
  ["总计在线（小时）", "onlineTotal"],
  ["本月在线（小时）", "onlineThisMonth"],
  ["积分", "credits"],
  ["威望", "prestige"],
  ["金钱", "money"],
];

function Row(props: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 2 }}>
      <Text style={{ fontSize: 12, color: palette().muted }}>{props.label}</Text>
      <Text style={{ fontSize: 12, color: palette().text, flexShrink: 1, textAlign: "right" }}>{props.value}</Text>
    </View>
  );
}

/**
 * `avatar` and `name` are what the floor already knows, so the card draws its heading before the
 * page arrives; `uid` makes the request a single indexed lookup. `onMessage` hands the member to
 * the private-message sheet (the card closes first).
 */
export function ProfileSheet(props: {
  uid?: string;
  name: string;
  avatar?: string;
  onMessage?: () => void;
  onClose: () => void;
}) {
  const data = signal<Profile | null>(null);
  const failed = signal(false);
  // The picture: the floor's, replaced by the page's when it names a different (larger) one.
  const picture = signal(props.avatar);

  effect(() => {
    let live = true;
    loadProfile(props.name, props.uid)
      .then((p) => {
        if (!live) return;
        data.set(p);
        // Only when the floor had none: the page names the same picture through the forum's
        // script, and swapping a drawn avatar for a slower one would flash.
        if (p.avatar && !picture()) picture.set(p.avatar);
      })
      .catch(() => {
        if (live) failed.set(true);
      });
    return () => {
      live = false;
    };
  });

  const rows = () => [
    ...PROFILE_ROWS.flatMap(([label, key]) => {
      const value = data()?.[key];
      return value ? [{ label, value }] : [];
    }),
    // Whatever else the page names, for a skin that prints fields this app does not know.
    ...(data()?.extra ?? []).filter((row) => !PROFILE_ROWS.some(([label]) => label === row.label)),
  ];

  return (
    <View
      onPress={props.onClose}
      style={{
        position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
        alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.32)", zIndex: 46,
      }}
    >
      <View
        onPress={() => undefined}
        style={{
          width: Math.min(340, windowSize().width - 28),
          maxHeight: windowSize().height - 120,
          padding: 16, gap: 10, borderRadius: 14, borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().surface,
        }}
      >
        {/* The member: their face and name, as the floor shows them. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", backgroundColor: palette().border, alignItems: "center", justifyContent: "center" }}>
            {picture() ? (
              <Image src={picture()!} fadeDuration={90} style={{ width: 40, height: 40 }} />
            ) : (
              <PixelDino size={34} color={palette().muted} />
            )}
          </View>
          <Text style={{ fontSize: 15, fontWeight: 600, color: palette().text, flex: 1, numberOfLines: 2 }}>{props.name}</Text>
        </View>
        <View style={{ height: 1, backgroundColor: palette().border }} />
        {/* The fields the page names; a member with a sparse page leaves rows out. */}
        {data() ? (
          <View style={{ gap: 1 }}>
            {rows().map((row) => (
              <Row label={row.label} value={row.value} />
            ))}
          </View>
        ) : failed() ? (
          <Text style={{ fontSize: 12, color: palette().muted, paddingVertical: 12 }}>资料加载失败，请稍后再试。</Text>
        ) : (
          <Text style={{ fontSize: 12, color: palette().muted, paddingVertical: 12 }}>正在加载资料…</Text>
        )}
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <View
            onPress={props.onClose}
            accessibilityLabel="关闭资料"
            style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: palette().border }}
          >
            <Text style={{ fontSize: 13, color: palette().text }}>关闭</Text>
          </View>
          {props.onMessage ? (
            <View
              onPress={props.onMessage}
              accessibilityLabel={`给 ${props.name} 发短信息`}
              style={{ paddingVertical: 7, paddingHorizontal: 16, borderRadius: 8, backgroundColor: palette().link }}
            >
              <Text style={{ fontSize: 13, color: "#ffffff" }}>发短信息</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
