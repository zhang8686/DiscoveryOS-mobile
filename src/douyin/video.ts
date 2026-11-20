// Douyin's own page refuses a web view (it shows nothing), so the video file is read from Douyin's
// item API and handed to the platform's video component instead.
const API = (id: string) => `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${id}`;
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

/** The playable file of a Douyin video, or null when its item cannot be read. */
export async function douyinVideoUrl(id: string): Promise<string | null> {
  const res = await fetch(API(id), { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const json = (await res.json()) as { item_list?: { video?: { play_addr?: { url_list?: string[] } } }[] };
  const url = json.item_list?.[0]?.video?.play_addr?.url_list?.[0];
  if (typeof url !== "string" || !url) return null;
  // The watermarked copy (`playwm`) is the one the API lists first; the plain one plays the same.
  return url.replace("/playwm/", "/play/");
}
