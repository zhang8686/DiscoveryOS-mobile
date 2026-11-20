// Scrolling a thread pauses whatever video is playing in it: the player keeps its place, but its
// sound and frames stop while the user reads another floor, instead of playing on off screen.
import { signal } from "nsh";

/** Counts scrolls; a player pauses when it changes. */
export const videoPauseTick = signal(0);

/** Called as the thread scrolls (the caller throttles it). */
export function pauseVideos(): void {
  videoPauseTick.set(videoPauseTick() + 1);
}

/** Runs in the player's page: pauses every video it can reach, the page's own and a frame's. */
export const PAUSE_VIDEO_SCRIPT = `(() => {
  const pause = (root) => { try { root.querySelectorAll("video").forEach((v) => v.pause()); } catch (e) {} };
  pause(document);
  document.querySelectorAll("iframe").forEach((f) => { try { if (f.contentDocument) pause(f.contentDocument); } catch (e) {} });
})();`;

/** Runs in the player's page once it loads: every video starts muted. It is set again shortly after,
 * since some players raise the volume once they are ready; after that the user's own choice stands. */
export const MUTE_VIDEO_SCRIPT = `(() => {
  // The switch sets __nshSoundOn: once the user turns the sound on, nothing here mutes again.
  const mute = () => {
    if (window.__nshSoundOn) return;
    try { document.querySelectorAll("video").forEach((v) => { v.muted = true; }); } catch (e) {}
    try {
      document.querySelectorAll("iframe").forEach((f) => {
        if (!f.contentDocument) return;
        f.contentDocument.querySelectorAll("video").forEach((v) => { v.muted = true; });
      });
    } catch (e) {}
  };
  const start = () => {
    mute();
    [300, 1000, 2000].forEach((ms) => setTimeout(mute, ms));
    // The switch's flag stops these retries once the user wants sound.
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();`;

/** Runs in the player's page: sets every video it can reach to `muted`. */
export function setMutedScript(muted: boolean): string {
  const value = muted ? "true" : "false";
  return `(() => {
    window.__nshSoundOn = ${muted ? "false" : "true"};
    const set = (root) => { try { root.querySelectorAll("video").forEach((v) => { v.muted = ${value}; }); } catch (e) {} };
    set(document);
    document.querySelectorAll("iframe").forEach((f) => { try { if (f.contentDocument) set(f.contentDocument); } catch (e) {} });
  })();`;
}
