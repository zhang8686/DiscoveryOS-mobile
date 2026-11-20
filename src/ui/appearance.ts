// The colors of the app's own views and the appearance setting: follow the system,
// light, dark, or the warm beige theme. The setting is kept in the app's storage.
//
// Every view reads its colors from `palette()`, so a mode is a palette and nothing
// else: text, borders, links, buttons, the reply box, the viewer's chrome and the
// boards all follow the mode that is chosen, with no per-view conditionals.
import { colorScheme, setColorScheme, signal, Storage } from "nsh";

export type AppearanceMode = "system" | "light" | "dark" | "warm";

export interface Palette {
  bg: string;
  text: string;
  muted: string;
  link: string;
  border: string;
  surface: string;
  selected: string;
  /** The faint tint of a reply under the pointer; lighter than `selected`, which is for selections. */
  replyHighlight: string;
  danger: string;
  button: string;
  buttonText: string;
  buttonDisabled: string;
}

const LIGHT: Palette = {
  bg: "#ffffff",
  text: "#1f2328",
  muted: "#57606a",
  link: "#0969da",
  border: "#d0d7de",
  surface: "#f6f8fa",
  selected: "#dbe4ff",
  replyHighlight: "#f9fcfe",
  danger: "#cf222e",
  button: "#1f2328",
  buttonText: "#ffffff",
  buttonDisabled: "#8c959f",
};

const DARK: Palette = {
  bg: "#0d1117",
  text: "#e6edf3",
  muted: "#8d96a0",
  link: "#4493f8",
  border: "#3d444d",
  surface: "#161b22",
  selected: "#1c2d4a",
  replyHighlight: "#1a2334",
  danger: "#f85149",
  button: "#e6edf3",
  buttonText: "#0d1117",
  buttonDisabled: "#484f58",
};

// The warm beige theme: a paper-warm page, cards a shade lighter, brown-black text and an
// amber link. Contrast stays above 4.5:1 for body and muted text on both the page and the
// cards, so the theme is as readable as the light one — not a tint laid over it.
const WARM: Palette = {
  bg: "#F2E8D8",
  text: "#382D24",
  muted: "#6E5C46",
  link: "#8A5A1E",
  border: "#E2D3BC",
  surface: "#FAF3E7",
  selected: "#EADCC1",
  replyHighlight: "#F7EFDF",
  danger: "#B3402F",
  button: "#7A5C3A",
  buttonText: "#FFF9F0",
  buttonDisabled: "#BEAC93",
};

/** The setting the user chose (reactive). */
export const appearanceMode = signal<AppearanceMode>("system");

/** The palette of the appearance shown (reactive: reading it in JSX follows the setting). */
export function palette(): Palette {
  const mode = appearanceMode();
  if (mode === "warm") return WARM;
  return colorScheme() === "dark" ? DARK : LIGHT;
}

const STORAGE_KEY = "appearance";
const MODES: AppearanceMode[] = ["system", "light", "dark", "warm"];

const NAMES: Record<AppearanceMode, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
  warm: "温暖米色",
};

/** The name of a setting as the button shows it. */
export function appearanceName(mode: AppearanceMode): string {
  return NAMES[mode];
}

export function applyAppearance(mode: AppearanceMode) {
  appearanceMode.set(mode);
  // The warm theme is a light theme: the system's own surfaces (status bar text, text
  // selection, the keyboard's appearance) are told so and stay dark-on-light.
  setColorScheme(mode === "warm" ? "light" : mode);
}

/** Sets the setting and remembers it. */
export function chooseAppearance(mode: AppearanceMode) {
  applyAppearance(mode);
  Storage.setItem(STORAGE_KEY, mode).catch(() => undefined);
}

/** Moves to the next setting (system → light → dark → warm → system) and remembers it. */
export function cycleAppearance() {
  chooseAppearance(MODES[(MODES.indexOf(appearanceMode()) + 1) % MODES.length]);
}

function isMode(value: string | null): value is AppearanceMode {
  return value === "system" || value === "light" || value === "dark" || value === "warm";
}

/** Applies the setting saved by an earlier launch, if any. */
export function restoreAppearance() {
  Storage.getItem(STORAGE_KEY)
    .then((value) => {
      if (isMode(value)) applyAppearance(value);
    })
    .catch(() => undefined);
}
