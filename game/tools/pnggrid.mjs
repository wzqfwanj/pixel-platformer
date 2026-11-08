// 检测像素块大小：如果原图是"每个像素放大 N 倍"的伪像素画，
// 相邻同色游程长度会是 N 的倍数。按 N 采样即可无损还原原生像素。
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

function decode(file) {
  const buf = readFileSync(file);
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; }
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
  const key = (x, y) => { const i = (y * w + x) * 4; return `${data[i]},${data[i + 1]},${data[i + 2]}`; };

  // 横向游程长度分布
  const runHist = {};
  for (let y = 0; y < h; y += 3) {
    let run = 1;
    for (let x = 1; x < w; x++) {
      if (key(x, y) === key(x - 1, y)) run++;
      else { runHist[run] = (runHist[run] ?? 0) + 1; run = 1; }
    }
  }
  const total = Object.values(runHist).reduce((a, b) => a + b, 0);
  const top = Object.entries(runHist)
    .map(([k, v]) => [Number(k), v])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  console.log(`\n=== ${file} ${w}x${h} ===`);
  console.log("游程长度 TOP12:", top.map(([len, n]) => `${len}px×${n}(${(n / total * 100).toFixed(0)}%)`).join("  "));

  // 检验 N = 1..8：如果 N 正确，色块边界都应落在 N 的倍数上
  for (let N = 1; N <= 8; N++) {
    let sameInBlock = 0, totalCheck = 0;
    for (let y = 0; y < Math.min(h, 400); y += 7) {
      for (let x = 0; x + N < w; x++) {
        // 同一个 N 块内部应当同色
        if ((x % N) !== 0) continue;
        totalCheck++;
        if (key(x, y) === key(x + N - 1, y)) sameInBlock++;
      }
    }
    const ratio = sameInBlock / Math.max(1, totalCheck);
    if (ratio > 0.9) console.log(`  假设块大小 ${N}：块内同色率 ${(ratio * 100).toFixed(1)}%  <== 很可能就是它`);
  }
}
