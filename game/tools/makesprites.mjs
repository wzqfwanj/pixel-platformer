// 精灵表转换器：把高清 AI 图转成游戏可用的小尺寸精灵数据。
//
// 处理链：
//   1. 按列切出姿势
//   2. 用【头部宽度】做跨图归一化 —— 两张源图的绘制缩放不同（头宽 113 vs 96），
//      不归一化的话挥砍时角色会突然变小
//   3. 用【头顶宽度中心】作为水平锚点（角色重心）。剑会向一侧伸出很长，
//      用包围盒中心会让角色左右跳
//   4. 区域平均降采样 + 白底键出 + 去白边
//   5. 量化到统一调色板
//   6. 行走帧：源图 4 帧的腿几乎不动（差异 1~3%），不能直接当走路动画。
//      离线合成：找到两腿间的缝隙列，把下半身拆成左右腿，按 4 个相位前后错位 + 身体起伏。
//
// 用法: node game/tools/makesprites.mjs [目标身高]

import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const TARGET_H = Number(process.argv[2] ?? 30);
const OUT_JS = "game/art/heroSprites.js";

function decode(file) {
  const buf = readFileSync(file);
  let p = 8, w = 0, h = 0, ctype = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ctype = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const ch = ctype === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride), o = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[o++];
    for (let x = 0; x < stride; x++) {
      const v = raw[o++], a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let r;
      if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      cur[x] = r & 255;
    }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, j = x * ch;
      out[i] = cur[j]; out[i + 1] = cur[j + 1]; out[i + 2] = cur[j + 2]; out[i + 3] = ch === 4 ? cur[j + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { w, h, data: out };
}

const isBg = (r, g, b) => Math.min(r, g, b) > 230 && Math.max(r, g, b) - Math.min(r, g, b) < 16;

function findSegments(img) {
  const { w, h, data } = img;
  const colHas = new Array(w).fill(false);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!isBg(data[i], data[i + 1], data[i + 2])) colHas[x] = true;
    }
  const ranges = [];
  let st = -1;
  for (let i = 0; i < w; i++) {
    if (colHas[i] && st < 0) st = i;
    else if (!colHas[i] && st >= 0) { ranges.push([st, i - 1]); st = -1; }
  }
  if (st >= 0) ranges.push([st, w - 1]);

  return ranges.map(([x0, x1]) => {
    let y0 = h, y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * w + x) * 4;
        if (!isBg(data[i], data[i + 1], data[i + 2])) { if (y < y0) y0 = y; if (y > y1) y1 = y; break; }
      }
    const bandH = Math.max(2, Math.round((y1 - y0 + 1) * 0.12));
    let headW = 0, headCx = (x0 + x1) / 2;
    for (let y = y0; y < y0 + bandH; y++) {
      let first = -1, last = -1;
      for (let x = x0; x <= x1; x++) {
        const i = (y * w + x) * 4;
        if (!isBg(data[i], data[i + 1], data[i + 2])) { if (first < 0) first = x; last = x; }
      }
      if (first >= 0 && last - first + 1 > headW) { headW = last - first + 1; headCx = (first + last) / 2; }
    }
    return { x0, x1, y0, y1, headW, headCx };
  });
}

function sample(img, box, scale) {
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const dw = Math.max(1, Math.round(bw * scale));
  const dh = Math.max(1, Math.round(bh * scale));
  const out = new Uint8Array(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++)
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = box.x0 + Math.floor((dx / dw) * bw), sx1 = box.x0 + Math.floor(((dx + 1) / dw) * bw);
      const sy0 = box.y0 + Math.floor((dy / dh) * bh), sy1 = box.y0 + Math.floor(((dy + 1) / dh) * bh);
      let r = 0, g = 0, b = 0, n = 0, bg = 0;
      for (let sy = sy0; sy < Math.max(sy0 + 1, sy1); sy++)
        for (let sx = sx0; sx < Math.max(sx0 + 1, sx1); sx++) {
          if (sx > box.x1 || sy > box.y1) continue;
          const i = (sy * img.w + sx) * 4;
          const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
          if (isBg(R, G, B)) { bg++; continue; }
          r += R; g += G; b += B; n++;
        }
      const tot = Math.max(1, (Math.max(sx0 + 1, sx1) - sx0) * (Math.max(sy0 + 1, sy1) - sy0));
      const o = (dy * dw + dx) * 4;
      if (n === 0 || bg / tot > 0.5) continue;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255;
    }
  const solid = (x, y) => x >= 0 && y >= 0 && x < dw && y < dh && out[(y * dw + x) * 4 + 3] > 0;
  const kill = [];
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const o = (y * dw + x) * 4;
      if (!out[o + 3]) continue;
      if (Math.min(out[o], out[o + 1], out[o + 2]) > 198 &&
        (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1))) kill.push(o);
    }
  for (const o of kill) out[o + 3] = 0;
  return { w: dw, h: dh, data: out, anchorX: Math.min(dw - 1, Math.max(0, Math.round((box.headCx - box.x0) * scale))) };
}

