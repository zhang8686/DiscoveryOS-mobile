// Thin line ("简笔画") icons for the app, drawn on a Canvas in the theme's
// muted color. One weight, one corner radius and one visual language everywhere,
// so the channel list and the personal section read as a single set.
import { Canvas } from "nsh";
import { palette } from "./appearance";

export type IconName =
  | "star" | "doc" | "bubble" | "mail" | "clock"
  | "tag" | "telescope" | "pencil" | "geek" | "phone" | "apple" | "robot"
  | "palm" | "windows" | "headphones" | "thought" | "bowl" | "lipstick"
  | "chat" | "list" | "grip" | "image" | "paperclip" | "chevronUp" | "chevronDown"
  | "chevronLeft" | "chevronRight";

type Ctx = {
  m: (x: number, y: number) => void;
  l: (x: number, y: number) => void;
  q: (a: number, b: number, x: number, y: number) => void;
  circle: (x: number, y: number, r: number) => void;
  stroke: () => void;
  fill: () => void;
};

function makeCtx(cx: any, s: number): Ctx {
  const m = (x: number, y: number) => { cx.beginPath(); cx.moveTo(x * s, y * s); };
  const l = (x: number, y: number) => cx.lineTo(x * s, y * s);
  const q = (a: number, b: number, x: number, y: number) => cx.quadraticCurveTo(a * s, b * s, x * s, y * s);
  const circle = (x: number, y: number, r: number) => {
    const k = 0.4142, d = r * 0.7071;
    m(x + r, y);
    q(x + r, y + k * r, x + d, y + d);
    q(x + k * r, y + r, x, y + r);
    q(x - k * r, y + r, x - d, y + d);
    q(x - r, y + k * r, x - r, y);
    q(x - r, y - k * r, x - d, y - d);
    q(x - k * r, y - r, x, y - r);
    q(x + k * r, y - r, x + d, y - d);
    q(x + r, y - k * r, x + r, y);
    cx.closePath();
  };
  return {
    m, l, q, circle,
    stroke: () => cx.stroke(),
    fill: () => cx.fill(),
  };
}

type Shape = (c: Ctx, cx: any, s: number, filled: boolean) => void;

