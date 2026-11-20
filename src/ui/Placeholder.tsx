// What the thread column shows before the user has picked anything to list: a short
// sentence that says what to do next. Plain text, no button; it leaves with the first pick.
import { Text, View } from "nsh";
import { palette } from "./appearance";
import { PixelDino } from "./PixelArt";

export function Placeholder(props: { title: string; detail?: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 6, padding: 24 }}>
      {/* A figure instead of a bare sentence: the dino waits where the app has nothing to show. */}
      <PixelDino size={72} />
      <Text style={{ fontSize: 14, color: palette().text, textAlign: "center" }}>{props.title}</Text>
      {props.detail ? <Text style={{ fontSize: 13, color: palette().muted, textAlign: "center" }}>{props.detail}</Text> : null}
    </View>
  );
}