// ---------- 行走帧合成 ----------
/**
 * 源图 4 帧的腿几乎一样，直接播会像"滑行"。
 * 这里从站立帧合成行走：找到两腿之间的缝隙，把下半身拆成左右腿，按相位错位。
 */
function synthWalk(stand, phases) {
  const { w, h, data, anchorX } = stand;

  // 下半身：从 65% 高度往下
  const hipY = Math.round(h * 0.62);

  // 找缝隙列：在 hipY..h 之间，统计每列的透明像素数，最多且居中偏左/右的即为缝隙
  let gapX = anchorX;
  let bestScore = -1;
  for (let x = Math.max(1, anchorX - 4); x <= Math.min(w - 2, anchorX + 4); x++) {
    let empty = 0;
    for (let y = hipY; y < h; y++) if (!data[(y * w + x) * 4 + 3]) empty++;
    const score = empty - Math.abs(x - anchorX) * 0.5;
    if (score > bestScore) { bestScore = score; gapX = x; }
  }

  const frames = [];
  for (const { dxL, dxR, bob } of phases) {
    const out = new Uint8Array(w * (h + 2) * 4);
    const W2 = w, H2 = h + 2;
    const put = (x, y, o) => {
      if (x < 0 || y < 0 || x >= W2 || y >= H2) return;
      const to = (y * W2 + x) * 4;
      out[to] = data[o]; out[to + 1] = data[o + 1]; out[to + 2] = data[o + 2]; out[to + 3] = data[o + 3];
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (!data[o + 3]) continue;
        if (y < hipY) { put(x, y + bob, o); continue; }          // 上半身：整体起伏
        const dx = x <= gapX ? dxL : dxR;                          // 下半身：左右腿分开错位
        put(x + dx, y + bob + 2, o);                               // +2 给起伏留空间
      }
    }
    // 裁掉顶部空行
    let top = 0;
    outer: for (; top < H2; top++) {
      for (let x = 0; x < W2; x++) if (out[(top * W2 + x) * 4 + 3]) break outer;
    }
    const ch2 = H2 - top;
    const trimmed = new Uint8Array(W2 * ch2 * 4);
    for (let y = 0; y < ch2; y++)
      for (let x = 0; x < W2; x++) {
        const s2 = ((y + top) * W2 + x) * 4, d2 = (y * W2 + x) * 4;
        trimmed[d2] = out[s2]; trimmed[d2 + 1] = out[s2 + 1]; trimmed[d2 + 2] = out[s2 + 2]; trimmed[d2 + 3] = out[s2 + 3];
      }
    frames.push({ w: W2, h: ch2, data: trimmed, anchorX });
  }
  return { frames, hipY, gapX };
}

// ---------- 载入 ----------
const walkImg = decode("art/walk.png");
const atkImg = decode("art/attack.png");
const walkBoxes = findSegments(walkImg);
const atkBoxes = findSegments(atkImg);

const headWRef = walkBoxes[0].headW;
const atkHeadW = atkBoxes.reduce((a, b) => a + b.headW, 0) / atkBoxes.length;
const atkNorm = headWRef / atkHeadW;

const baseScale = TARGET_H / (walkBoxes[0].y1 - walkBoxes[0].y0 + 1);

const stand = sample(walkImg, walkBoxes[0], baseScale);
const attacks = atkBoxes.map((b) => sample(atkImg, b, baseScale * atkNorm));

// 行走 4 相位：左腿前/中立/右腿前/中立，配合身体起伏
const { frames: walkFrames, hipY, gapX } = synthWalk(stand, [
  { dxL: -1, dxR: 1, bob: 0 },     // 左腿收、右腿伸
  { dxL: 0, dxR: 0, bob: -1 },     // 中立（身体抬起）
  { dxL: 1, dxR: -1, bob: 0 },     // 右腿收、左腿伸
  { dxL: 0, dxR: 0, bob: -1 },     // 中立
]);