const SHAPES: Record<IconName, Shape> = {
  // 收藏：五角星
  star: (c, cx, s, filled) => {
    cx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.46 : 0.19;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = 0.5 + r * Math.cos(a), y = 0.5 + r * Math.sin(a);
      if (i === 0) cx.moveTo(x * s, y * s); else cx.lineTo(x * s, y * s);
    }
    cx.closePath();
    if (filled) c.fill(); else c.stroke();
  },
  // 我的主题：一张带折角和文字行的纸（见下方 SHAPES.doc 的完整绘制）
  doc: (c) => {
    c.m(0.2, 0.5); c.l(0.8, 0.5); c.stroke();
  },
  // 我的回复：对话气泡
  bubble: (c) => {
    c.m(0.28, 0.16); c.l(0.74, 0.16); c.q(0.88, 0.16, 0.88, 0.3);
    c.l(0.88, 0.62); c.q(0.88, 0.74, 0.74, 0.74); c.l(0.42, 0.74);
    c.l(0.24, 0.9); c.l(0.27, 0.74); c.l(0.28, 0.74);
    c.q(0.12, 0.74, 0.12, 0.62); c.l(0.12, 0.3);
    c.q(0.12, 0.16, 0.28, 0.16); c.stroke();
  },
  // 私信：信封
  mail: (c) => {
    c.m(0.1, 0.24); c.l(0.9, 0.24); c.l(0.9, 0.78); c.l(0.1, 0.78);
    c.l(0.1, 0.24); c.stroke();
    c.m(0.1, 0.26); c.l(0.5, 0.56); c.l(0.9, 0.26); c.stroke();
  },
  // 历史：时钟
  clock: (c) => {
    c.circle(0.5, 0.5, 0.38); c.stroke();
    c.m(0.5, 0.25); c.l(0.5, 0.52); c.l(0.69, 0.62); c.stroke();
  },
  // 交易：价签
  tag: (c) => {
    c.m(0.14, 0.5); c.l(0.5, 0.14); c.l(0.88, 0.14); c.l(0.88, 0.52);
    c.l(0.52, 0.88); c.l(0.14, 0.5); c.stroke();
    c.circle(0.7, 0.32, 0.06); c.stroke();
  },
  // Discovery：望远镜
  telescope: (c) => {
    c.m(0.14, 0.62); c.l(0.72, 0.28); c.l(0.85, 0.45); c.l(0.28, 0.8);
    c.l(0.14, 0.62); c.stroke();
    c.m(0.44, 0.5); c.l(0.5, 0.88); c.stroke();
    c.m(0.44, 0.5); c.l(0.68, 0.88); c.stroke();
    c.m(0.72, 0.28); c.l(0.82, 0.16); c.stroke();
  },
  // 随笔：铅笔
  pencil: (c) => {
    c.m(0.16, 0.84); c.l(0.22, 0.62); c.l(0.7, 0.14); c.l(0.86, 0.3);
    c.l(0.38, 0.78); c.l(0.16, 0.84); c.stroke();
    c.m(0.62, 0.22); c.l(0.78, 0.38); c.stroke();
  },
  // 奇客怪谈：圆脸 + 眼镜
  geek: (c) => {
    c.circle(0.5, 0.5, 0.38); c.stroke();
    c.circle(0.36, 0.44, 0.1); c.stroke();
    c.circle(0.64, 0.44, 0.1); c.stroke();
    c.m(0.46, 0.44); c.l(0.54, 0.44); c.stroke();
    c.m(0.36, 0.68); c.q(0.5, 0.78, 0.64, 0.68); c.stroke();
  },
  // 手机
  phone: (c) => {
    c.m(0.3, 0.1); c.l(0.7, 0.1); c.q(0.76, 0.1, 0.76, 0.17);
    c.l(0.76, 0.83); c.q(0.76, 0.9, 0.7, 0.9); c.l(0.3, 0.9);
    c.q(0.24, 0.9, 0.24, 0.83); c.l(0.24, 0.17);
    c.q(0.24, 0.1, 0.3, 0.1); c.stroke();
    c.m(0.42, 0.19); c.l(0.58, 0.19); c.stroke();
    c.circle(0.5, 0.81, 0.035); c.stroke();
  },
  // 苹果
  apple: (c) => {
    c.m(0.5, 0.3);
    c.q(0.34, 0.2, 0.22, 0.38); c.q(0.12, 0.62, 0.28, 0.82);
    c.q(0.4, 0.94, 0.5, 0.84); c.q(0.6, 0.94, 0.72, 0.82);
    c.q(0.88, 0.62, 0.78, 0.38); c.q(0.66, 0.2, 0.5, 0.3); c.stroke();
    c.m(0.5, 0.3); c.l(0.52, 0.14); c.stroke();
    c.m(0.52, 0.2); c.q(0.66, 0.1, 0.72, 0.2); c.q(0.62, 0.28, 0.52, 0.2); c.stroke();
  },
  // 机器人
  robot: (c) => {
    c.m(0.24, 0.34); c.l(0.76, 0.34); c.q(0.86, 0.34, 0.86, 0.44);
    c.l(0.86, 0.72); c.q(0.86, 0.82, 0.76, 0.82); c.l(0.24, 0.82);
    c.q(0.14, 0.82, 0.14, 0.72); c.l(0.14, 0.44);
    c.q(0.14, 0.34, 0.24, 0.34); c.stroke();
    c.m(0.5, 0.34); c.l(0.5, 0.2); c.stroke();
    c.circle(0.5, 0.17, 0.045); c.stroke();
    c.circle(0.35, 0.55, 0.05); c.stroke();
    c.circle(0.65, 0.55, 0.05); c.stroke();
    c.m(0.36, 0.7); c.l(0.64, 0.7); c.stroke();
  },
  // 手掌
  palm: (c) => {
    c.m(0.24, 0.86); c.q(0.14, 0.66, 0.2, 0.5);
    c.q(0.23, 0.4, 0.29, 0.42); c.l(0.29, 0.26);
    c.q(0.29, 0.18, 0.36, 0.18); c.q(0.43, 0.18, 0.43, 0.26);
    c.l(0.43, 0.34); c.l(0.47, 0.2); c.q(0.47, 0.12, 0.54, 0.12);
    c.q(0.61, 0.12, 0.61, 0.2); c.l(0.61, 0.36); c.l(0.66, 0.24);
    c.q(0.66, 0.16, 0.73, 0.16); c.q(0.8, 0.16, 0.8, 0.24);
    c.l(0.8, 0.58); c.q(0.8, 0.78, 0.62, 0.88); c.l(0.24, 0.86); c.stroke();
  },
  // 窗格
  windows: (c) => {
    c.m(0.14, 0.16); c.l(0.86, 0.16); c.l(0.86, 0.84); c.l(0.14, 0.84);
    c.l(0.14, 0.16); c.stroke();
    c.m(0.5, 0.16); c.l(0.5, 0.84); c.stroke();
    c.m(0.14, 0.5); c.l(0.86, 0.5); c.stroke();
  },
  // 耳机
  headphones: (c) => {
    c.m(0.16, 0.58); c.l(0.16, 0.46); c.q(0.16, 0.14, 0.5, 0.14);
    c.q(0.84, 0.14, 0.84, 0.46); c.l(0.84, 0.58); c.stroke();
    c.m(0.16, 0.54); c.l(0.28, 0.54); c.l(0.28, 0.78);
    c.q(0.28, 0.86, 0.2, 0.86); c.l(0.16, 0.86); c.stroke();
    c.m(0.84, 0.54); c.l(0.72, 0.54); c.l(0.72, 0.78);
    c.q(0.72, 0.86, 0.8, 0.86); c.l(0.84, 0.86); c.stroke();
  },
  // 思绪云
  thought: (c) => {
    c.m(0.24, 0.68); c.q(0.1, 0.6, 0.16, 0.46);
    c.q(0.2, 0.32, 0.36, 0.34); c.q(0.44, 0.14, 0.62, 0.26);
    c.q(0.84, 0.28, 0.84, 0.48); c.q(0.9, 0.66, 0.72, 0.7);
    c.l(0.24, 0.68); c.stroke();
    c.circle(0.3, 0.84, 0.045); c.stroke();
    c.circle(0.44, 0.9, 0.03); c.stroke();
  },
  // 碗与筷
  bowl: (c) => {
    c.m(0.12, 0.5); c.q(0.5, 1.02, 0.88, 0.5); c.stroke();
    c.m(0.1, 0.5); c.l(0.9, 0.5); c.stroke();
    c.m(0.36, 0.44); c.l(0.72, 0.1); c.stroke();
    c.m(0.48, 0.44); c.l(0.82, 0.14); c.stroke();
  },
  // 口红
  lipstick: (c) => {
    c.m(0.32, 0.42); c.l(0.68, 0.42); c.l(0.68, 0.88); c.l(0.32, 0.88);
    c.l(0.32, 0.42); c.stroke();
    c.m(0.36, 0.42); c.l(0.36, 0.26); c.l(0.56, 0.12); c.l(0.68, 0.22);
    c.l(0.68, 0.42); c.stroke();
  },
  // 默认板块：气泡
  chat: (c) => {
    c.m(0.24, 0.2); c.l(0.76, 0.2); c.q(0.88, 0.2, 0.88, 0.32);
    c.l(0.88, 0.64); c.q(0.88, 0.76, 0.76, 0.76); c.l(0.38, 0.76);
    c.l(0.2, 0.9); c.l(0.23, 0.76); c.l(0.24, 0.76);
    c.q(0.12, 0.76, 0.12, 0.64); c.l(0.12, 0.32);
    c.q(0.12, 0.2, 0.24, 0.2); c.stroke();
    c.m(0.3, 0.42); c.l(0.7, 0.42); c.stroke();
    c.m(0.3, 0.57); c.l(0.58, 0.57); c.stroke();
  },
  // 全部版块：列表
  list: (c) => {
    for (const y of [0.26, 0.5, 0.74]) {
      c.circle(0.2, y, 0.045); c.stroke();
      c.m(0.36, y); c.l(0.86, y); c.stroke();
    }
  },
  // 图片：方框 + 太阳 + 山
  image: (c) => {
    c.m(0.12, 0.18); c.l(0.88, 0.18); c.l(0.88, 0.82); c.l(0.12, 0.82); c.l(0.12, 0.18); c.stroke();
    c.circle(0.68, 0.36, 0.07); c.stroke();
    c.m(0.14, 0.72); c.l(0.38, 0.46); c.l(0.54, 0.64); c.l(0.68, 0.52); c.l(0.86, 0.72); c.stroke();
  },
  // 附件：回形针
  paperclip: (c) => {
    c.m(0.38, 0.3); c.l(0.38, 0.7);
    c.q(0.38, 0.86, 0.54, 0.86); c.q(0.7, 0.86, 0.7, 0.7);
    c.l(0.7, 0.3); c.q(0.7, 0.14, 0.54, 0.14); c.q(0.42, 0.14, 0.42, 0.26);
    c.l(0.42, 0.68); c.q(0.42, 0.76, 0.5, 0.76); c.q(0.58, 0.76, 0.58, 0.68);
    c.l(0.58, 0.32); c.stroke();
  },
  // 拖动排序手柄：三道横线
  grip: (c) => {
    for (const y of [0.28, 0.5, 0.72]) {
      c.m(0.24, y); c.l(0.76, y); c.stroke();
    }
  },
  chevronUp: (c) => { c.m(0.24, 0.6); c.l(0.5, 0.34); c.l(0.76, 0.6); c.stroke(); },
  chevronDown: (c) => { c.m(0.24, 0.4); c.l(0.5, 0.66); c.l(0.76, 0.4); c.stroke(); },
  chevronLeft: (c) => { c.m(0.6, 0.24); c.l(0.34, 0.5); c.l(0.6, 0.76); c.stroke(); },
  chevronRight: (c) => { c.m(0.4, 0.24); c.l(0.66, 0.5); c.l(0.4, 0.76); c.stroke(); },
};

