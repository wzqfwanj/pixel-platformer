// 验证主题：分别用 light / dark 加载页面，检查页面背景、HUD 是否真的变了，
// 并且确认 HUD 是黑白的（不是彩色）。
// 用法: node game/tools/themecheck.mjs

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(HERE, "..");
const PORT = 8123;

const PYTHON = ["python", "py"].find((p) => spawnSync(p, ["--version"], { stdio: "ignore" }).status === 0) ?? "python";
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) { console.error("没找到 Chrome/Edge"); process.exit(1); }

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

// 先确认端口上的服务器支持 /__meta（旧版 node 服务器不支持，必须换成 python 的）
const alive = await fetch(`http://127.0.0.1:${PORT}/__meta`, { method: "POST", body: "{}" })
  .then((r) => r.ok)
  .catch(() => false);
let server = null;
if (!alive) {
  server = spawn(PYTHON, [join(GAME, "server.py"), String(PORT)], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
}

async function shoot(theme) {
  const out = join(GAME, `preview-${theme}.png`);
  rmSync(out, { force: true });
  rmSync(join(GAME, "preview.json"), { force: true });
  const profile = join(HERE, `.theme-profile-${theme}-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const url = `http://127.0.0.1:${PORT}/game/index.html?frames=90&script=idle&theme=${theme}`;
  const proc = spawn(browser, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, "--virtual-time-budget=20000", "--enable-logging=stderr", "--log-level=0", url,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  proc.stderr.on("data", (d) => (err += d.toString()));
  const t0 = Date.now();
  const fixed = join(GAME, "preview.png");
  rmSync(fixed, { force: true });
  while (!(existsSync(fixed) && existsSync(join(GAME, "preview.json"))) && Date.now() - t0 < 45000)
    await new Promise((r) => setTimeout(r, 150));
  if (existsSync(fixed)) copyFileSync(fixed, out);
  proc.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 锁着就算了 */ }
  if (!existsSync(out)) throw new Error(`${theme} 没截到图: ` + err.slice(-300));
  const meta = JSON.parse(readFileSync(join(GAME, "preview.json"), "utf8"));
  return { png: decodePNG(readFileSync(out)), meta, file: out };
}

const dark = await shoot("dark");
const light = await shoot("light");
if (server) server.kill();

/** 取画布某块区域的平均色 */
function region(img, x0, y0, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * img.w + x) * 4;
      r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
    }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
/** 这块区域是不是"灰"的（R≈G≈B） */
function grayness([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}
const lum = ([r, g, b]) => 0.3 * r + 0.6 * g + 0.1 * b;

let fails = 0;
const ok = (cond, label, extra = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

console.log("\n[主题验证]");
// HUD：血条本体（x 16..74 那段，暗色是浅条、亮色是深条）
const hudD = region(dark.png, 16, 8, 58, 5);
const hudL = region(light.png, 16, 8, 58, 5);
console.log(`  暗色 HUD 平均色 rgb(${hudD})  亮度 ${lum(hudD).toFixed(0)}`);
console.log(`  亮色 HUD 平均色 rgb(${hudL})  亮度 ${lum(hudL).toFixed(0)}`);

// 血条是反色的：暗色主题下浅色条，亮色主题下深色条
ok(lum(hudD) > lum(hudL), "血条在暗色主题下是浅色、亮色主题下是深色", `${lum(hudD).toFixed(0)} vs ${lum(hudL).toFixed(0)}`);
ok(grayness(hudD) < 0.12, "暗色 HUD 是黑白的", `偏色 ${(grayness(hudD) * 100).toFixed(1)}%`);
ok(grayness(hudL) < 0.12, "亮色 HUD 是黑白的", `偏色 ${(grayness(hudL) * 100).toFixed(1)}%`);

// HUD 面板里不能有饱和的彩色像素（红血条之类）
function coloredPixels(img, x0, y0, w, h) {
  let n = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * img.w + x) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > 40 && (mx - mn) / mx > 0.25) n++;
    }
  return n;
}
// HUD 的不透明面板区域：左上血条面板、底部提示条
const PANELS = [
  [4, 4, 74, 12],
  [0, 167, 320, 13],
];
for (const [name, shot] of [["暗色", dark], ["亮色", light]]) {
  let c = 0;
  for (const [x, y, w, h] of PANELS) c += coloredPixels(shot.png, x, y, w, h);
  ok(c === 0, `${name}主题 HUD 面板是黑白的（无彩色像素）`, `${c} 个`);
}

// 面板底色要真的不一样（暗色面板应比亮色面板暗很多）
const panelD = region(dark.png, 4, 4, 2, 12);
const panelL = region(light.png, 4, 4, 2, 12);
ok(Math.abs(lum(panelD) - lum(panelL)) > 60, "两套主题的面板底色差异明显", `${lum(panelD).toFixed(0)} vs ${lum(panelL).toFixed(0)}`);

console.log(`\n截图: preview-dark.png / preview-light.png`);
console.log(fails === 0 ? "主题验证通过" : `主题验证有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
