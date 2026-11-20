// A short link in a post, shown as its video once it resolves. The short link itself is shown
// in a WebView straight away, while it resolves in the background. If it resolves in time
// (SHORT_LINK_TIMEOUT_MS, inside the resolver), that WebView is replaced by the video's own
// player; if not, the WebView stays, so the video is still reachable.
import { signal, Text, View, WebView, type JSX } from "nsh";
import { openLink } from "./links";
import { VIDEO_FULLSCREEN_SCRIPT } from "./webviewFullscreen";

export function ShortLinkPlayer<T>(props: {
  url: string;
  resolve: (url: string) => Promise<T | null>;
  /** The video card for a resolved value. */
  play: (value: T) => JSX.Element;
  /** Size of the fallback WebView: its height, or its shape. */
  fallbackSize: { height?: number; aspectRatio?: number };
  /** What to show instead of the fallback WebView, when the site will not load in one. */
  fallback?: JSX.Element;
}) {
  const value = signal<T | null>(null);
  // A failed or timed-out resolve (null, or a rejection) leaves the fallback WebView in place.
  props
    .resolve(props.url)
    .then((v) => {
      if (v) value.set(v);
    })
    .catch(() => {});

  // The branch is read inside the JSX, so it updates when the signal changes. A plain
  // `if (value()) return …` would be read once, when the component first runs.
  return (
    <View style={{ alignSelf: "stretch" }}>
      {value() ? (
        props.play(value()!)
      ) : props.fallback ? (
        props.fallback
      ) : (
        <WebView
          src={props.url}
          injectedJavaScript={VIDEO_FULLSCREEN_SCRIPT}
          style={{ ...props.fallbackSize, backgroundColor: "#000", borderRadius: 8 }}
        />
      )}
    </View>
  );
}

/** A short link whose site refuses a web view: a card that opens it in the browser. */
export function ShortCard(props: { label: string; url: string }) {
  return (
    <View
      onPress={() => void openLink(props.url)}
      accessibilityLabel={props.label}
      style={{ height: 112, borderRadius: 8, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#000" }}
    >
      <Text style={{ fontSize: 15, color: "#ffffff" }}>{`▶ ${props.label}`}</Text>
      <Text style={{ fontSize: 11, color: "#9aa0a6", numberOfLines: 1 }}>{props.url}</Text>
    </View>
  );
}
