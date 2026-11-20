// One place for the forum's requests: a deadline, a retry for what may safely be repeated, and a
// cap on how many run at once.
//
// On a phone the connection drops a request now and then — a Wi-Fi to mobile hand-off, a sleeping
// radio, a proxy that closes an idle socket. A request with no deadline never settled, so the
// screen waiting for it stayed empty: that is the "连不上论坛" the app was seeing. A burst of
// parallel loads (the channel list, the thread list, the reply pages warmed ahead, the avatars)
// also queued up behind a handful of sockets, so every one of them waited for the slowest; a
// small cap keeps the page the reader is looking at at the front of the line.
import { fetchLogged } from "./traffic";

/** How long one attempt may take before it is abandoned. */
const TIMEOUT_MS = 15_000;
/** Attempts after the first, for a request that may be repeated (a GET). */
const RETRIES = 2;
/** Requests in flight at once; the rest wait for a slot, in the order they asked. */
const MAX_CONCURRENT = 4;

let active = 0;
// Waiters carry their priority: a request the reader is waiting for (the thread's first page)
// goes in front of background warming. Within one priority the order is still first-come-first-served.
type Waiter = { run: () => void; high: boolean };
const queue: Waiter[] = [];

export type RequestPriority = "high" | "low";

/** Takes a slot, and returns the function that gives it back (idempotent). */
async function takeSlot(high = false): Promise<() => void> {
  if (active >= MAX_CONCURRENT) {
    // The slot is handed straight to the next waiter: `active` never dips below the cap, so a
    // request arriving in the gap cannot slip in and push the number of live sockets over it.
    // A high-priority waiter is placed before the low-priority ones already waiting.
    await new Promise<void>((resolve) => {
      const waiter: Waiter = { run: resolve, high };
      const at = high ? queue.findIndex((w) => !w.high) : -1;
      if (at < 0) queue.push(waiter);
      else queue.splice(at, 0, waiter);
    });
  } else {
    active++;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = queue.shift();
    if (next) next.run(); // the slot passes to the waiter; `active` stays the same
    else active--;
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A status worth another try: the server is busy, or the way to it is briefly broken. */
const retriableStatus = (status: number) => status === 408 || status === 425 || status === 429 || status >= 500;

export type Fetched = { response: Response; bytes: Uint8Array };

/**
 * `fetchLogged` with a deadline and, for a GET, up to `RETRIES` further attempts when the request
 * failed in transit or the server answered with a status worth repeating. A POST is never
 * repeated here: a reply that was in fact posted must not be posted twice.
 */
export async function forumFetch(
  url: string,
  init: RequestInit = {},
  decode?: (bytes: Uint8Array) => string,
  priority: RequestPriority = "low",
): Promise<Fetched> {
  const method = (init.method ?? "GET").toUpperCase();
  const attempts = method === "GET" ? RETRIES + 1 : 1;
  let last: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    // Hold a slot for one attempt only. A stalled request must not keep a socket from a request the
    // reader is waiting for during its backoff, or a burst of retries fills all four slots.
    const release = await takeSlot(priority === "high");
    let retry = false;
    try {
      const fetched = await fetchLogged(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }, decode);
      if (retriableStatus(fetched.response.status) && attempt < attempts - 1) {
        last = new Error(`HTTP ${fetched.response.status} for ${url}`);
        retry = true;
      } else {
        return fetched;
      }
    } catch (e) {
      last = e;
      // A refused capability or a malformed URL is not going to change on a retry.
      if (e instanceof Error && /ERR_ACCESS_DENIED|ERR_FEATURE_UNAVAILABLE/.test(e.message)) throw e;
      retry = attempt < attempts - 1;
    } finally {
      release();
    }
    if (retry) await wait(400 * (attempt + 1));
  }
  throw last instanceof Error ? last : new Error(String(last));
}
