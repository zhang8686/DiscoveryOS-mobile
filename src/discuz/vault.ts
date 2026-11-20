// Session persistence on Android: NSH Storage (app-private), cookies only.
// No plaintext password is kept: the Android build stores cookies only.
import { Storage } from "nsh";
import { consoleDebug } from "../debugLog";

const KEY = "discoveryos/vault";
export type Credentials = { name: string; pass: string };
export type Vault = { creds: Credentials | null; cookies: Record<string, string> };

let cache: Vault | null = null;
let initPromise: Promise<void> | null = null;
// Writes are chained so a slow write can never be overtaken by a newer one.
let writeChain: Promise<void> = Promise.resolve();

export function parseVault(raw: string | null): Vault {
  if (!raw) return { creds: null, cookies: {} };
  try {
    const v = JSON.parse(raw) as Partial<Vault> | null;
    const cookies: Record<string, string> = {};
    if (v?.cookies && typeof v.cookies === "object") {
      for (const [k, val] of Object.entries(v.cookies)) if (typeof val === "string") cookies[k] = val;
    }
    return { creds: null, cookies };
  } catch { return { creds: null, cookies: {} }; }
}

/** True once the on-device cookies have been read into memory. */
export function vaultReady(): boolean { return cache !== null; }

/** Reads the persisted cookies exactly once; concurrent callers share the promise. */
export function initVault(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const raw = await Storage.getItem(KEY);
        cache = parseVault(raw ?? null);
      } catch { cache = { creds: null, cookies: {} }; }
    })();
  }
  return initPromise;
}

export function loadVault(): Vault {
  return cache ?? { creds: null, cookies: {} };
}

/** Queues a durable write and returns a promise resolving once it is on disk. */
export function saveVault(next: Vault): Promise<void> {
  const snapshot: Vault = { creds: null, cookies: { ...next.cookies } };
  cache = snapshot;
  const text = JSON.stringify(snapshot);
  // Keep the failure in the chain: a login that thinks its session was saved must not lose it
  // silently on a full disk or a quota error.
  writeChain = writeChain.then(() => Storage.setItem(KEY, text)).catch((e) => {
    consoleDebug(`VAULT ! could not persist session: ${String(e)}`);
    throw e;
  });
  return writeChain;
}

/** Waits for every queued write: called after sign-in so a background kill cannot lose the session. */
export function flushVault(): Promise<void> { return writeChain; }
