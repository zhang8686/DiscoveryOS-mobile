// Which thin-line icon each channel shows. The 14 main channels come from the
// forum's own index page (verified signed in); the rest are sub-forums that the
// forum page exposes. Keyword matching keeps renamed channels recognisable.
import type { IconName } from "./lineIcons";

const EXACT = new Map<string, IconName>([
  ["Buy & Sell 交易服务区", "tag"],
  ["Discovery", "telescope"],
  ["随笔与个人文集", "pencil"],
  ["Geek Talks · 奇客怪谈", "geek"],
  ["Smartphone", "phone"],
  ["iPhone, iPod Touch，iPad", "apple"],
  ["Android, Chrome, & Google", "robot"],
  ["PalmOS ，Treo", "palm"],
  ["麦客爱苹果", "apple"],
  ["Windows Mobile，PocketPC，HPC", "windows"],
  ["DC,NB,MP3,Gadgets...", "headphones"],
  ["意欲蔓延", "thought"],
  ["吃喝玩乐", "bowl"],
  ["La Femme", "lipstick"],
  ["Palm芝麻宝典", "phone"],
  ["Joggler", "phone"],
  ["已完成交易", "tag"],
  ["只讨论2.0", "chat"],
  ["俄乌战争", "thought"],
  ["Plain", "chat"],
  ["DC,NB", "headphones"],
  ["时事", "thought"],
]);

const KEYWORDS: [string, IconName][] = [
  ["Buy & Sell", "tag"], ["交易", "tag"],
  ["Discovery", "telescope"],
  ["Geek", "geek"], ["奇客", "geek"],
  ["iPhone", "apple"], ["iPad", "apple"], ["苹果", "apple"],
  ["Android", "robot"], ["Google", "robot"],
  ["Smartphone", "phone"], ["Palm", "palm"], ["Treo", "palm"], ["手机", "phone"],
  ["Windows", "windows"], ["PocketPC", "windows"],
  ["DC,NB", "headphones"], ["MP3", "headphones"], ["Gadgets", "headphones"],
  ["随笔", "pencil"], ["文集", "pencil"],
  ["意欲", "thought"], ["电影", "thought"],
  ["吃喝", "bowl"], ["美食", "bowl"],
  ["Femme", "lipstick"],
];

/** The line icon for a channel, by its title. */
export function channelIcon(title: string): IconName {
  const exact = EXACT.get(title);
  if (exact) return exact;
  for (const [word, icon] of KEYWORDS) if (title.includes(word)) return icon;
  return "chat";
}
