import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export function loadPNG(path) {
  const buf = readFileSync(path);
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  let plte = null, trns = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bpp = Math.ceil((bitDepth * channels) / 8);
  const stride = Math.ceil((w * bitDepth * channels) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[o++];
    const row = raw.subarray(o, o + stride);
    o += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      const v = row[x];
      let r;
      if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      cur[x] = r & 255;
    }
  }
  const px = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return [0, 0, 0, 0];
    const base = y * stride;
    if (colorType === 6) { const i = base + x * 4; return [out[i], out[i + 1], out[i + 2], out[i + 3]]; }
    if (colorType === 2) { const i = base + x * 3; return [out[i], out[i + 1], out[i + 2], 255]; }
    if (colorType === 0) { const v = out[base + x]; return [v, v, v, 255]; }
    if (colorType === 3) { const idx = out[base + x]; const i = idx * 3; return [plte[i], plte[i + 1], plte[i + 2], trns && idx < trns.length ? trns[idx] : 255]; }
    const i = base + x * 2; return [out[i], out[i], out[i], out[i + 1]];
  };
  return { w, h, px };
}
