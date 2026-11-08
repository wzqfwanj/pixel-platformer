// 把高清图转成游戏可用的小尺寸精灵：
//   1. 去掉白底（背景是 ~250+ 的近白色，带噪声，用阈值 + 亮度判断）
//   2. 区域平均降采样（不是最近邻，避免丢细节）
//   3. 按亮度分层量化成有限调色板（像素画风格）
// 并打印 ASCII 预览确认效果。
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

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

const isBg = (r, g, b) => {
  // 白底：三通道都很高且接近
  const mn = Math.min(r, g, b);
  return mn > 232 && Math.max(r, g, b) - mn < 14;
};

// 降采样到目标高度，返回 {w,h,rgba}
function downsample(img, x0, y0, x1, y1, targetH) {
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  const scale = targetH / sh;
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = targetH;
  const out = new Uint8Array(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      // 对应源区域
      const sx0 = x0 + Math.floor((dx / dw) * sw), sx1 = x0 + Math.floor(((dx + 1) / dw) * sw);
      const sy0 = y0 + Math.floor((dy / dh) * sh), sy1 = y0 + Math.floor(((dy + 1) / dh) * sh);
      let r = 0, g = 0, b = 0, n = 0, bgN = 0;
      for (let sy = sy0; sy < Math.max(sy0 + 1, sy1); sy++) {
        for (let sx = sx0; sx < Math.max(sx0 + 1, sx1); sx++) {
          if (sx > x1 || sy > y1) continue;
          const i = (sy * img.w + sx) * 4;
          const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
          if (isBg(R, G, B)) { bgN++; continue; }
          r += R; g += G; b += B; n++;
        }
      }
      const total = Math.max(1, (Math.max(sx0 + 1, sx1) - sx0) * (Math.max(sy0 + 1, sy1) - sy0));
      const o = (dy * dw + dx) * 4;
      if (n === 0 || bgN / total > 0.55) { out[o + 3] = 0; continue; }   // 大部分是背景 -> 透明
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return { w: dw, h: dh, data: out };
}

const classify = (r, g, b, a) => {
  if (a < 128) return " ";
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  if (sat < 0.16) return mx > 190 ? "." : mx > 130 ? ":" : mx > 70 ? "-" : "#";
  if (r >= g && r >= b) return g > r * 0.75 ? "y" : b > r * 0.8 ? "p" : "R";
  if (g >= r && g >= b) return "G";
  return b > r * 1.15 ? "B" : "C";
};

function preview(file, label) {
  const img = decode(file);
  const { w, h, data } = img;

  // 找 4 段的列范围
  const colHas = new Array(w).fill(false);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (!isBg(data[i], data[i + 1], data[i + 2])) colHas[x] = true;
  }
  const segs = [];
  let st = -1;
  for (let i = 0; i < w; i++) {
    if (colHas[i] && st < 0) st = i;
    else if (!colHas[i] && st >= 0) { segs.push([st, i - 1]); st = -1; }
  }
  if (st >= 0) segs.push([st, w - 1]);

  console.log(`\n########## ${label}: ${segs.length} 段 ##########`);
  segs.forEach(([x0, x1], idx) => {
    let y0 = h, y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * w + x) * 4;
        if (!isBg(data[i], data[i + 1], data[i + 2])) { if (y < y0) y0 = y; if (y > y1) y1 = y; break; }
      }
    // 裁到目标高度 40px
    const small = downsample(img, x0, y0, x1, y1, 40);
    console.log(`\n--- ${idx + 1}: 原 ${x1 - x0 + 1}x${y1 - y0 + 1} -> ${small.w}x${small.h} ---`);
    for (let y = 0; y < small.h; y++) {
      let line = "";
      for (let x = 0; x < small.w; x++) {
        const o = (y * small.w + x) * 4;
        line += classify(small.data[o], small.data[o + 1], small.data[o + 2], small.data[o + 3]);
      }
      console.log("  " + line);
    }
  });
}

preview("art/walk.png", "walk");
preview("art/attack.png", "attack");
