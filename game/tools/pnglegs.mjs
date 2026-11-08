// 只看腿部区域（底部 30%），确认 4 个行走帧到底有没有迈腿
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

const img = decode("art/walk.png");
// 手工用之前算出的 4 段
const boxes = [[131, 554], [710, 1135], [1288, 1724], [1874, 2244]];
const G = 60;  // 缩略格

console.log("每个行走帧的腿部（底部 35%）轮廓，缩到 ~26 列：\n");
const legMaps = [];
for (const [x0, x1] of boxes) {
  let y0 = img.h, y1 = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.w + x) * 4;
      if (!isBg(img.data[i], img.data[i + 1], img.data[i + 2])) { if (y < y0) y0 = y; if (y > y1) y1 = y; break; }
    }
  const bh = y1 - y0 + 1;
  const legY0 = y0 + Math.round(bh * 0.65);
  const rows = 26, cols = 26;
  const bw = x1 - x0 + 1;
  const m = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const sx = x0 + Math.floor((c / cols) * bw);
      const sy = legY0 + Math.floor((r / rows) * (y1 - legY0 + 1));
      const i = (sy * img.w + sx) * 4;
      line += isBg(img.data[i], img.data[i + 1], img.data[i + 2]) ? " " : "#";
    }
    m.push(line);
  }
  legMaps.push(m);
}

for (let r = 0; r < legMaps[0].length; r++) {
  console.log("  " + legMaps.map((m) => m[r]).join("    "));
}

// 腿部区域差异
const diffLegs = (a, b) => {
  let d = 0, n = 0;
  for (let r = 0; r < a.length; r++)
    for (let c = 0; c < a[r].length; c++) { n++; if (a[r][c] !== b[r][c]) d++; }
  return d / n;
};
console.log("\n腿部区域差异：");
for (let i = 0; i < 4; i++)
  for (let j = i + 1; j < 4; j++) console.log(`  ${i + 1} vs ${j + 1}: ${(diffLegs(legMaps[i], legMaps[j]) * 100).toFixed(1)}%`);
