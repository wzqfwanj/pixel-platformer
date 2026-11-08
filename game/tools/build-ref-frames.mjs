// 把参考图的 4 个姿势转成游戏用的动画帧。
//
// 难点不是缩放，是对齐：
//   - 参考图里每个角色都有大片向左飘的披风/长袍，如果按"整体墨迹中心"对齐，
//     披风宽一点的角色就会被推偏，动画一播就左右晃。
//   - 所以水平对齐用【头部中心】（头顶 8% 高度处最窄的那一段，代表身体轴线），
//     垂直用【脚底】对齐。
//
// 输出：entities/refFrames.js（4 帧的像素数据）+ preview-ref-frames.png（放大预览）

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { loadPNG } from "./pngread.mjs";

const img = loadPNG("ref/character-ref.png");

const GROUPS = [
  { x0: 132, x1: 553, y0: 14, y1: 675 },
  { x0: 711, x1: 1135, y0: 13, y1: 674 },
  { x0: 1289, x1: 1724, y0: 14, y1: 674 },
  { x0: 1874, x1: 2243, y0: 14, y1: 674 },
];

const isInk = (x, y) => {
  const [r, g, b, a] = img.px(x, y);
  return a > 20 && (r + g + b) / 3 < 200;
};

const TARGET_H = Number(process.argv[2] ?? 34);   // 目标高度（像素）

// ---- 1. 每帧的墨迹外接框 + 头部中心（身体轴线）
const info = GROUPS.map((g) => {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let y = g.y0; y <= g.y1; y++)
    for (let x = g.x0; x <= g.x1; x++)
      if (isInk(x, y)) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }

  // 头部：顶部 10% 高度内，找墨迹的水平中心
  const headBandY0 = minY;
  const headBandY1 = minY + Math.floor((maxY - minY) * 0.10);
  let hMinX = 1e9, hMaxX = -1e9;
  for (let y = headBandY0; y <= headBandY1; y++)
    for (let x = minX; x <= maxX; x++)
      if (isInk(x, y)) { if (x < hMinX) hMinX = x; if (x > hMaxX) hMaxX = x; }
  const axisX = hMinX < 1e9 ? (hMinX + hMaxX) / 2 : (minX + maxX) / 2;

  return {
    minX, maxX, minY, maxY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    axisX,                     // 身体轴线（水平对齐基准）
    footY: maxY,               // 脚底（垂直对齐基准）
  };
});

console.log("每帧的关键基准：");
info.forEach((f, i) => {
  console.log(`  帧${i + 1}: ${f.w}x${f.h}  轴线 x=${f.axisX.toFixed(0)}  脚底 y=${f.footY}  轴线偏移=${(f.axisX - f.minX).toFixed(0)}px（从左边）`);
});

// ---- 2. 计算统一画布
// 水平：轴线两侧各留最大距离
let leftMax = 0, rightMax = 0;
for (let i = 0; i < 4; i++) {
  const f = info[i];
  leftMax = Math.max(leftMax, f.axisX - f.minX);
  rightMax = Math.max(rightMax, f.maxX - f.axisX);
}
const scale = TARGET_H / Math.max(...info.map((f) => f.h));
const SW = Math.ceil((leftMax + rightMax) * scale) + 2;
const SH = TARGET_H;

console.log(`\n缩放系数 ${scale.toFixed(4)}  统一画布 ${SW}x${SH}  轴线在 x=${Math.round(leftMax * scale) + 1}`);

// ---- 3. 逐帧降采样（面积平均墨量 → 4 档灰度）
const AXIS_IN_SPRITE = Math.round(leftMax * scale) + 1;

