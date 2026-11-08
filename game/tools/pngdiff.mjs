// 比较 4 个姿势之间差多少 —— 决定能不能当行走/攻击动画用
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

const isBg = (r, g, b) => Math.min(r, g, b) > 232 && Math.max(r, g, b) - Math.min(r, g, b) < 14;

function segments(img) {
  const { w, h, data } = img;
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
  return segs;
}

function bbox(img, x0, x1) {
  let y0 = img.h, y1 = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.w + x) * 4;
      if (!isBg(img.data[i], img.data[i + 1], img.data[i + 2])) {
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        break;
      }
    }
  return [y0, y1];
}

for (const file of ["art/walk.png", "art/attack.png"]) {
  const img = decode(file);
  const segs = segments(img);
  console.log(`\n=== ${file} ===  共 ${segs.length} 段`);

  const boxes = segs.map(([x0, x1]) => {
    const [y0, y1] = bbox(img, x0, x1);
    return { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  });
  boxes.forEach((b, i) => console.log(`  姿势 ${i + 1}: ${b.w}x${b.h}  (x ${b.x0}..${b.x1}, y ${b.y0}..${b.y1})`));

  // 两两比较：把每个姿势缩放到统一 40px 高后逐像素比差异
  const H = 40;
  const smalls = boxes.map((b) => {
    const sw = b.w, sh = b.h;
    const dw = Math.max(1, Math.round(sw * H / sh));
    const out = new Uint8Array(dw * H * 4);
    for (let dy = 0; dy < H; dy++) for (let dx = 0; dx < dw; dx++) {
      const sx0 = b.x0 + Math.floor((dx / dw) * sw), sx1 = b.x0 + Math.floor(((dx + 1) / dw) * sw);
      const sy0 = b.y0 + Math.floor((dy / H) * sh), sy1 = b.y0 + Math.floor(((dy + 1) / H) * sh);
      let r = 0, g = 0, bl = 0, n = 0, bg = 0, tot = 0;
      for (let sy = sy0; sy < Math.max(sy0 + 1, sy1); sy++) for (let sx = sx0; sx < Math.max(sx0 + 1, sx1); sx++) {
        if (sx > b.x1 || sy > b.y1) continue;
        tot++;
        const i = (sy * img.w + sx) * 4;
        const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
        if (isBg(R, G, B)) { bg++; continue; }
        r += R; g += G; bl += B; n++;
      }
      const o = (dy * dw + dx) * 4;
      if (n === 0 || bg / Math.max(1, tot) > 0.55) { out[o + 3] = 0; continue; }
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(bl / n); out[o + 3] = 255;
    }
    return { w: dw, h: H, data: out };
  });

  console.log("  两两差异（不透明区域内颜色差 > 40 的像素占比）：");
  for (let i = 0; i < smalls.length; i++) {
    for (let j = i + 1; j < smalls.length; j++) {
      const a = smalls[i], b2 = smalls[j];
      const w = Math.min(a.w, b2.w), hh = Math.min(a.h, b2.h);
      let diff = 0, solid = 0;
      for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
        const ia = (y * a.w + x) * 4, ib = (y * b2.w + x) * 4;
        const aa = a.data[ia + 3], ba = b2.data[ib + 3];
        if (aa < 128 && ba < 128) continue;
        solid++;
        if ((aa < 128) !== (ba < 128)) { diff++; continue; }
        const d = Math.abs(a.data[ia] - b2.data[ib]) + Math.abs(a.data[ia + 1] - b2.data[ib + 1]) + Math.abs(a.data[ia + 2] - b2.data[ib + 2]);
        if (d > 40) diff++;
      }
      console.log(`    ${i + 1} vs ${j + 1}: ${(diff / Math.max(1, solid) * 100).toFixed(1)}%`);
    }
  }
}
