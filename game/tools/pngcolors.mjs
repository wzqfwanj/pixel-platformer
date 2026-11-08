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

for (const file of ["art/walk.png", "art/attack.png"]) {
  const { w, h, data } = decode(file);
  const colors = new Map();
  for (let i = 0; i < w * h; i++) {
    const k = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    colors.set(k, (colors.get(k) ?? 0) + 1);
  }
  const sorted = [...colors.entries()].sort((a, b) => b[1] - a[1]);
  const total = w * h;
  const cover = (n) => sorted.slice(0, n).reduce((a, [, c]) => a + c, 0) / total;
  console.log(`\n=== ${file} ===`);
  console.log(`独立颜色数: ${colors.size}`);
  console.log(`前 8 色覆盖 ${(cover(8) * 100).toFixed(1)}%，前 16 色 ${(cover(16) * 100).toFixed(1)}%，前 32 色 ${(cover(32) * 100).toFixed(1)}%，前 64 色 ${(cover(64) * 100).toFixed(1)}%`);
  console.log("最多的 8 种颜色:", sorted.slice(0, 8).map(([k, c]) => {
    const r = (k >> 16) & 255, g = (k >> 8) & 255, b = k & 255;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}(${(c / total * 100).toFixed(1)}%)`;
  }).join(" "));
}
