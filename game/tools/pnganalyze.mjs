// 分析精灵图：先看背景是什么，再按列/行切分出独立的帧。
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
  if (depth !== 8) throw new Error("只支持 8 位");
  const ch = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 0 ? 1 : 0;
  if (!ch) throw new Error("不支持的色彩格式 " + ctype);
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
      out[i] = cur[j];
      out[i + 1] = ch >= 3 ? cur[j + 1] : cur[j];
      out[i + 2] = ch >= 3 ? cur[j + 2] : cur[j];
      out[i + 3] = ch === 4 ? cur[j + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { w, h, data: out, ctype };
}

function analyze(file) {
  const img = decodePNG(readFileSync(file));
  const { w, h, data } = img;
  console.log(`\n=== ${file}  ${w}x${h}  ctype=${img.ctype} ===`);

  // 四角颜色（判断背景）
  const at = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
  const corners = { 左上: at(0, 0), 右上: at(w - 1, 0), 左下: at(0, h - 1), 右下: at(w - 1, h - 1) };
  console.log("四角像素:", Object.entries(corners).map(([k, v]) => `${k}=rgba(${v})`).join("  "));

  // 透明像素比例
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 16) transparent++;
  console.log(`透明像素 ${(transparent / (w * h) * 100).toFixed(1)}%`);

  // 背景色 = 左上角；不是背景 = 不透明且颜色差异大
  const bg = at(0, 0);
  const isBg = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 16) return true;
    const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    return d < 30;
  };

  // 找有内容的列区间
  const colHas = new Array(w).fill(false);
  const rowHas = new Array(h).fill(false);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!isBg(x, y)) { colHas[x] = true; rowHas[y] = true; }
    }

  const ranges = (arr) => {
    const out = [];
    let start = -1;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] && start < 0) start = i;
      else if (!arr[i] && start >= 0) { out.push([start, i - 1]); start = -1; }
    }
    if (start >= 0) out.push([start, arr.length - 1]);
    return out;
  };

  const cols = ranges(colHas), rows = ranges(rowHas);
  console.log(`有内容的列区间 ${cols.length} 段:`, cols.slice(0, 30).map(([a, b]) => `${a}-${b}(${b - a + 1})`).join(" "));
  console.log(`有内容的行区间 ${rows.length} 段:`, rows.slice(0, 30).map(([a, b]) => `${a}-${b}(${b - a + 1})`).join(" "));

  // 非透明像素的边界
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (!isBg(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  console.log(`内容包围盒: x ${minX}..${maxX} (${maxX - minX + 1}px), y ${minY}..${maxY} (${maxY - minY + 1}px)`);
  return img;
}

analyze("art/walk.png");
analyze("art/attack.png");
