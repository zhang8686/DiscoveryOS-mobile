// The scan page carries the reader and the picture; the bytes are base64'd a chunk at a time, so a
// picture of a few megabytes neither overflows the stack nor breaks the encoding at a chunk seam.
import { expect, test } from "nsh/test";
import { imageDataUrl, scanPage } from "./qrScanner";
import { QR_JS_BASE64 } from "./qrJs";

function bytesOf(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = (i * 7 + 3) % 256;
  return bytes;
}

function decode(url: string): string {
  return atob(url.slice(url.indexOf("base64,") + 7));
}

test("the picture reaches the page as a data URL of its own bytes", () => {
  const bytes = bytesOf(9);
  const url = imageDataUrl(bytes, "a.jpg");
  expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
  expect(decode(url)).toBe(String.fromCharCode(...bytes));
});

test("a picture larger than a chunk is encoded whole", () => {
  const bytes = bytesOf(70001);
  const url = imageDataUrl(bytes, "photo.png");
  expect(url.startsWith("data:image/png;base64,")).toBe(true);
  const back = decode(url);
  expect(back.length).toBe(bytes.length);
  expect(back.charCodeAt(0)).toBe(bytes[0]);
  expect(back.charCodeAt(40000)).toBe(bytes[40000]);
  expect(back.charCodeAt(bytes.length - 1)).toBe(bytes[bytes.length - 1]);
});

test("the page carries the reader and the picture", () => {
  const html = scanPage("data:image/jpeg;base64,AAAA");
  expect(html.includes("window.jsQR")).toBe(true);
  expect(html.includes("data:image/jpeg;base64,AAAA")).toBe(true);
  expect(html.includes("window.nsh.postMessage")).toBe(true);
});

test("the reader's source survives the trip through the bundle", () => {
  const source = atob(QR_JS_BASE64);
  expect(source.length > 100000).toBe(true);
  expect(source.startsWith("!function")).toBe(true);
});
