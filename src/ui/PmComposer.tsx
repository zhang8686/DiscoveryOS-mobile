// A private message written from a floor's avatar: a translucent sheet with the text and Send.
// It goes through the same request the conversation's reply box uses.
import { Input } from "nsh/base";
import { colorScheme, signal, Text, View, windowSize } from "nsh";
import { sendPm } from "../discuz/forum";
import { palette } from "./appearance";
import { notify } from "./toast";

export function PmComposer(props: { uid: string; name: string; onClose: () => void }) {
  const text = signal("");
  const busy = signal(false);
  const dark = colorScheme() === "dark";

  async function send(): Promise<void> {
    const body = text().trim();
    if (!body || busy()) return;
    busy.set(true);
    try {
      await sendPm(props.uid, "", body);
      notify("pm", `短消息已发给 ${props.name}。`);
      props.onClose();
    } catch (e) {
      notify("pm", `发送失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      busy.set(false);
    }
  }

  return (
    <View
      onPress={props.onClose}
      style={{
        position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
        alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.3)", zIndex: 45,
      }}
    >
      <View
        onPress={() => undefined}
        style={{
          width: Math.min(440, windowSize().width - 24),
          padding: 16, gap: 10, borderRadius: 12, borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: dark ? "rgba(28, 30, 34, 0.92)" : "rgba(255, 255, 255, 0.94)",
        }}
      >
        <Text style={{ fontSize: 14, color: palette().text }}>{`发给 ${props.name}`}</Text>
        <Input
          placeholder="短消息内容"
          multiline={true}
          value={text()}
          onChange={({ value: v }: { value: string }) => text.set(v)}
          style={{ minHeight: 150, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, color: palette().text, placeholderColor: palette().muted, caretColor: palette().link }}
        />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <View
            onPress={props.onClose}
            accessibilityLabel="取消"
            style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6, borderWidth: 1, borderColor: palette().border }}
          >
            <Text style={{ fontSize: 13, color: palette().text }}>取消</Text>
          </View>
          <View
            onPress={busy() ? undefined : () => void send()}
            accessibilityLabel="发送"
            style={{ paddingVertical: 6, paddingHorizontal: 16, borderRadius: 6, backgroundColor: palette().link, opacity: busy() ? 0.6 : 1 }}
          >
            <Text style={{ fontSize: 13, color: "#ffffff" }}>{busy() ? "发送中…" : "发送"}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
