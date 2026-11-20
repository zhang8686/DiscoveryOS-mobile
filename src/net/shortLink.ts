// Resolves a short link (b23.tv, v.douyin.com, ...) by following its redirect and reading
// the id out of the final URL. A resolve that takes longer than SHORT_LINK_TIMEOUT_MS gives up
// with null, so the caller can fall back to a WebView.
import { forumFetch } from "./http";

export const SHORT_LINK_TIMEOUT_MS = 5000;

/**
 * A resolver for one kind of short link: `readFinalUrl` turns the URL the redirect ends on
 * into the value wanted (a video id), or undefined when that URL is not a video.
 */
export function shortLinkResolver<T>(readFinalUrl: (finalUrl: string) => T | undefined): (url: string) => Promise<T | null> {
  // `resolved` holds finished answers (shared from then on). `inFlight` shares one request among
  // callers that ask while it is still running, and is dropped when it finishes.
  const resolved = new Map<string, Promise<T | null>>();
  const inFlight = new Map<string, Promise<T | null>>();
  return (url) => {
    const done = resolved.get(url);
    if (done) return done;
    const pending = inFlight.get(url);
    if (pending) return pending;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((giveUp) => {
      timer = setTimeout(() => giveUp(null), SHORT_LINK_TIMEOUT_MS);
    });
    const followed = forumFetch(url).then(
      ({ response }) => readFinalUrl(response.url) ?? null,
      () => null,
    );
    // Cache only the request's real answer. A timeout must not be remembered: the network may be
    // back a moment later, and a frozen null would force the WebView forever.
    const settled = followed.then((result) => {
      inFlight.delete(url);
      const answer = Promise.resolve(result);
      resolved.set(url, answer);
      return result;
    });
    const value = Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
    inFlight.set(url, value);
    return value;
  };
}
