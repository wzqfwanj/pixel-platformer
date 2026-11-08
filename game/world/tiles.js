// 图块的像素画：全部用代码画，没有外部图片。烘一次整张关卡，之后每帧只做矩形拷贝。

import { hex } from "../core/util.js";
import { hash2 } from "../core/util.js";

const C = {
  ink: hex("#141021"),
  stone: hex("#414c6b"),
  stoneD: hex("#2b3348"),
  stoneL: hex("#5a6a8f"),
  stoneXL: hex("#8290b5"),
  seam: hex("#1d2233"),
  moss: hex("#6bb058"),
  mossD: hex("#3f7a48"),
  mossL: hex("#9ad46a"),
  dirt: hex("#3a3042"),
  dirtD: hex("#2a2230"),
  metal: hex("#9aa6c4"),
  metalD: hex("#5a6484"),
  wood: hex("#6a4426"),
  woodD: hex("#42291a"),
  woodL: hex("#8f5f34"),
  ember: hex("#ffae35"),
};

/** 一块实心地砖 */
export function drawSolid(s, tx, ty, T, top, above, left, right) {
  const x = tx * T, y = ty * T;
  // 底色 + 一点点噪声，避免大块死板
  for (let j = 0; j < T; j++)
    for (let i = 0; i < T; i++) {
      const n = hash2(tx * T + i, ty * T + j, 7);
      let c = C.stone;
      if (j > T / 2) c = C.stoneD;
      if (n > 0.86) c = C.stoneL;
      if (n < 0.08) c = C.seam;
      s.px(x + i, y + j, c);
    }
  // 砖缝
  const row = Math.floor(y / 8);
  for (let j = 7; j < T; j += 8) s.hline(x, y + j, T, C.seam);
  const off = row % 2 ? 8 : 0;
  for (let j = 0; j < T; j += 8) {
    const seamX = (off + (j === 0 ? 8 : 0)) % T;
    if (seamX > 0) s.vline(x + seamX, y + j, Math.min(8, T - j), C.seam);
  }
  // 顶部：苔藓盖
  if (top) {
    for (let i = 0; i < T; i++) {
      const h = 2 + (hash2(tx * T + i, ty, 3) > 0.5 ? 1 : 0);
      for (let j = 0; j < h; j++) s.px(x + i, y + j, j === 0 ? C.mossL : C.moss);
      s.px(x + i, y + h, C.mossD);
      if (hash2(tx * T + i, ty, 11) > 0.82) s.px(x + i, y - 1, C.mossL); // 冒出来的草
    }
  } else {
    // 下面被压住的部分亮一点，制造层理
    s.hline(x, y, T, C.stoneL);
  }
  // 侧面：和其他砖相邻时压一道暗边，单独暴露时画高光
  if (!left) s.vline(x, y, T, C.seam);
  if (!right) s.vline(x + T - 1, y, T, C.seam);
  if (!above && top) s.hline(x, y, T, C.mossD);
}

/** 浮空石台 */
export function drawPlatform(s, tx, ty, T) {
  const x = tx * T, y = ty * T, h = 6;
  s.rect(x, y, T, h, C.stone);
  s.hline(x, y, T, C.stoneXL);
  s.hline(x, y + 1, T, C.stoneL);
  s.hline(x, y + h - 1, T, C.stoneD);
  for (let i = 0; i < T; i += 4) s.vline(x + i + 1, y + 2, h - 3, C.stoneD);
  // 台面下的阴影
  for (let i = 1; i < T - 1; i++) s.px(x + i, y + h, C.seam);
}

/** 尖刺 */
export function drawSpikes(s, tx, ty, T) {
  const x = tx * T, y = ty * T;
  const baseY = y + T - 1;
  s.rect(x, baseY - 3, T, 4, C.stoneD);
  s.hline(x, baseY - 3, T, C.stone);
  for (let k = 0; k < 3; k++) {
    const cx = x + 2 + k * 5;
    for (let j = 0; j < 10; j++) {
      const w = Math.max(0, Math.floor((10 - j) / 3.2));
      for (let i = -w; i <= w; i++) {
        const px = cx + i, py = baseY - 3 - j;
        if (i < 0) s.px(px, py, C.metal);
        else if (i > 0) s.px(px, py, C.metalD);
        else s.px(px, py, j > 7 ? C.stoneXL : C.metal);
      }
    }
    s.px(cx, baseY - 13, hex("#e8f0ff"));
  }
}

/** 火把的木头支架（火焰由 pixelfx 的 fire/torch 画） */
export function drawTorchMount(s, tx, ty, T) {
  const cx = tx * T + 8;
  const baseY = (ty + 1) * T;
  // 斜插在地上的杆
  for (let j = 0; j < 14; j++) {
    const py = baseY - 1 - j, px = cx - 1 + Math.floor(j / 7);
    s.px(px, py, C.wood);
    s.px(px + 1, py, C.woodD);
    if (j % 5 === 0) s.px(px, py, C.woodL);
  }
  // 顶部缠布的酒盅
  const topY = baseY - 16;
  s.rect(cx - 3, topY, 6, 3, C.woodD);
  s.hline(cx - 3, topY, 6, C.wood);
  s.px(cx - 2, topY + 1, C.ember);
  s.px(cx + 1, topY + 1, C.ember);
}

/** 金币（会转，靠 frame 选宽度） */
const COIN_PAL = {
  g: hex("#ffd94a"), G: hex("#e8a018"), d: hex("#a86408"), w: hex("#fff6c0"), k: hex("#3a2208"),
};
export function coinRows(phase) {
  // 5 帧旋转：宽度 5,4,2,4,5 —— 像一枚立起来的硬币转过去
  const w = [5, 4, 2, 4, 5][phase % 5];
  const rows = [];
  for (let j = 0; j < 8; j++) rows.push(".".repeat(Math.max(0, (5 - w) / 2 | 0)) + "?".repeat(w) + ".".repeat(Math.max(0, 5 - w - ((5 - w) / 2 | 0))));
  return rows.map((r, j) => r.replace(/\?/g, j === 0 || j === 7 ? "k" : j === 1 ? "w" : j === 6 ? "d" : "g"));
}
export const COIN_COLORS = { ...COIN_PAL, "?": COIN_PAL.g };

export const TILE_COLORS = C;
