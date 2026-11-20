// Caches each user's avatar address for a day, in the app's storage, so the
// forum is not asked again on every launch. The picture itself is no longer
// downloaded here: avatars are static URLs that <Image> loads directly, so the
// old base64 picture cache (an unbounded in-memory map) and its download path
// were removed. A lookup already under way is shared by every caller that asks.
import { Storage } from "nsh";
import { loadUser } from "./forum";
import { absoluteUrl, HOST_BASE } from "./parse";
import { avatarUrlForUid } from "./avatarUrl";

const TTL_MS = 24 * 60 * 60 * 1000;

type Entry = { avatar: string; at: number };

const userKey = (name: string) => `avatar:${name}`;

// The lookups under way, by key: callers that ask for the same name share one.
const inFlight = new Map<string, Promise<unknown>>();

function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;
  const request = load().finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

/** The avatar's absolute address of `name`, `undefined` when the user has none. */
export function userAvatar(name: string): Promise<string | undefined> {
  return shared(`user:${name}`, async () => {
    const cached = await readEntry<Entry>(userKey(name));
    if (cached && fresh(cached, TTL_MS)) return cached.avatar ? absoluteUrl(cached.avatar, HOST_BASE) : undefined;
    const user = await loadUser(name);
    // The profile's avatar element can be missing while its uid is there; the uid alone builds
    // the same picture URL, so a row does not fall back to a grey square in that case.
    const avatar = user?.avatar || avatarUrlForUid(user?.id) || "";
    await Storage.setItem(userKey(name), JSON.stringify({ avatar, at: Date.now() } satisfies Entry)).catch(() => undefined);
    return avatar ? absoluteUrl(avatar, HOST_BASE) : undefined;
  });
}

const fresh = (entry: { at: number }, ttl: number) => Date.now() - entry.at < ttl;

async function readEntry<T extends { at: number }>(key: string): Promise<T | undefined> {
  try {
    const raw = await Storage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<T>;
    if (typeof parsed.at !== "number") return undefined;
    return parsed as T;
  } catch {
    return undefined;
  }
}
