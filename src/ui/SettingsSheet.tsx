// The display settings panel: the size of the board column, the thread list and the thread body,
// and the body's line spacing. Each change is stored once the presses pause (see `settings.ts`),
// so the next launch keeps it.
import { createMotion, signal, Text, View, windowSize } from "nsh";
import { palette } from "./appearance";
import { displaySettings, setDisplay, type DisplaySettings } from "./settings";

function Stepper(props: {
  label: string;
  // Read through a function so the number follows the draft as it changes.
  value: () => number;
  min: number;
  max: number;
  step: number;
  digits: number;
  onChange: (value: number) => void;
}) {
  const round = (n: number) => Math.min(props.max, Math.max(props.min, Math.round(n * 10) / 10));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={{ flex: 1, fontSize: 13, color: palette().text }}>{props.label}</Text>
      <View
        onPress={() => props.onChange(round(props.value() - props.step))}
        accessibilityLabel={`${props.label}减小`}
        style={{ width: 32, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: palette().surface, borderWidth: 1, borderColor: palette().border }}
      >
        <Text style={{ fontSize: 16, color: palette().text }}>−</Text>
      </View>
      <Text style={{ width: 40, textAlign: "center", fontSize: 13, color: palette().text }}>{props.value().toFixed(props.digits)}</Text>
      <View
        onPress={() => props.onChange(round(props.value() + props.step))}
        accessibilityLabel={`${props.label}增大`}
        style={{ width: 32, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: palette().surface, borderWidth: 1, borderColor: palette().border }}
      >
        <Text style={{ fontSize: 16, color: palette().text }}>+</Text>
      </View>
    </View>
  );
}

export function SettingsSheet(props: { onClose: () => void }) {
  // The panel arrives: a short fade on the backdrop and a rise on the card, so a quick tap does not
  // flash a full-screen dialog.
  const backdrop = createMotion({ enter: "fadeIn", duration: 160, easing: "easeOut" });
  const card = createMotion({ enter: "fadeInUp", duration: 200, easing: "easeOut" });
  // The panel's own copy: a press shows at once, the app's text is re-laid out once the presses
  // pause (a thread body re-parsing on every press made the steppers stutter).
  const draft = signal<DisplaySettings>({ ...displaySettings() });
  let applyTimer: ReturnType<typeof setTimeout> | undefined;
  function change(patch: Partial<DisplaySettings>): void {
    draft.set({ ...draft(), ...patch });
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(() => setDisplay(draft()), 180);
  }
  function close(): void {
    if (applyTimer) clearTimeout(applyTimer);
    setDisplay(draft());
    props.onClose();
  }
  return (
    <View
      onPress={close}
      style={{
        position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
        alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.35)", zIndex: 40,
        opacity: backdrop.opacity,
      }}
    >
      <View
        onPress={() => undefined}
        style={{
          ...card.style,
          width: Math.min(320, windowSize().width - 40),
          padding: 16, gap: 12, borderRadius: 12, borderWidth: 1,
          borderColor: palette().border, backgroundColor: palette().surface,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: 600, color: palette().text }}>显示设置</Text>
        <Stepper label="板块字号" value={() => draft().board} min={10} max={16} step={0.5} digits={1} onChange={(v) => change({ board: v })} />
        <Stepper label="列表字号" value={() => draft().list} min={10} max={16} step={0.5} digits={1} onChange={(v) => change({ list: v })} />
        <Stepper label="正文字号" value={() => draft().body} min={13} max={22} step={1} digits={0} onChange={(v) => change({ body: v })} />
        <Stepper label="正文行距" value={() => draft().spacing} min={1.2} max={2.2} step={0.1} digits={1} onChange={(v) => change({ spacing: v })} />
        <View
          onPress={close}
          accessibilityLabel="完成"
          style={{ alignSelf: "flex-end", paddingVertical: 6, paddingHorizontal: 16, borderRadius: 6, backgroundColor: palette().link }}
        >
          <Text style={{ fontSize: 13, color: "#ffffff" }}>完成</Text>
        </View>
      </View>
    </View>
  );
}
