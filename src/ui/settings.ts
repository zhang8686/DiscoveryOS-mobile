// The display settings the app remembers: the size of the board column's text, of the thread list,
// of the thread body, and the body's line spacing. Kept in Storage, read at launch.
import { signal, Storage } from "nsh";

export type DisplaySettings = {
  /** Board column text, points. */
  board: number;
  /** Thread list text, points. */
  list: number;
  /** Thread body text, points. */
  body: number;
  /** Thread body line height, as a multiple of the body size. */
  spacing: number;
};

export const DISPLAY_DEFAULTS: DisplaySettings = { board: 12.5, list: 12.5, body: 15, spacing: 1.5 };

const DISPLAY_KEY = "visual:display";

export const displaySettings = signal<DisplaySettings>({ ...DISPLAY_DEFAULTS });

Storage.getItem(DISPLAY_KEY)
  .then((saved) => {
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Partial<DisplaySettings>;
      displaySettings.set({ ...DISPLAY_DEFAULTS, ...parsed });
    } catch { /* a stale value falls back to the defaults */ }
  })
  .catch(() => undefined);

/** Changes one or more settings and stores them. */
export function setDisplay(patch: Partial<DisplaySettings>): void {
  displaySettings.set({ ...displaySettings(), ...patch });
  Storage.setItem(DISPLAY_KEY, JSON.stringify(displaySettings())).catch(() => undefined);
}
