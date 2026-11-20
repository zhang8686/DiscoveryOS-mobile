// Whether a text field has the keyboard focus, and one shared decision about the keyboard's
// state. The reply box sets the focus signal; the app's root and the reply box both read the
// state below, so the window's own shrink (adjustResize) and an unreliable IME height report are
// interpreted the same way in both places.
import { keyboardFrame, signal, windowSize } from "nsh";

export const textFieldFocused = signal(false);

let baseWindowHeight = 0;
let imeSeen = false;

/** The inset the app must add, and whether the keyboard is actually up. */
function state(): { inset: number; open: boolean } {
  const h = windowSize().height;
  if (h > baseWindowHeight) baseWindowHeight = h;
  const shrink = baseWindowHeight - h;
  // The system already made room (the manifest asks for adjustResize): the window ends above the
  // keyboard, so no inset is added — adding the IME height too would lift the box twice.
  if (shrink > 120) {
    imeSeen = true;
    return { inset: 0, open: true };
  }
  const ime = keyboardFrame().height;
  if (ime > 80) {
    imeSeen = true;
    return { inset: ime, open: true };
  }
  // The keyboard was reported before and is now closed: no inset, even if the field kept its
  // focus (the back key closes the keyboard without a blur). On the target phone the IME height
  // often reads 0 while the keyboard is up, so this is only reached after a real report or shrink.
  if (imeSeen) return { inset: 0, open: false };
  // A platform that reports neither while a field has the focus: lift by what the window lost.
  if (textFieldFocused() && shrink > 0) return { inset: Math.min(shrink, 360), open: true };
  return { inset: 0, open: false };
}

/** Extra bottom padding for the app's root, when the window did not resize itself. */
export function keyboardInset(): number {
  return state().inset;
}

/** True while a keyboard is up, even when its reported height is 0. */
export function keyboardIsOpen(): boolean {
  return state().open;
}