// The document shape needs its own beginPath sequence, so it is defined last to
// overwrite the placeholder above.
SHAPES.doc = (c) => {
  c.m(0.2, 0.08); c.l(0.66, 0.08); c.l(0.86, 0.28); c.l(0.86, 0.9);
  c.l(0.2, 0.9); c.l(0.2, 0.08); c.stroke();
  c.m(0.66, 0.08); c.l(0.66, 0.28); c.l(0.86, 0.28); c.stroke();
  c.m(0.34, 0.46); c.l(0.72, 0.46); c.stroke();
  c.m(0.34, 0.6); c.l(0.72, 0.6); c.stroke();
  c.m(0.34, 0.74); c.l(0.58, 0.74); c.stroke();
};

/** A thin line icon, sized in dp and drawn in the current theme's muted color. */
export function LineIcon(props: { name: IconName; size?: number; color?: string; filled?: boolean }) {
  const size = props.size ?? 20;
  return (
    <Canvas
      style={{ width: size, height: size }}
      draw={(cx: any, box: any) => {
        const s = box?.width || size;
        const color = props.color ?? palette().muted;
        cx.strokeStyle = color;
        cx.fillStyle = color;
        cx.lineWidth = Math.max(1.25, s / 15);
        cx.lineJoin = "round";
        cx.lineCap = "round";
        const draw = SHAPES[props.name] ?? SHAPES.chat;
        draw(makeCtx(cx, s), cx, s, !!props.filled);
      }}
    />
  );
}
