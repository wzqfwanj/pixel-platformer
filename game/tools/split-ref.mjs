// 把参考图里的 4 个角色分别裁出来存成独立 PNG（透明背景），并生成并排对比图。
// 用途：确认这 4 张到底是"4 个姿势"还是别的，同时作为后续切帧的输入。
//
// 用法: node game/tools/split-ref.mjs

import { writeFileSync, mkdirSync } from "node:fs";
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

// ---- PNG 写入
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

mkdirSync("ref/frames", { recursive: true });

// ---- 每个角色裁到实际墨迹边界
const boxes = [];
for (let i = 0; i < GROUPS.length; i++) {
  const g = GROUPS[i];
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let y = g.y0; y <= g.y1; y++)
    for (let x = g.x0; x <= g.x1; x++)
      if (isInk(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  boxes.push({ minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 });
}

console.log("裁切边界（墨迹外接框）：");
boxes.forEach((b, i) => console.log(`  角色${i + 1}: ${b.w}x${b.h}  起点(${b.minX},${b.minY})`));

// 统一画布：宽取最大，高取最大，脚底对齐（底部对齐）
const CW = Math.max(...boxes.map((b) => b.w));
const CH = Math.max(...boxes.map((b) => b.h));
console.log(`\n统一画布 ${CW}x${CH}（脚底对齐）`);

const frames = [];
for (let i = 0; i < boxes.length; i++) {
  const b = boxes[i];
  const buf = new Uint8Array(CW * CH * 4);
  const dx = Math.floor((CW - b.w) / 2);        // 水平居中
  const dy = CH - b.h;                          // 底部对齐
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const [r, g, bl, a] = img.px(b.minX + x, b.minY + y);
      if (a < 20) continue;
      const lum = (r + g + bl) / 3;
      if (lum > 200) continue;               // 白底当作透明
      const o = ((dy + y) * CW + (dx + x)) * 4;
      // 保留灰度
      const v = Math.round(lum);
      buf[o] = v; buf[o + 1] = v; buf[o + 2] = v; buf[o + 3] = 255;
    }
  }
  frames.push(buf);
  const file = `ref/frames/frame${i + 1}.png`;
  writeFileSync(file, encodePNG(CW, CH, buf));
  console.log(`已写出 ${file}`);
}

// ---- 并排对比图（4 帧并排，2 倍放大，带分隔线）
const K = 2;
const GAP = 6;
const TW = CW * 4 * K + GAP * 5;
const TH = CH * K + GAP * 2;
const comp = new Uint8Array(TW * TH * 4);
// 背景：深灰
for (let i = 0; i < TW * TH; i++) {
  comp[i * 4] = 30; comp[i * 4 + 1] = 28; comp[i * 4 + 2] = 42; comp[i * 4 + 3] = 255;
}
for (let fi = 0; fi < 4; fi++) {
  const ox = GAP + fi * (CW * K + GAP);
  const oy = GAP;
  for (let y = 0; y < CH * K; y++) {
    for (let x = 0; x < CW * K; x++) {
      const si = ((y / K) | 0) * CW + ((x / K) | 0);
      const a = frames[fi][si * 4 + 3];
      if (a < 20) continue;
      const oi = ((oy + y) * TW + (ox + x)) * 4;
      comp[oi] = frames[fi][si * 4];
      comp[oi + 1] = frames[fi][si * 4 + 1];
      comp[oi + 2] = frames[fi][si * 4 + 2];
      comp[oi + 3] = 255;
    }
  }
  // 分隔线
  if (fi < 3) {
    const lx = ox + CW * K + Math.floor(GAP / 2);
    for (let y = 0; y < TH; y++) {
      const oi = (y * TW + lx) * 4;
      comp[oi] = 90; comp[oi + 1] = 80; comp[oi + 2] = 120;
    }
  }
}
writeFileSync("preview-frames.png", encodePNG(TW, TH, comp));
console.log(`\n已写出 preview-frames.png（${TW}x${TH}，4 帧并排）`);
