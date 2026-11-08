// 无头验证：跑一次页面 → 页面把画布 POST 回来 → 服务器落盘 preview.png
// 然后解码 PNG、压成 ASCII 看构图，并生成 3 倍放大的 preview@3x.png 给人看。
// 用法: node game/tools/shot.mjs [--frames 300] [--script combat]

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(HERE, "..");
const root = resolve(GAME, "..");
const argOf = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const FRAMES = argOf("--frames", "300");
const SCRIPT = argOf("--script", "combat");
const PORT = Number(argOf("--port", "8123"));
const SHOT = join(GAME, "preview.png");

// 后端是 Python（见 game/server.py）
const PYTHON = ["python", "py"].find((p) => spawnSync(p, ["--version"], { stdio: "ignore" }).status === 0) ?? "python";

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) { console.error("没找到 Chrome/Edge"); process.exit(1); }

rmSync(SHOT, { force: true });
const server = spawn(PYTHON, [join(GAME, "server.py"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));

const profile = join(HERE, ".shot-profile-" + Date.now());
mkdirSync(profile, { recursive: true });
const url = `http://127.0.0.1:${PORT}/game/index.html?frames=${FRAMES}&script=${SCRIPT}`;
const proc = spawn(browser, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--virtual-time-budget=20000", "--window-size=1000,700",
  "--enable-logging=stderr", "--log-level=0", url,
], { stdio: ["ignore", "pipe", "pipe"] });
let err = "";
proc.stderr.on("data", (d) => (err += d.toString()));

const t0 = Date.now();
while (!existsSync(SHOT) && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 200));
proc.kill();
server.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* profile 被 chrome 锁着，下次再说 */ }

const errs = err.split(/\r?\n/).filter((l) => /CONSOLE.*(?:error|Error|ERR|shot)|Uncaught|SyntaxError|TypeError|404/.test(l));
if (errs.length) {
  console.log("---- 页面日志 ----");
  for (const l of errs.slice(0, 10)) console.log("  " + l.replace(/^.*?CONSOLE[^"]*"/, "").slice(0, 200));
}

if (!existsSync(SHOT)) { console.error("页面没有回传截图"); process.exit(1); }

// ---------- PNG 解码
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
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bitDepth !== 8 || !ch) throw new Error(`不支持的 PNG: depth=${bitDepth} type=${colorType}`);
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

// ---------- PNG 编码（放大用）
const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, "ascii"), data]), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePNG(w, h, rgba) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const png = decodePNG(readFileSync(SHOT));
const { w, h, data } = png;
console.log(`preview.png ${w}x${h}`);

// ---------- 统计
let sum = 0; const uniq = new Set();
for (let i = 0; i < w * h; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  sum += (r + g + b) / 3;
  if (uniq.size < 20000) uniq.add((r >> 2) << 12 | (g >> 2) << 6 | (b >> 2));
}
console.log(`平均亮度 ${(sum / (w * h)).toFixed(1)}，颜色 ${uniq.size} 种`);

// ---------- 实体位置（页面回传的 JSON）
let meta = null;
try { meta = JSON.parse(readFileSync(join(GAME, "preview.json"), "utf8")); } catch { meta = null; }
const markers = new Map();  // "gx,gy" -> 字符
if (meta) {
  const put = (wx, wy, ch) => {
    const gx = Math.floor((wx - meta.cam.x) / 4), gy = Math.floor((wy - meta.cam.y) / 4);
    if (gx >= 0 && gy >= 0 && gx < Math.ceil(w / 4) && gy < Math.ceil(h / 4)) markers.set(gx + "," + gy, ch);
  };
  for (const t of meta.torches) put(t.x, t.y - 20, "T");
  for (const c of meta.coins ?? []) put(c.x + 2, c.y + 4, "c");
  for (const e of meta.enemies ?? []) if (!e.dead) put(e.x, e.y - 8, e.t === "slime" ? "s" : "D");
  put(meta.px, meta.py - 10, "P");
  put(meta.exit.x, meta.exit.y - 20, "X");
  console.log(`\n实体: 玩家(${meta.px},${meta.py}) ${meta.state} | 相机(${meta.cam.x},${meta.cam.y}) | 敌人 ${(meta.enemies ?? []).filter((e) => !e.dead).length} 个 | 金币 ${(meta.coins ?? []).length} 个 | 特效 ${meta.fxCount}`);
}

// ---------- 亮度 ASCII（1 字符 = 4x4 像素）
const LUM = " .:-=+*#%@";
console.log("\n---- 亮度图 (1 字符 = 4x4 像素) ----");
for (let y = 0; y < h; y += 4) {
  let line = "";
  for (let x = 0; x < w; x += 4) {
    let l = 0, n = 0;
    for (let j = 0; j < 4 && y + j < h; j++) for (let i = 0; i < 4 && x + i < w; i++) {
      const k = ((y + j) * w + x + i) * 4;
      l += data[k] * 0.3 + data[k + 1] * 0.6 + data[k + 2] * 0.1; n++;
    }
    const mk = markers.get((x / 4) + "," + (y / 4));
    line += mk ?? LUM[Math.min(9, Math.floor((l / n / 255) * 10))];
  }
  console.log(line);
}

// ---------- 色相 ASCII（看"哪里是什么颜色的东西"）
const hueChar = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 24) return " ";
  const sat = (mx - mn) / mx;
  if (sat < 0.18) return mx > 190 ? "W" : mx > 110 ? "w" : "k";   // 白/浅灰/深灰
  if (r >= g && r >= b) return g > r * 0.62 ? (g > b * 1.5 ? "y" : "o") : (b > r * 0.6 ? "m" : "R"); // 红/橙/黄/品红
  if (g >= r && g >= b) return "G";
  return b > r * 1.3 ? "B" : "C";                                  // 蓝/青
};
console.log("\n---- 色相图 (R红 o橙 y黄 G绿 C青 B蓝 m紫 W白 w灰 k暗) ----");
for (let y = 0; y < h; y += 4) {
  let line = "";
  for (let x = 0; x < w; x += 4) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = 0; j < 4 && y + j < h; j++) for (let i = 0; i < 4 && x + i < w; i++) {
      const k = ((y + j) * w + x + i) * 4;
      // 取最亮的那个像素代表这一块（避免被背景盖住）
      const lum = data[k] + data[k + 1] + data[k + 2];
      if (lum > r + g + b) { r = data[k]; g = data[k + 1]; b = data[k + 2]; }
      n++;
    }
    line += n ? hueChar(r, g, b) : " ";
  }
  console.log(line);
}

// ---------- 3 倍放大给人看
const K = 3, out = new Uint8Array(w * K * h * K * 4);
for (let y = 0; y < h * K; y++) for (let x = 0; x < w * K; x++) {
  const si = ((y / K | 0) * w + (x / K | 0)) * 4, di = (y * w * K + x) * 4;
  out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = 255;
}
writeFileSync(join(GAME, "preview@3x.png"), encodePNG(w * K, h * K, out));
console.log("\n已写出 preview.png 和 preview@3x.png");
