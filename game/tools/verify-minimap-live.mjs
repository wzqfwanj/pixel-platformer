// 验证线上的小地图：抓页面回传的画布，检查右上角是否真的有小地图。
// 用法: node game/tools/verify-minimap-live.mjs

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(HERE, "..");
const BASE = process.argv[2] ?? "https://wkeeli.cn/pixel/game/index.html";
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) { console.error("没找到浏览器"); process.exit(1); }

function decodePNG(buf) {
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

async function grab(label, frames, mode) {
  const profile = join(HERE, `.mmp-${label}-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const url = `${BASE}?frames=${frames}&script=idle&mode=${mode}&theme=dark`;
  const proc = spawn(browser, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, "--virtual-time-budget=30000",
    "--enable-logging=stderr", "--log-level=0", "--dump-dom", url,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stderr.on("data", (d) => (err += d));
  await new Promise((r) => proc.on("close", r));
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  const shot = out.match(/data-shot="data:image\/png;base64,([^"]+)"/);
  return { png: shot ? decodePNG(Buffer.from(shot[1], "base64")) : null, err, info: out.match(/<div id="info">([^<]*)<\/div>/)?.[1] };
}

let fails = 0;
const ok = (c, l, e = "") => { console.log(`  ${c ? "ok  " : "FAIL"} ${l}${e ? "  " + e : ""}`); if (!c) fails++; };

console.log(`\n[线上小地图] ${BASE}`);

for (const mode of ["level", "endless"]) {
  const r = await grab(mode, 300, mode);
  console.log(`-- ${mode} --   info: ${r.info ?? "(无)"}`);
  const bad = r.err.split(/\r?\n/).filter((l) =>
    /Uncaught|SyntaxError|TypeError|Failed to load resource|net::ERR|404/.test(l) &&
    !/GPU|gpu_|Fontconfig|dbus|Vulkan|DevTools|SharedImage|GLES|extension|favicon/i.test(l));
  ok(bad.length === 0, `${mode}: 没有报错`, bad.length ? `${bad.length} 条` : "");
  if (!r.png) { ok(false, `${mode}: 抓到画布`); continue; }

  const { w, h, data } = r.png;
  ok(w === 320 && h === 180, `${mode}: 画布尺寸正常`, `${w}x${h}`);

  // 小地图预期在右上角：x 222..315, y 22..41
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  };
  const bright = (p) => Math.max(p.r, p.g, p.b) > 60;

  // 顶边框：小地图现在贴顶，在上部（y 2..12）找最长横线
  let bestRun = 0, bestY = -1;
  for (let y = 2; y < 12; y++) {
    let run = 0;
    for (let x = 200; x < w; x++) {
      if (bright(at(x, y))) { run++; if (run > bestRun) { bestRun = run; bestY = y; } }
      else run = 0;
    }
  }
  ok(bestRun > 40, `${mode}: 小地图顶边框在画面上部`, `${bestRun} px @ y=${bestY}`);
  ok(bestY <= 8, `${mode}: 小地图贴顶（文字在它下面）`, `y=${bestY}`);

  // 内部有地形
  let inside = 0;
  for (let y = bestY + 2; y < bestY + 20 && y < h; y++)
    for (let x = 224; x < 314; x++) if (bright(at(x, y))) inside++;
  ok(inside > 80, `${mode}: 小地图内部有地形`, `${inside} px`);

  // 小地图下方应该有文字
  let textBelow = 0;
  for (let y = bestY + 20; y < Math.min(h, bestY + 34); y++)
    for (let x = 240; x < 316; x++) if (bright(at(x, y))) textBelow++;
  ok(textBelow > 20, `${mode}: 文字排在小地图下面`, `${textBelow} px`);

  writeFileSync(join(GAME, `preview-live-minimap-${mode}.png`), Buffer.from(
    (await (async () => {
      const p2 = spawn(browser, ["--headless=new", "--disable-gpu", "--dump-dom", `${BASE}?frames=300&script=idle&mode=${mode}&theme=dark`], { stdio: ["ignore", "pipe", "ignore"] });
      let o = "";
      p2.stdout.on("data", (d) => (o += d));
      await new Promise((r2) => p2.on("close", r2));
      return o.match(/data-shot="data:image\/png;base64,([^"]+)"/)?.[1] ?? "";
    })(), "base64")));
}

console.log(fails === 0 ? "\n线上小地图验证通过" : `\n有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
