// Every message the app shows that comes and goes on its own: "Reply posted", "Link copied",
// "Couldn't load threads". A message with the same id replaces the one showing, rather than
// stacking a copy; one with a tap action (a failed load's retry) runs it when tapped.
//
// Where a message sits: at the side of the control whose press started it. The control registers
// itself with `anchorToast` as it is pressed, and the message is placed against it as an overlay —
// so a "链接已复制。" note appears beside the link button instead of in the middle of the screen. A message
// with no control behind it (a background refresh that failed) falls back to the middle. The image
// viewer's messages are the one exception: they stay under the status bar at the top, where the
// viewer's own dark screen leaves them readable.
import { createMotion, Overlay, signal, Text, View, type ViewRef } from "nsh";
import { ToastManager, type ToastEntry } from "nsh/base";
import { palette } from "./appearance";

// Short: a note about an action just taken is read at a glance, and a message that lingers starts
// to look like part of the screen. Anything that sat on the screen a full 1.6 s stayed long enough
// to be read twice and began to feel like a caption; a passing note is gone in about a second.
const TIMEOUT_MS = 1100;
// A message a tap can act on stays longer, so there is time to read it and tap.
const ACTION_TIMEOUT_MS = 3000;
// The image viewer's own messages sit outside every other surface and describe a step the reader
// still has to take elsewhere (a long press in the browser), so they keep the older, longer stay.
const VIEWER_TIMEOUT_MS = 1600;
const TICK_MS = 100;
const LIMIT = 3;
// Above every overlay the app itself draws: panes (25/26), the thread's actions (20), the image
// viewer's save menu (30), the message and profile sheets (44–46), the settings panel (40).
const TOP_Z = 300;

/** Where a message is drawn: beside `anchor`, at the top of the screen, or in the middle. */
export type ToastPlace = { anchor: ViewRef } | "top" | "center";

/** A message that belongs at the top (the image viewer's) says so where it is raised. */
export const TOAST_TOP: ToastPlace = "top";

const manager = new ToastManager();
const shown = signal<ToastEntry[]>([]);
const actions = new Map<string, () => void>();
const places = new Map<string, ToastPlace>();
let ticking: ReturnType<typeof setInterval> | undefined;

// The control pressed last. A toast raised while its request finishes is placed by it: the window
// is long enough for a slow reply and short enough that a later, unrelated message is not dragged
// to a button the user has moved on from.
const ANCHOR_TTL_MS = 10_000;
let pressed: { ref: ViewRef; at: number } | null = null;

/**
 * Marks the control whose press is starting an action: the messages that action raises show beside
 * it. Call it first in the control's press handler.
 */
export function anchorToast(ref: ViewRef | null | undefined): void {
  if (ref) pressed = { ref, at: Date.now() };
}

function sync() {
  shown.set(manager.visible(LIMIT));
}

function tick() {
  const advanced = manager.advance(false);
  if (advanced.changed) sync();
  if (manager.isEmpty() && ticking !== undefined) {
    clearInterval(ticking);
    ticking = undefined;
  }
}

/**
 * Shows `text` as toast `id` for a moment; raising it again replaces it. `onTap` runs when it is
 * tapped. `place` overrides where it sits: otherwise it goes beside the last pressed control, or
 * in the middle when there is none.
 */
export function notify(id: string, text: string, onTap?: () => void, place?: ToastPlace): void {
  if (onTap) actions.set(id, onTap);
  else actions.delete(id);
  if (place) places.set(id, place);
  else places.delete(id);
  const timeout = onTap ? ACTION_TIMEOUT_MS : place === TOAST_TOP ? VIEWER_TIMEOUT_MS : TIMEOUT_MS;
  manager.push(id, text, { timeout });
  sync();
  ticking ??= setInterval(tick, TICK_MS);
}

/** Where an entry is drawn: what it was raised with, else the control pressed, else the middle. */
function placeOf(id: string): ToastPlace {
  const given = places.get(id);
  if (given) return given;
  if (pressed && Date.now() - pressed.at < ANCHOR_TTL_MS) return { anchor: pressed.ref };
  return "center";
}

function tap(id: string) {
  const run = actions.get(id);
  actions.delete(id);
  manager.dismiss(id);
  sync();
  run?.();
}

function ToastItem(props: { text: string; onPress?: () => void }) {
  // Enters from below as it shows; leaves when its time runs out (no exit motion yet).
  const entrance = createMotion({ enter: "fadeInUp", duration: 180, easing: "easeOut" });
  return (
    <View style={entrance.style}>
      <View
        onPress={props.onPress}
        accessibilityLabel={props.text}
        style={{
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: 10,
          maxWidth: 280,
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().surface,
          // A note with nothing to tap lets presses through to what is under it.
          pointerEvents: props.onPress ? "auto" : "none",
        }}
      >
        <Text style={{ fontSize: 13, color: palette().text }}>{props.text}</Text>
      </View>
    </View>
  );
}

/**
 * The toasts. A message raised by a control is drawn against it (an overlay, so it follows the
 * control and flips to the other side when the screen's edge is near); one with no control behind
 * it sits in the middle; the image viewer's sit at the top. Every layer takes no press itself
 * (`box-none`), so what is under it keeps working.
 */
export function Toaster() {
  const entries = () => shown();
  const around = (want: (p: ToastPlace) => boolean) => entries().filter((e) => want(placeOf(e.id)));
  const anchored = () => entries().filter((e) => typeof placeOf(e.id) === "object");

  return (
    <>
      {/* The middle: messages with no control behind them. */}
      <View
        style={{
          position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
          alignItems: "center", justifyContent: "center",
          paddingHorizontal: 32,
          pointerEvents: "box-none",
          zIndex: TOP_Z,
        }}
      >
        <View style={{ alignItems: "center", gap: 8, maxWidth: 320, pointerEvents: "box-none" }}>
          <Each of={around((p) => p === "center")} key={(e: ToastEntry) => e.id}>
            {(entry) => <ToastItem text={String(entry().value)} onPress={actions.has(entry().id) ? () => tap(entry().id) : undefined} />}
          </Each>
        </View>
      </View>
      {/* The top, under the status bar: the image viewer's own messages. Above every sheet and
          panel the app draws (the viewer's save menu included), so a message is never covered by
          the very thing it explains. */}
      <View
        style={{
          position: "absolute", left: 0, right: 0, top: 10,
          alignItems: "center", gap: 8,
          paddingHorizontal: 16,
          pointerEvents: "box-none",
          zIndex: TOP_Z,
        }}
      >
        <Each of={around((p) => p === "top")} key={(e: ToastEntry) => e.id}>
          {(entry) => <ToastItem text={String(entry().value)} onPress={actions.has(entry().id) ? () => tap(entry().id) : undefined} />}
        </Each>
      </View>
      {/* Beside the control that raised them: below it by default, and above it when the bottom
          of the screen is close (the overlay flips sides by itself). */}
      <Each of={anchored()} key={(e: ToastEntry) => e.id}>
        {(entry) => {
          const place = placeOf(entry().id);
          const anchor = typeof place === "object" ? place.anchor : null;
          return anchor ? (
            // At the control's side rather than under it: to its left by default (the controls that
            // raise these are on the right), and to its right when the left edge is close — an
            // overlay takes the other side by itself.
            <Overlay anchor={anchor} placement="left" align="center" offset={8} margin={12}>
              <ToastItem text={String(entry().value)} onPress={actions.has(entry().id) ? () => tap(entry().id) : undefined} />
            </Overlay>
          ) : null;
        }}
      </Each>
    </>
  );
}
