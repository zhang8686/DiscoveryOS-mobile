// A video link in a post that no other module plays: its page (or file) opens in a WebView.
// If the WebView cannot open it, a line of text says so.
import { effect, signal, Text, Video, View, WebView, type WebViewRef } from "nsh";
import { palette } from "./appearance";
import { VIDEO_FULLSCREEN_SCRIPT } from "./webviewFullscreen";
import { MUTE_VIDEO_SCRIPT, PAUSE_VIDEO_SCRIPT, setMutedScript, videoPauseTick } from "./videoPause";
import { MuteToggle } from "./MuteToggle";

export function VideoLinkPlayer(props: { url: string }) {
  const failed = signal<string | null>(null);
  const muted = signal(true);
  let page!: WebViewRef;
  function toggleMute(): void {
    const next = !muted();
    muted.set(next);
    page?.injectJavaScript(setMutedScript(next));
  }
  // A scroll in the thread pauses the video; it does not resume when the scroll ends.
  effect(() => {
    if (videoPauseTick() > 0) page?.injectJavaScript(PAUSE_VIDEO_SCRIPT);
  });
  // A video file is played by the platform itself; a page is shown in the web view.
  if (/\.(mp4|webm|mov|m3u8)(\?|$)/i.test(props.url)) {
    return <Video src={props.url} controls={true} muted={true} style={{ height: 320, backgroundColor: "#000", borderRadius: 8 }} />;
  }
  // The branch is read inside the JSX, so it updates when the signal changes.
  return (
    <View style={{ alignSelf: "stretch", position: "relative" }}>
      {failed() !== null ? (
        <Text style={{ fontSize: 12, color: palette().muted }}>{`无法打开视频 ${props.url}（${failed()}）`}</Text>
      ) : (
        <>
          <WebView
            ref={page}
            src={props.url}
            injectedJavaScript={VIDEO_FULLSCREEN_SCRIPT + "\n" + MUTE_VIDEO_SCRIPT}
            onError={(e) => failed.set(e.code ?? e.message)}
            style={{ aspectRatio: 16 / 9, backgroundColor: "#000", borderRadius: 8 }}
          />
          <MuteToggle muted={muted()} onToggle={toggleMute} />
        </>
      )}
    </View>
  );
}
