// The sound switch over a video player: every player starts muted (see `MUTE_VIDEO_SCRIPT`), and
// this is how the user turns the sound on for the one they are watching. Black and white only:
// a thin speaker glyph on a translucent monochrome disc, with a cross when muted.
import { Canvas, colorScheme, View } from "nsh";

export function MuteToggle(props: { muted: boolean; onToggle: () => void }) {
  const dark = colorScheme() === "dark";
  const ink = dark ? "#f2f2f2" : "#1b1b1b";
  return (
    <View
      onPress={props.onToggle}
      accessibilityLabel={props.muted ? "打开声音" : "静音"}
      style={{
        position: "absolute",
        right: 8,
        top: 8,
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: dark ? "rgba(18, 18, 18, 0.6)" : "rgba(255, 255, 255, 0.84)",
        borderWidth: 1,
        borderColor: dark ? "rgba(255, 255, 255, 0.24)" : "rgba(0, 0, 0, 0.14)",
        zIndex: 5,
      }}
    >
      <Canvas
        style={{ width: 18, height: 18 }}
        draw={(cx) => {
          cx.fillStyle = ink;
          // The speaker: a box and a cone.
          cx.beginPath();
          cx.moveTo(1, 6);
          cx.lineTo(5, 6);
          cx.lineTo(9.5, 2);
          cx.lineTo(9.5, 16);
          cx.lineTo(5, 12);
          cx.lineTo(1, 12);
          cx.closePath();
          cx.fill();
          cx.strokeStyle = ink;
          cx.lineWidth = 1.5;
          cx.lineCap = "round";
          if (props.muted) {
            // A cross where the sound waves would be.
            cx.beginPath();
            cx.moveTo(12, 6.5);
            cx.lineTo(16.5, 11.5);
            cx.stroke();
            cx.beginPath();
            cx.moveTo(16.5, 6.5);
            cx.lineTo(12, 11.5);
            cx.stroke();
          } else {
            // Two waves.
            cx.beginPath();
            cx.moveTo(12, 5.5);
            cx.quadraticCurveTo(14.5, 9, 12, 12.5);
            cx.stroke();
            cx.beginPath();
            cx.moveTo(14.5, 3.5);
            cx.quadraticCurveTo(18, 9, 14.5, 14.5);
            cx.stroke();
          }
        }}
      />
    </View>
  );
}
