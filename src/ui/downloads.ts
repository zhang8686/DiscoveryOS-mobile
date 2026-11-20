// Saving a post's file attachments into the Downloads folder. A press on an attachment's link
// starts the download; the toast says when it starts, when it is saved, and why it failed.
import { exists, mkdir, writeFile } from "fs/promises";
import process from "process";
import { AttachmentError, fetchAttachment, safeFileName, splitFileName } from "../discuz/attachments";
import { notify } from "./toast";

const TOAST = "download";
// The files being fetched, by address: a second press on the same link waits for the first.
const inFlight = new Set<string>();

/**
 * Writes `bytes` into the Downloads folder under the file's name, with a number added when
 * the name is taken (`a.md`, `a (2).md`). Resolves to the path written.
 */
/** The phone's own Downloads folder, which the app may write with the `fs` grant in
 * nsh.json; the app's private folder comes second, for a device that refuses it. */
const DOWNLOAD_DIRS = ["/storage/emulated/0/Download", `${process.dataDir}/Downloads`];

export async function saveToDownloads(name: string, bytes: Uint8Array): Promise<string> {
  const safe = safeFileName(name);
  const { stem, ext } = splitFileName(safe);
  let refusal: unknown = new Error("no folder to save to");
  for (const dir of DOWNLOAD_DIRS) {
    try {
      await mkdir(dir, { recursive: true });
      let target = `${dir}/${safe}`;
      for (let n = 2; await exists(target); n++) target = `${dir}/${stem} (${n})${ext}`;
      await writeFile(target, bytes);
      return target;
    } catch (e) {
      refusal = e;
    }
  }
  throw refusal;
}

/** Downloads the attachment at `url` (named `name`) into Downloads, and reports the outcome. */
export async function downloadAttachment(url: string, name: string): Promise<void> {
  if (inFlight.has(url)) return;
  inFlight.add(url);
  notify(TOAST, `正在下载 ${name}…`);
  try {
    const bytes = await fetchAttachment(url, name);
    const path = await saveToDownloads(name, bytes);
    notify(TOAST, `已保存 ${path.split("/").pop()} 到下载目录。`);
  } catch (e) {
    const reason = e instanceof AttachmentError ? `: ${e.message}` : "";
    notify(TOAST, `无法下载 ${name}${reason}。`);
  } finally {
    inFlight.delete(url);
  }
}
