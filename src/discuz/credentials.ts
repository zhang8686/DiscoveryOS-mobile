// Android keeps only the session cookie; the password is never stored.
import type { Credentials } from "./vault";
export type { Credentials };
export function loadCredentials(): Credentials | null { return null; }
export function saveCredentials(_creds: Credentials): void {}
export function clearCredentials(): void {}