function sampleFrame(fi) {
  const f = info[fi];
  const grid = new Float64Array(SW * SH);
  for (let ty = 0; ty < SH; ty++) {
    for (let tx = 0; tx < SW; tx++) {
      // 目标像素 -> 源图坐标范围
      const sxC = f.axisX + (tx - AXIS_IN_SPRITE) / scale;
      const syC = f.footY - (SH - ty) / scale;
      const sx0 = Math.floor(sxC - 0.5 / scale), sx1 = Math.ceil(sxC + 0.5 / scale);
      const sy0 = Math.floor(syC - 0.5 / scale), sy1 = Math.ceil(syC + 0.5 / scale);
      let ink = 0, tot = 0;
      for (let y = sy0; y < Math.max(sy0 + 1, sy1); y++)
        for (let x = sx0; x < Math.max(sx0 + 1, sx1); x++) {
          tot++;
          if (isInk(x, y)) ink++;
        }
      grid[ty * SW + tx] = tot ? ink / tot : 0;
    }
  }
  // 量化
  const rows = [];
  for (let ty = 0; ty < SH; ty++) {
    let row = "";
    for (let tx = 0; tx < SW; tx++) {
      const v = grid[ty * SW + tx];
      row += v >= 0.55 ? "#" : v >= 0.28 ? "+" : v >= 0.10 ? "-" : ".";
    }
    rows.push(row);
  }
  return rows;
}

const frames = [0, 1, 2, 3].map(sampleFrame);

frames.forEach((rows, i) => {
  console.log(`\n---- 帧 ${i + 1} ----`);
  for (const r of rows) console.log("  " + r);
});

// ---- 4. 写 JS
const js = `// 由 game/tools/build-ref-frames.mjs 从 ref/character-ref.png 自动生成，勿手改。
//
// 参考图里有 4 个姿势，按"头部轴线水平对齐 + 脚底垂直对齐"重采样到 ${SW}x${SH}。
// 字符：# 实心  + 深灰  - 浅灰  . 透明
//
// 注意：这 4 帧的下半身（披风/双腿）几乎一致，差异主要在手臂；
// 角色 4 的整体比例与之不同。具体每帧对应什么动作，需按实际效果确认。

export const REF_W = ${SW};
export const REF_H = ${SH};
export const REF_AXIS_X = ${AXIS_IN_SPRITE};   // 身体轴线在精灵内的 x（用于水平对齐）

export const REF_FRAMES = [
${frames.map((rows, i) => `  // 帧 ${i + 1}\n  [\n${rows.map((r) => `    "${r}",`).join("\n")}\n  ],`).join("\n")}
];

export const REF_PALETTE = {
  "#": "#141021",
  "+": "#3b3552",
  "-": "#6e688a",
};
`;
writeFileSync("entities/refFrames.js", js);
console.log(`\n已写出 entities/refFrames.js（4 帧 ${SW}x${SH}）`);

// ---- 5. 预览图：4 帧并排 + 轴线标注
const K = 7, GAP = 10;
const TW = (SW * 4 + 3) * K + GAP * 5;
const TH = SH * K + GAP * 2;
const buf = new Uint8Array(TW * TH * 4);
for (let i = 0; i < TW * TH; i++) { buf[i * 4] = 24; buf[i * 4 + 1] = 22; buf[i * 4 + 2] = 34; buf[i * 4 + 3] = 255; }

const COL = { "#": [20, 16, 33], "+": [59, 53, 82], "-": [110, 104, 138] };
frames.forEach((rows, fi) => {
  const ox = GAP + fi * (SW * K + GAP);
  for (let y = 0; y < SH; y++)
    for (let x = 0; x < SW; x++) {
      const ch = rows[y][x];
      if (ch === ".") continue;
      const c = COL[ch];
      for (let ky = 0; ky < K; ky++)
        for (let kx = 0; kx < K; kx++) {
          const px = ox + x * K + kx, py = GAP + y * K + ky;
          const o = (py * TW + px) * 4;
          buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
        }
    }
  // 轴线（红色竖线）
  const ax = ox + AXIS_IN_SPRITE * K + Math.floor(K / 2);
  for (let y = 0; y < TH; y++) {
    const o = (y * TW + ax) * 4;
    buf[o] = 200; buf[o + 1] = 60; buf[o + 2] = 60;
  }
});

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, "ascii"), data]), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePNG(w, h, d) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(d.buffer, d.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
writeFileSync("preview-ref-frames.png", encodePNG(TW, TH, buf));
console.log(`已写出 preview-ref-frames.png（${TW}x${TH}，4 帧并排，红线 = 身体轴线）`);
