// A Douyin video linked from a post: a tap-to-open card that loads the video's
// page in a WebView. Douyin's own page shows its sign-in (QR code) when a video
// needs it, and the WebView keeps that login, so there is no sign-in panel here.
import { effect, signal, Text, View, WebView, type WebViewRef } from "nsh";
import { douyinPageUrl } from "../douyin/links";
import { resolveDouyinShort } from "../douyin/resolve";
import { palette } from "./appearance";
import { ShortCard, ShortLinkPlayer } from "./ShortLinkPlayer";
import { VIDEO_FULLSCREEN_SCRIPT } from "./webviewFullscreen";
import { MUTE_VIDEO_SCRIPT, PAUSE_VIDEO_SCRIPT, setMutedScript, videoPauseTick } from "./videoPause";
import { MuteToggle } from "./MuteToggle";

// The page is a whole site (the feed and the video in a modal), so it gets a fixed
// height rather than the video's shape.
const PLAYER_HEIGHT = 520;

/** A v.douyin.com short link: resolved to its video id, then shown as a DouyinPlayer. */
export function DouyinShortPlayer(props: { url: string }) {
  return (
    <ShortLinkPlayer
      url={props.url}
      resolve={resolveDouyinShort}
      play={(id) => <DouyinPlayer id={id} />}
      fallbackSize={{ height: PLAYER_HEIGHT }}
      fallback={<ShortCard label="打开抖音视频" url={props.url} />}
    />
  );
}

export function DouyinPlayer(props: { id: string }) {
  const started = signal(false);
  // Every player starts muted; this is the switch for the one being watched.
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

  return (
    <View style={{ gap: 8, alignSelf: "stretch", position: "relative" }}>
      {started() ? (
        <WebView
          ref={page}
          src={douyinPageUrl(props.id)}
          injectedJavaScript={VIDEO_FULLSCREEN_SCRIPT + "\n" + MUTE_VIDEO_SCRIPT}
          style={{ height: PLAYER_HEIGHT, backgroundColor: "#000", borderRadius: 8 }}
        />
      ) : (
        <View
          onPress={() => started.set(true)}
          accessibilityLabel={`Open Douyin video ${props.id}`}
          style={{ height: PLAYER_HEIGHT, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#000" }}
        >
          <Text style={{ fontSize: 16, color: "#fff" }}>{`▶ 打开抖音视频 ${props.id}`}</Text>
        </View>
      )}
      {started() ? <MuteToggle muted={muted()} onToggle={toggleMute} /> : null}
      <Text style={{ fontSize: 12, color: palette().muted }}>需要登录的视频，在页面中扫码登录即可</Text>
    </View>
  );
}
