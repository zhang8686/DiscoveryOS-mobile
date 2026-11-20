// A full-screen picture viewer for the pictures of one post: the page's display copy is what it
// draws, the original is what Save writes. Pinch to zoom, swipe left or right (or the two buttons)
// for the post's other pictures, and the bar says which one is shown. A tap on the black around
// the picture, the Close button, or a downward drag closes the viewer.
import { createAnimatedValue, createMotion, effect, Image, cleanup, reduceMotion, Scroll, signal, Text, View, WebView, windowSize } from "nsh";
import process from "process";
import { fetchAttachment } from "../discuz/attachments";
import { saveToDownloads } from "./downloads";
import { notify, TOAST_TOP } from "./toast";
import { openLink } from "./links";
import { imageDataUrl, scanPage } from "./qrScanner";

export type Shown = {
  /** The original file, which Save writes and the viewer looks the picture up by. */
  url: string;
  name: string;
  /** What is drawn: the page's display copy when there is one — the original can be
   *  several thousand pixels wide, and decoding it into the screen fails on Android. */
  display: string;
};

/** The pictures shown and the one in front: one post's pictures, so the reader can step through
 *  them without closing the viewer and opening the next one. */
export type Gallery = { items: Shown[]; index: number };

export const viewerState = signal<Gallery | null>(null);

/** Whether the viewer is open (App mounts it while this is true). */
export function viewerOpen(): boolean {
  return viewerState() !== null;
}

