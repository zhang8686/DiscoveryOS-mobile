// Two small drawings for the empty column: the Flappy T-Rex, square by square, and a pointing
// hand under the button that opens the boards. The green changes with the theme, so the figure
// reads on the light and the dark surface alike.
import { Canvas, colorScheme } from "nsh";
import { palette } from "./appearance";

// 40 columns wide, 40 rows tall: `#` body, `.` empty (the eye is empty, so it shows the surface).
// The last rows carry the ground the dinosaur stands on: two long dashes and the short ones below.
const DINO = [
  "........................................",
  "........................................",
  ".......................##.##............",
  ".......................##.##............",
  ".......................##.##............",
  "......................######.##.........",
  ".....................###########........",
  "....................#############.......",
  "....................###.##########......",
  "....................##############......",
  "....................##############......",
  "....................##############......",
  "....................##############......",
  "....................########............",
  "....................###########.........",
  "....................###########.........",
  ".......##..........#######..............",
  ".......##........#########..............",
  ".......###.....#############............",
  ".......###....###############...........",
  ".......####..#############.##...........",
  ".......###################.#............",
  ".......###################..............",
  ".......###################..............",
  "........##################..............",
  "........#################...............",
  "..........###############...............",
  "...........############.................",
  "............##########..................",
  ".##########..#########..################",
  ".............#####.###..................",
  ".............####...##...............##.",
  "....###......##.....##..................",
  ".............###....###....##...........",
  "###......##..####...###.........####....",
  "........................................",
  "........................................",
  "........................................",
  "........................................",
  "........................................",
];

/**
 * The dinosaur, `size` points square. Small sizes (an avatar) sample two cells at a time: at 32 pt a
 * cell is under a point, so the drawing is the same silhouette for a quarter of the work, which
 * matters when a list has a row without a picture each.
 */
export function PixelDino(props: { size?: number; color?: string }) {
  const size = props.size ?? 120;
  const step = size < 64 ? 2 : 1;
  const px = size / 40;
  return (
    <Canvas
      style={{ width: size, height: size }}
      draw={(cx) => {
        // Grey-black on the light surface, white-grey on the dark one: readable either way.
        const body = props.color ?? (colorScheme() === "dark" ? "#d8dee6" : "#3a3f45");
        cx.fillStyle = body;
        for (let y = 0; y < DINO.length; y += step) {
          const row = DINO[y];
          for (let x = 0; x < row.length; x += step) {
            if (step === 1 ? row[x] !== "#" : !row.slice(x, x + step).includes("#")) continue;
            cx.fillRect(x * px, y * px, px * step, px * step);
          }
        }
      }}
    />
  );
}
