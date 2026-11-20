// Cross-platform stand-ins for the desktop Rust crate. The app is pure TSX on Android.
export { Gb18030 } from "./discuz/gb18030";

export const Keychain = {
  load: (_account: string): string | null => null,
  save: (_account: string, _secret: string): void => {},
  delete: (_account: string): void => {},
};

export const Files = {
  path: (_uri: string): string | null => null,
  read: (_path: string): Uint8Array | null => null,
};

export const DebugLog = {
  path: (): string | null => null,
  write: (_s: string): void => {},
};

export const Updater = { aboutInfo: (): string => "{}" };
