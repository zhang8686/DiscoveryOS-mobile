// index.php is behind Cloudflare Managed Challenge on 4d4y.com.
// Other Discuz pages are served normally, so ship a channel list and refresh it
// from a served page whenever the forum exposes one.
import type { Channel } from "./parse";

/** Built-in channel list, used on first launch and as a fallback. */
export const BUILTIN_CHANNELS: Channel[] = [
  { id: "6", title: "Buy & Sell 交易服务区", description: "最IN数码产品热卖场，易手产品交易区", newPosts: 0 },
  { id: "7", title: "Geek Talks · 奇客怪谈", description: "业界、Bluetooth、WiFi、嵌入式", newPosts: 0 },
  { id: "9", title: "Smartphone", description: "智能手机", newPosts: 0 },
  { id: "56", title: "iPhone, iPod Touch，iPad", description: "可以用两根手指头同时摸的手机和上网设备", newPosts: 0 },
  { id: "60", title: "Android, Chrome, & Google", description: "Cloud Computing", newPosts: 0 },
  { id: "12", title: "PalmOS ，Treo", description: "PalmOS 的各种软件、硬件", newPosts: 0 },
  { id: "22", title: "麦客爱苹果", description: "G4，Powerbook，iMac，iPod", newPosts: 0 },
  { id: "14", title: "Windows Mobile，PocketPC，HPC", description: "WinCE/PPC 上的硬件评测与软件使用", newPosts: 0 },
  { id: "50", title: "DC,NB,MP3,Gadgets...", description: "笔记本、数码相机、各种电子玩具", newPosts: 0 },
  { id: "2", title: "Discovery", description: "综合讨论", newPosts: 0 },
  { id: "24", title: "意欲蔓延", description: "电影、音乐、读书、美术、摄影", newPosts: 0 },
  { id: "23", title: "随笔与个人文集", description: "在岁月的书签上，留下我的痕迹", newPosts: 0 },
  { id: "25", title: "吃喝玩乐", description: "美食、旅行", newPosts: 0 },
  { id: "51", title: "La Femme", description: "三月三日天气新", newPosts: 0 },
  { id: "40", title: "Palm芝麻宝典", description: "", newPosts: 0 },
  { id: "62", title: "Joggler", description: "", newPosts: 0 },
  { id: "63", title: "已完成交易", description: "", newPosts: 0 },
  { id: "64", title: "只讨论2.0", description: "", newPosts: 0 },
  { id: "70", title: "俄乌战争", description: "", newPosts: 0 },
];

/** Whether a parsed name says anything. A served page sometimes carries "…" (or dashes) where the
 * board's name should be, and merging that would replace a good built-in name with a blank one. */
function namesSomething(title: string | undefined): boolean {
  const text = (title ?? "").replace(/[.…\s:：·\-—_]+$/u, "").trim();
  // At least two letters or digits: a page that leaves a single glyph ("…", "·") where the name
  // should be is not a name, and the built-in one is better than a board called "…".
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2;
}

/** Merges channels parsed from a served page into the built-in list. */
export function mergeChannels(found: Channel[]): Channel[] {
  const out = new Map<string, Channel>();
  for (const c of BUILTIN_CHANNELS) out.set(c.id, { ...c });
  // A name that says nothing is not merged: the built-in name stands, and so does the order.
  for (const c of found) if (c.id && namesSomething(c.title)) out.set(c.id, { ...out.get(c.id), ...c });
  return [...out.values()];
}