function fileName(url: string): string {
  let last = url.split(/[?#]/)[0].split("/").pop() ?? "";
  try { last = decodeURIComponent(last); } catch { /* keep the encoded spelling */ }
  // Unicode file names are common here. Only reject path/traversal characters, and let a safe
  // subset through so a ".png"/".webp" reaches the MIME inference in the QR reader.
  return last && last.length <= 80 && !/[\/\\:*?"<>|\x00-\x1f]/.test(last) ? last : "图片.jpg";
}

function shown(url: string, thumb?: string): Shown {
  const n = fileName(url);
  return {
    url,
    display: thumb && thumb.length > 0 ? thumb : url,
    name: n === "图片.jpg" ? fileName(thumb ?? "") : n,
  };
}

/** Opens the viewer on one picture (what Save writes), drawing `thumb` — the page's display copy —
 *  when the post had one. */
export function openImageViewer(url: string, thumb?: string): void {
  if (!url) return;
  viewerState.set({ items: [shown(url, thumb)], index: 0 });
}

/** Opens the viewer at `index` of a post's pictures, so the reader can step to the others. */
export function openGallery(items: Shown[], index: number): void {
  if (items.length === 0) return;
  viewerState.set({ items, index: Math.max(0, Math.min(items.length - 1, index)) });
}

/** Shows the picture before (`step` -1) or after (step 1) this one, staying on the same post. */
export function stepImage(step: 1 | -1): void {
  const g = viewerState();
  if (!g) return;
  const next = g.index + step;
  if (next < 0 || next >= g.items.length) return;
  viewerState.set({ items: g.items, index: next });
}

// A picture's place in a post's HTML: `fixImages` wraps every picture in a link to its original
// (`<p><a href="full"><img src="display"></a></p>`), so the original and the display copy are read
// from the same tag. A picture the transform left unwrapped is taken by its `src`.
const LINKED_IMAGE = /<a\b[^>]*\bhref="([^"]+)"[^>]*>\s*<img\b[^>]*\bsrc="([^"]*)"[^>]*>/gi;
const PLAIN_IMAGE = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi;

/**
 * The pictures of one post, in the order they appear, as the viewer steps through them. It reads
 * the post's transformed HTML (the same string the text view draws), so what the reader taps is
 * exactly what the gallery holds.
 */
export function postImages(html: string): Shown[] {
  const out: Shown[] = [];
  const seen = new Set<string>();
  const add = (url: string, display: string) => {
    const full = url || display;
    // A smiley or an icon is not a picture to read: the transform keeps smilies under `smilies/`.
    if (!full || /smilies\//i.test(full)) return;
    if (seen.has(full)) return;
    seen.add(full);
    out.push(shown(full, display));
  };
  for (const m of html.matchAll(LINKED_IMAGE)) add(m[1], m[2]);
  for (const m of html.matchAll(PLAIN_IMAGE)) {
    const src = m[1];
    if (!out.some((p) => p.display === src || p.url === src)) add(src, src);
  }
  return out;
}

function ToolButton(props: { label: string; title?: string; onPress: () => void; disabled?: boolean; round?: boolean }) {
  return (
    <View
      onPress={props.disabled ? undefined : props.onPress}
      accessibilityLabel={props.title ?? props.label}
      style={{
        minHeight: 44, minWidth: props.round ? 44 : 68,
        alignItems: "center", justifyContent: "center",
        borderRadius: 22,
        backgroundColor: "rgba(18, 20, 24, 0.45)", borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.24)",
        opacity: props.disabled ? 0.3 : 1,
      }}
    >
      <Text style={{ fontSize: props.round ? 22 : 13, color: "#ffffff", lineHeight: props.round ? 24 : undefined }}>{props.label}</Text>
    </View>
  );
}

/**
 * Saves the picture. On Android NSH's `fs` does no file I/O at all and there is no media-store API,
 * so writing into the phone's gallery is not something the app can do itself: the original is
 * handed to the system browser, where a long press saves the picture (the browser's own doing).
 */
async function savePicture(url: string, name: string): Promise<void> {
  if (process.platform !== "android" && process.platform !== "ios") {
    notify("image-save", "正在保存图片…", undefined, TOAST_TOP);
    try {
      const bytes = await fetchAttachment(url, name);
      const path = await saveToDownloads(name, bytes);
      notify("image-save", `已保存 ${path.split("/").pop()}。`, undefined, TOAST_TOP);
      return;
    } catch {
      // The menu promised the downloads folder; say why the browser is taking over instead of
      // opening it silently.
      notify("image-save", "本机保存失败，改为在浏览器中打开原图。", undefined, TOAST_TOP);
    }
  }
  // The menu says what this does, above the option that does it, so nothing is raised here: the
  // browser takes the screen and the reader long-presses the picture there.
  await openLink(url);
}

/** What the save menu says above "保存图片", before it is pressed: on a phone the app hands the
 *  original to the browser, where the picture is saved by the browser's own long press. */
function saveHint(): string {
  return process.platform === "android" || process.platform === "ios"
    ? "保存图片会跳转到浏览器，再长按保存到相册"
    : "保存到本机的下载目录";
}

export function ImageViewer() {
  const win = windowSize();
  const availW = Math.max(200, win.width - 24);
  const availH = Math.max(220, win.height - 130);
  const entrance = createMotion();
  // A downward drag closes the viewer; a sideways one steps to the post's other pictures.
  const dismissPan = createAnimatedValue(0);
  const stepPan = createAnimatedValue(0);
  // A long press on the picture offers what can be done with it, so the picture keeps the screen
  // to itself and no Save button sits over it.
  const menuOpen = signal(false);
  // Stepping through a post's pictures is a sideways push inside the picture's box: the picture
  // being left slides out the way the step goes while the next one slides in behind it, both by the
  // box's width and in step, so the box is always covered and nothing flashes. The screen behind —
  // the black, the name bar, the counter and the buttons — does not move at all.
  const leavingX = createAnimatedValue(0);
  const enteringX = createAnimatedValue(0);
  // The picture sliding out, while a step plays: `null` when the one shown is the only one drawn.
  const leaving = signal<number | null>(null);
  // The viewer is entered once per opening: the opening zoom belongs to the first picture, not to
  // every step (replaying it on each step is what made the whole screen flash).
  let opened = false;
  let shownIndex = 0;
  let stepSeq = 0;
  effect(() => {
    const g = viewerState();
    if (!g) { opened = false; leaving.set(null); return; }
    if (!opened) {
      opened = true;
      shownIndex = g.index;
      void entrance.play("zoomIn", { duration: 180, easing: "easeOut" });
      return;
    }
    if (g.index === shownIndex) return;
    const direction = g.index > shownIndex ? 1 : -1;
    const from = shownIndex;
    shownIndex = g.index;
    const seq = ++stepSeq;
    const travel = availW;
    if (reduceMotion()) {
      leaving.set(null);
      leavingX.set(0);
      enteringX.set(0);
      return;
    }
    // Forward: the old picture leaves to the left, the new one arrives from the right.
    leaving.set(from);
    leavingX.set(0);
    enteringX.set(direction * travel);
    void leavingX.timing(-direction * travel, { duration: 220, easing: "easeOut" }).catch(() => undefined);
    void enteringX.timing(0, { duration: 220, easing: "easeOut" }).then(() => {
      // Compare against the latest step, not the index captured this round: a quick 0→1→2→1
      // would otherwise let the first callback clear the third step's outgoing picture.
      if (seq !== stepSeq) return;
      leaving.set(null);
      leavingX.set(0);
    }).catch(() => undefined);
  });
  const gallery = () => viewerState();
  const current = () => gallery()?.items[gallery()!.index];

  // Reading a QR code out of the picture: the page that does it is mounted for as long as the scan
  // runs, and answers through `window.nsh.postMessage`.
  const scanPageHtml = signal<string | null>(null);
  const scanning = signal(false);
  let scanTimer: ReturnType<typeof setTimeout> | undefined;

  function finishScan(text: string | null, failure?: string): void {
    // onMessage and onError (or two messages) can both arrive; the first answer wins.
    if (!scanning()) return;
    if (scanTimer !== undefined) { clearTimeout(scanTimer); scanTimer = undefined; }
    scanning.set(false);
    scanPageHtml.set(null);
    if (!text) {
      notify("image-scan", failure ?? "没有在图片里找到二维码。", undefined, TOAST_TOP);
      return;
    }
    const value = text.trim();
    // A code that carries a link opens it; a bare domain ("www.4d4y.com") is taken as the link it
    // means; anything else (a Wi-Fi key, a line of text) is shown rather than opened.
    const link = /^https?:\/\//i.test(value) ? value
      : /^[\w-]+(?:\.[\w-]+)+\/?\S*$/.test(value) ? `https://${value}`
      : null;
    if (link) { void openLink(link); return; }
    notify("image-scan", `二维码内容：${value.length > 40 ? `${value.slice(0, 40)}…` : value}`, undefined, TOAST_TOP);
  }

  async function scanPicture(item: Shown): Promise<void> {
    if (scanning()) return;
    scanning.set(true);
    notify("image-scan", "正在识别二维码…", undefined, TOAST_TOP);
    scanTimer = setTimeout(() => finishScan(null, "没有在图片里找到二维码。"), 12000);
    try {
      // The original first (the code is sharpest there), the display copy when it cannot be read.
      let bytes: Uint8Array;
      try {
        bytes = await fetchAttachment(item.url, item.name);
      } catch {
        bytes = await fetchAttachment(item.display, item.name);
      }
      if (!scanning()) return; // the viewer was closed while the picture was downloading
      scanPageHtml.set(scanPage(imageDataUrl(bytes, item.name)));
    } catch {
      finishScan(null, "这张图片读不出来，无法扫码。");
    }
  }
  // Closing the viewer (or a new scan) must not leave a timer behind to fire on the closed screen.
  effect(() => {
    const g = viewerState();
    if (!g) finishScan(null);
  });
  cleanup(() => {
    if (scanTimer !== undefined) clearTimeout(scanTimer);
    scanTimer = undefined;
    scanning.set(false);
  });
  return gallery() ? (
    // The black of the viewer is opaque from the first frame: the opening zoom fades what is drawn
    // on it (the bar, the picture, the buttons), never the layer itself — so a step sliding inside
    // it can never show the page the viewer was opened from.
    <View
      onPress={() => viewerState.set(null)}
      style={{
        position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
        backgroundColor: "#101114",
      }}
    >
      <View style={{ flex: 1, alignItems: "stretch", justifyContent: "flex-start", opacity: entrance.opacity }}>
      {/* The status bar is drawn over the top of the window here, so the bar's own text and
          buttons need room under it. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, backgroundColor: "#1b1d22" }}>
        <Text style={{ fontSize: 12, color: "#e8eaed", flex: 1, numberOfLines: 1 }}>{current()?.name ?? ""}</Text>
        {gallery()!.items.length > 1 ? (
          <Text style={{ fontSize: 12, color: "#aeb4bd" }}>{`${gallery()!.index + 1} / ${gallery()!.items.length}`}</Text>
        ) : null}
      </View>
      {/* The picture is centred in a zoomable scroll: two fingers pinch it 1×–4×. */}
      <Scroll
        style={{ flex: 1 }}
        minimumZoomScale={1}
        maximumZoomScale={4}
        zoomable={true}
        centerContent={true}
        contentStyle={{ alignItems: "center", justifyContent: "center" }}
      >
        <View
          onPress={() => viewerState.set(null)}
          pan={{ y: dismissPan, x: stepPan }}
          panActivation={{ activeOffsetX: 40, activeOffsetY: 40 }}
          onPanEnd={(e: any) => {
            const dx = e?.translation?.x ?? 0;
            const vx = e?.velocity?.x ?? 0;
            const dy = e?.translation?.y ?? 0;
            if (Math.abs(dx) > Math.abs(dy) && !e?.cancelled && (dx < -50 || vx < -600)) stepImage(1);
            else if (Math.abs(dx) > Math.abs(dy) && !e?.cancelled && (dx > 50 || vx > 600)) stepImage(-1);
            else if (!e?.cancelled && dy > 90) viewerState.set(null);
            dismissPan.set(0);
            stepPan.set(0);
          }}
          style={{ width: win.width, height: win.height - 8, alignItems: "center", justifyContent: "center" }}
        >
          <View
            onPress={() => undefined}
            onLongPress={() => menuOpen.set(true)}
            accessibilityLabel="长按可保存图片"
            style={{ width: availW, height: availH, overflow: "hidden", backgroundColor: "#101114" }}
          >
            {/* The picture shown keeps this first position in the box for its whole life, so a
                step never remounts (and re-decodes) it: the one being left is drawn after it, under
                it, for as long as the step plays. */}
            <Image
              src={current()!.display}
              // No fade: one on top of the slide would show the box through the arriving picture.
              fadeDuration={0}
              style={{
                width: availW, height: availH, objectFit: "contain", borderRadius: 6,
                transform: [{ translateX: enteringX }], zIndex: 2,
              }}
            />
            {leaving() !== null ? (
              <Image
                src={gallery()!.items[leaving()!].display}
                fadeDuration={0}
                style={{
                  position: "absolute", left: 0, top: 0, width: availW, height: availH,
                  objectFit: "contain", borderRadius: 6,
                  transform: [{ translateX: leavingX }], zIndex: 1,
                }}
              />
            ) : null}
          </View>
        </View>
      </Scroll>
      {/* The next and previous pictures are fetched while this one is read, so stepping through
          them does not wait on the network each time. */}
      {gallery()!.items.length > 1 ? (
        <View style={{ width: 0, height: 0, opacity: 0 }}>
          {[gallery()!.index - 1, gallery()!.index + 1, gallery()!.index + 2]
            .filter((i) => i >= 0 && i < gallery()!.items.length)
            .map((i) => <Image src={gallery()!.items[i].display} style={{ width: 1, height: 1 }} />)}
        </View>
      ) : null}
      {/* Previous, Close and next, within thumb reach, with the two steps reduced to arrows. */}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, zIndex: 20 }}>
        {gallery()!.items.length > 1 ? (
          <ToolButton label="‹" title="上一张" round disabled={gallery()!.index === 0} onPress={() => stepImage(-1)} />
        ) : null}
        <ToolButton label="关闭" onPress={() => viewerState.set(null)} />
        {gallery()!.items.length > 1 ? (
          <ToolButton label="›" title="下一张" round disabled={gallery()!.index === gallery()!.items.length - 1} onPress={() => stepImage(1)} />
        ) : null}
      </View>
      {/* Long press on the picture: what can be done with it, without a button on it. */}
      {menuOpen() ? (
        <View
          onPress={() => menuOpen.set(false)}
          style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0, 0, 0, 0.45)", zIndex: 30 }}
        >
          {/* The menu and its note share one column as wide as the menu, so the note sits on the
              menu's own centre line, a small gap above "保存图片" — not over it: it never overlaps
              an option, and a press on it falls through to the dimmed screen and closes the menu.
              It is drawn only while the menu is open, so 取消 (or any close) takes it away too. */}
          <View style={{ width: 232 }}>
            <View
              style={{
                marginBottom: 8,
                paddingVertical: 7,
                paddingHorizontal: 10,
                borderRadius: 14,
                backgroundColor: "rgba(35, 37, 41, 0.94)",
                pointerEvents: "none",
              }}
            >
              <Text style={{ fontSize: 12, lineHeight: 16, color: "#aeb4bd", textAlign: "center" }}>{saveHint()}</Text>
            </View>
            <View
              onPress={() => undefined}
              style={{ paddingVertical: 6, borderRadius: 14, backgroundColor: "#232529", overflow: "hidden" }}
            >
              <View
                onPress={() => { menuOpen.set(false); void savePicture(current()!.url, current()!.name); }}
                accessibilityLabel="保存图片"
                style={{ paddingVertical: 14, alignItems: "center" }}
              >
                <Text style={{ fontSize: 15, color: "#ffffff" }}>保存图片</Text>
              </View>
              <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.12)" }} />
              <View
                onPress={() => {
                  const item = current();
                  menuOpen.set(false);
                  if (item) void scanPicture(item);
                }}
                accessibilityLabel="扫码"
                style={{ paddingVertical: 14, alignItems: "center" }}
              >
                <Text style={{ fontSize: 15, color: "#ffffff" }}>扫码</Text>
              </View>
              <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.12)" }} />
              <View
                onPress={() => menuOpen.set(false)}
                accessibilityLabel="取消"
                style={{ paddingVertical: 14, alignItems: "center" }}
              >
                <Text style={{ fontSize: 15, color: "#aeb4bd" }}>取消</Text>
              </View>
            </View>
          </View>
        </View>
      ) : null}
      {/* The code reader: a web view of its own, a couple of points square and invisible, because
          the project has no way to read a picture's pixels itself. It posts the text back and is
          taken away as soon as it answers. */}
      {scanPageHtml() ? (
        <View style={{ position: "absolute", left: 0, bottom: 0, width: 2, height: 2, opacity: 0, zIndex: 1 }}>
          <WebView
            html={scanPageHtml()!}
            baseUrl="https://www.4d4y.com/"
            javaScriptEnabled={true}
            onMessage={(e: { data: string }) => {
              let text: string | null = null;
              let failure: string | undefined;
              try {
                const answer = JSON.parse(e.data) as { text?: string; error?: string };
                text = answer.text ? answer.text : null;
                if (!text) failure = answer.error ? "这张图片读不出来，无法扫码。" : "没有在图片里找到二维码。";
              } catch {
                failure = "扫码没有成功。";
              }
              finishScan(text, failure);
            }}
            onError={() => finishScan(null, "这里打不开扫码页面。")}
            style={{ width: 2, height: 2 }}
          />
        </View>
      ) : null}
      </View>
    </View>
  ) : null;
}
