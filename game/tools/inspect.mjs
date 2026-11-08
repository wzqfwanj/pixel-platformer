// 放大看 preview.png 的局部：node game/tools/inspect.mjs <x> <y> <w> <h>
// 用字符表示颜色（R 红 / y 黄 / G 绿 / B 蓝 / W 白 / w 灰 / k 暗），方便检查精灵画得对不对。

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const [x0, y0, w, h] = process.argv.slice(2).map(Number);

function decodePNG(buf) {
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;
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

const png = decodePNG(readFileSync(join(HERE, "..", "preview.png")));
const ch = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 20) return " ";          // 近黑：空
  const sat = (mx - mn) / mx;
  if (sat < 0.16) return mx > 200 ? "W" : mx > 130 ? "w" : mx > 70 ? "m" : "k";
  if (r >= g && r >= b) return g > r * 0.7 ? "y" : b > r * 0.55 ? "p" : "R";
  if (g >= r && g >= b) return "G";
  return b > r * 1.25 ? "B" : "C";
};
const { w: pngW, data } = png;
console.log(`区域 (${x0},${y0}) ${w}x${h}  R红 y黄 G绿 B蓝 C青 p紫 W白 w浅灰 m灰 k暗`);
for (let y = y0; y < y0 + h; y++) {
  let line = "";
  for (let x = x0; x < x0 + w; x++) {
    const i = (y * pngW + x) * 4;
    line += ch(data[i], data[i + 1], data[i + 2]);
  }
  console.log(String(y).padStart(3) + "|" + line + "|");
}
