// 检查两张图的"角色比例"是否一致（头顶到肩膀的宽度），决定攻击帧要不要单独缩放
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

const isBg = (r, g, b) => Math.min(r, g, b) > 230 && Math.max(r, g, b) - Math.min(r, g, b) < 16;

function segs(img) {
  const { w, h, data } = img;
  const colHas = new Array(w).fill(false);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (!isBg(data[i], data[i + 1], data[i + 2])) colHas[x] = true;
  }
  const out = [];
  let st = -1;
  for (let i = 0; i < w; i++) {
    if (colHas[i] && st < 0) st = i;
    else if (!colHas[i] && st >= 0) { out.push([st, i - 1]); st = -1; }
  }
  if (st >= 0) out.push([st, w - 1]);
  return out;
}

function headWidth(img, x0, x1, y0, y1) {
  // 头顶往下 12% 的高度范围内，量最宽处
  const bandH = Math.max(2, Math.round((y1 - y0 + 1) * 0.12));
  let maxW = 0, headTop = -1;
  for (let y = y0; y < y0 + bandH; y++) {
    let first = -1, last = -1;
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.w + x) * 4;
      if (!isBg(img.data[i], img.data[i + 1], img.data[i + 2])) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first >= 0) { if (headTop < 0) headTop = y; maxW = Math.max(maxW, last - first + 1); }
  }
  return { maxW, headTop };
}

for (const file of ["art/walk.png", "art/attack.png"]) {
  const img = decode(file);
  console.log(`\n=== ${file} ${img.w}x${img.h} ===`);
  for (const [x0, x1] of segs(img)) {
    let y0 = img.h, y1 = -1;
    for (let y = 0; y < img.h; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * img.w + x) * 4;
        if (!isBg(img.data[i], img.data[i + 1], img.data[i + 2])) { if (y < y0) y0 = y; if (y > y1) y1 = y; break; }
      }
    const hw = headWidth(img, x0, x1, y0, y1);
    const bh = y1 - y0 + 1, bw = x1 - x0 + 1;
    console.log(`  x ${x0}..${x1} 高 ${bh} 宽 ${bw} | 头部宽 ${hw.maxW}  身高/头宽 = ${(bh / hw.maxW).toFixed(2)}`);
  }
}
