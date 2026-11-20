// Reading a QR code out of a picture the viewer shows. The platform has no barcode API and no way
// to read a picture's pixels from the app, so the decoding runs where pixels are: a web view with a
// canvas, running jsQR over the picture and posting the text back. The picture reaches the page as a
// data URL, so the canvas is never tainted and a picture from the forum needs no CORS header.
import { QR_JS_BASE64 } from "./qrJs";

let decodedSource: string | null = null;

/** jsQR's source, decoded once from the text the bundle carries. */
function source(): string {
  decodedSource ??= atob(QR_JS_BASE64);
  return decodedSource;
}

/** The bytes as a data URL, named by `name`'s extension so the page decodes it as what it is. */
export function imageDataUrl(bytes: Uint8Array, name: string): string {
  return `data:${mimeOf(name)};base64,${base64Of(bytes)}`;
}

function mimeOf(name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

/** Base64 of the bytes, a chunk at a time: a spread over millions of them would overflow the stack. */
function base64Of(bytes: Uint8Array): string {
  // A multiple of 3, so each chunk's base64 stands on its own and the chunks just concatenate.
  const CHUNK = 32769;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += btoa(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return out;
}

/**
 * The page that finds a QR code in `dataUrl` and posts what it says: `{ text }` — empty when there
 * is none — or `{ error }` when the picture cannot be drawn. `window.nsh.postMessage` is the only
 * way back to the app.
 */
export function scanPage(dataUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}</style>
</head><body>
<script>${source()}</script>
<script>
(function () {
  function post(message) {
    try { window.nsh.postMessage(JSON.stringify(message)); } catch (e) {}
  }
  function read(img) {
    try {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h) { post({ error: "size" }); return; }
      // Up to 1600 pixels on the long side: enough for the modules of a code in a photo, small
      // enough that the pixels come back quickly.
      var scale = Math.min(1, 1600 / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement("canvas");
      canvas.width = cw; canvas.height = ch;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, cw, ch);
      var pixels = ctx.getImageData(0, 0, cw, ch);
      // A code drawn light on dark is as common as the other way round.
      var found = window.jsQR(pixels.data, cw, ch, { inversionAttempts: "attemptBoth" });
      post({ text: found && found.data ? found.data : "" });
    } catch (e) {
      post({ error: String((e && e.message) || e) });
    }
  }
  var img = new Image();
  img.onload = function () { read(img); };
  img.onerror = function () { post({ error: "load" }); };
  img.src = ${JSON.stringify(dataUrl)};
})();
</script>
</body></html>`;
}