// ---------- 调色板 ----------
const all = [stand, ...walkFrames, ...attacks];
const cc = new Map();
for (const f of all)
  for (let i = 0; i < f.w * f.h; i++) {
    if (!f.data[i * 4 + 3]) continue;
    const r = f.data[i * 4] & 0xf8, g = f.data[i * 4 + 1] & 0xf8, b = f.data[i * 4 + 2] & 0xf8;
    const k = (r << 16) | (g << 8) | b;
    cc.set(k, (cc.get(k) ?? 0) + 1);
  }
const palette = [...cc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
if (!palette.some(([r, g, b]) => r < 45 && g < 45 && b < 45)) palette.push([18, 14, 26]);

const nearest = (r, g, b) => {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i];
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
};

// ---------- 输出 ----------
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const emit = (f) => {
  const rows = [];
  for (let y = 0; y < f.h; y++) {
    let line = "";
    for (let x = 0; x < f.w; x++) {
      const o = (y * f.w + x) * 4;
      line += f.data[o + 3] ? DIGITS[nearest(f.data[o], f.data[o + 1], f.data[o + 2])] : ".";
    }
    rows.push(line);
  }
  return rows;
};

const L = [];
L.push("// 自动生成，不要手改（生成脚本：game/tools/makesprites.mjs）");
L.push("// 源图：art/walk.png（站立基准）、art/attack.png（挥砍 4 帧）");
L.push(`// 目标身高 ${TARGET_H}px；攻击帧按头宽归一化 ×${atkNorm.toFixed(3)}`);
L.push(`// 行走帧是从站立帧合成的（源图 4 帧腿部差异仅 1~3%，不构成走路循环）：`);
L.push(`// 在 y>=${hipY} 处按 x<=${gapX} 拆成左右腿，按相位错位 ±1px，身体起伏 1px`);
L.push("// rows：每字符一个调色板索引（36 进制），'.' 透明；anchorX 是脚底中心在帧内的 x");
L.push("");
L.push("export const PALETTE = [");
for (const [r, g, b] of palette) L.push(`  "#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}",`);
L.push("];");
L.push("");
L.push("export const FRAMES = {");
for (const [kind, list] of [["stand", [stand]], ["walk", walkFrames], ["attack", attacks]]) {
  L.push(`  ${kind}: [`);
  for (const f of list) {
    L.push(`    { w: ${f.w}, h: ${f.h}, anchorX: ${f.anchorX}, rows: [`);
    for (const r of emit(f)) L.push(`      "${r}",`);
    L.push("    ] },");
  }
  L.push("  ],");
}
L.push("};");
writeFileSync(OUT_JS, L.join("\n"));

// ---------- 预览 ----------
const cls = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  if (sat < 0.16) return mx > 190 ? "." : mx > 130 ? ":" : mx > 70 ? "-" : "#";
  if (r >= g && r >= b) return g > r * 0.75 ? "y" : b > r * 0.8 ? "p" : "R";
  if (g >= r && g >= b) return "G";
  return b > r * 1.15 ? "B" : "C";
};
const show = (list, label) => {
  const maxH = Math.max(...list.map((f) => f.h));
  console.log(`\n===== ${label}：${list.map((f) => `${f.w}x${f.h}@${f.anchorX}`).join("  ")} =====`);
  for (let y = 0; y < maxH; y++) {
    let line = "";
    for (const f of list) {
      for (let x = 0; x < f.w; x++) {
        if (y >= f.h) { line += " "; continue; }
        const o = (y * f.w + x) * 4;
        line += f.data[o + 3] ? cls(f.data[o], f.data[o + 1], f.data[o + 2]) : " ";
      }
      line += "   ";
    }
    console.log("  " + line);
  }
};

console.log(`目标身高 ${TARGET_H}px，调色板 ${palette.length} 色`);
console.log(`头宽归一化：行走 ${headWRef} / 攻击 ${atkHeadW.toFixed(1)} -> ×${atkNorm.toFixed(3)}`);
console.log(`拆腿位置：hipY=${hipY}, gapX=${gapX}`);
show([stand], "stand");
show(walkFrames, "walk（合成）");
show(attacks, "attack");
console.log(`\n已写出 ${OUT_JS}`);
