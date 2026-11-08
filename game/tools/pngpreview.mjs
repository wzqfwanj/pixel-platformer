// 把每个姿势切出来，分别统计尺寸，并打印 ASCII 预览（看清是什么动作）
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

function decodePNG(buf) {
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

// 颜色分档（为了 ASCII 里能区分材质）
const classify = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx > 235 && mx - mn < 25) return " ";        // 白底
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  if (sat < 0.14) return mx > 180 ? "." : mx > 110 ? ":" : mx > 55 ? "-" : "#";  // 灰阶
  if (r >= g && r >= b) return g > r * 0.72 ? "y" : b > r * 0.75 ? "p" : "R";   // 黄/紫/红
  if (g >= r && g >= b) return "G";
  return b > r * 1.2 ? "B" : "C";                                                // 蓝/青
};

function show(file, label) {
  const img = decodePNG(readFileSync(file));
  const { w, h, data } = img;
  const at = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const isBg = (x, y) => { const [r, g, b] = at(x, y); return r > 235 && g > 235 && b > 235; };

  // 按列找 4 段
  const colHas = new Array(w).fill(false);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!isBg(x, y)) colHas[x] = true;
  const segs = [];
  let start = -1;
  for (let i = 0; i < w; i++) {
    if (colHas[i] && start < 0) start = i;
    else if (!colHas[i] && start >= 0) { segs.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) segs.push([start, w - 1]);

  console.log(`\n########## ${label}  ${w}x${h}  切出 ${segs.length} 个姿势 ##########`);

  segs.forEach(([x0, x1], idx) => {
    // 该段的行范围
    let y0 = h, y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = x0; x <= x1; x++)
        if (!isBg(x, y)) { if (y < y0) y0 = y; if (y > y1) y1 = y; break; }
    const fw = x1 - x0 + 1, fh = y1 - y0 + 1;
    console.log(`\n--- 姿势 ${idx + 1}: x ${x0}..${x1}, y ${y0}..${y1}  (${fw}x${fh}) ---`);

    // 缩到 ~30 宽预览
    const stepX = Math.max(1, Math.floor(fw / 34));
    const stepY = Math.max(1, Math.floor(fh / 26));
    for (let y = y0; y <= y1; y += stepY) {
      let line = "";
      for (let x = x0; x <= x1; x += stepX) {
        const [r, g, b] = at(x, y);
        line += classify(r, g, b);
      }
      console.log("  " + line);
    }
  });
}

show("art/walk.png", "walk");
show("art/attack.png", "attack");
