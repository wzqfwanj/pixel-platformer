// 验证线上部署：用 --dump-dom 抓页面里的画布数据（不依赖 --screenshot 的合成时机）。
// 用法: node game/tools/verify-live.mjs [基础URL]

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

async function grab(label, url, frames) {
  const profile = join(HERE, `.live-${label}-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const full = `${url}?frames=${frames}&script=showcase&theme=${label}`;
  const proc = spawn(browser, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, "--virtual-time-budget=30000",
    "--enable-logging=stderr", "--log-level=0", "--dump-dom", full,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stderr.on("data", (d) => (err += d));
  await new Promise((r) => proc.on("close", r));
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ok */ }

  const shot = out.match(/data-shot="data:image\/png;base64,([^"]+)"/);
  const metaM = out.match(/data-meta="([^"]*)"/);
  const info = out.match(/<div id="info">([^<]*)<\/div>/);
  const meta = metaM ? JSON.parse(metaM[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")) : null;
  const png = shot ? decodePNG(Buffer.from(shot[1], "base64")) : null;
  return { png, meta, info: info ? info[1] : null, err, url: full, out };
}

let fails = 0;
const ok = (cond, label, extra = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

console.log(`\n[线上验证] ${BASE}\n`);

const results = {};
for (const theme of ["dark", "light"]) {
  const r = await grab(theme, BASE, 200);
  results[theme] = r;
  console.log(`-- 主题 ${theme} --`);
  console.log(`   info: ${r.info ?? "(无)"}`);

  const bad = r.err.split(/\r?\n/).filter((l) =>
    /Uncaught|SyntaxError|TypeError|Failed to load resource|net::ERR|404/.test(l) &&
    !/GPU|gpu_|Fontconfig|dbus|Vulkan|DevTools|SharedImage|GLES|extension|favicon/i.test(l)
  );
  for (const l of bad.slice(0, 6)) console.log("   ! " + l.slice(0, 200));
  ok(bad.length === 0, `${theme}: 没有加载/语法错误`, bad.length ? `${bad.length} 条` : "");

  if (!r.png) { ok(false, `${theme}: 抓到了画布数据`); continue; }
  const img = r.png;
  ok(img.w === 320 && img.h === 180, `${theme}: 画布尺寸 320x180`, `${img.w}x${img.h}`);

  let sum = 0;
  const uniq = new Set();
  for (let i = 0; i < img.w * img.h; i++) {
    const rr = img.data[i * 4], gg = img.data[i * 4 + 1], bb = img.data[i * 4 + 2];
    sum += (rr + gg + bb) / 3;
    if (uniq.size < 20000) uniq.add((rr >> 3) << 10 | (gg >> 3) << 5 | (bb >> 3));
  }
  const lum = sum / (img.w * img.h);
  ok(lum > 15, `${theme}: 画面不是黑的`, `亮度 ${lum.toFixed(1)}`);
  ok(uniq.size > 100, `${theme}: 画面有内容`, `${uniq.size} 种颜色`);

  if (r.meta) {
    ok(r.meta.state !== undefined, `${theme}: 页面自报了状态`, `state=${r.meta.state} px=${r.meta.px} fx=${r.meta.fxCount}`);
    ok(r.meta.fxCount >= 10, `${theme}: 特效在跑（火把等）`, `${r.meta.fxCount} 个`);
  }

  const f = join(GAME, `preview-live-${theme}.png`);
  writeFileSync(f, Buffer.from(r.png.data.buffer, r.png.data.byteOffset, r.png.data.byteLength));
  // 存成能看的 PNG：直接把 base64 解出来写文件
  const b64 = r.out.match(/data-shot="data:image\/png;base64,([^"]+)"/)[1];
  writeFileSync(f, Buffer.from(b64, "base64"));
  console.log(`   截图 -> ${f}`);
}

// 两套主题的 HUD 应该不一样
if (results.dark.png && results.light.png) {
  const px = (img, x, y) => {
    const i = (y * img.w + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  const dPanel = px(results.dark.png, 5, 5);
  const lPanel = px(results.light.png, 5, 5);
  ok(Math.abs(dPanel[0] - lPanel[0]) > 60, "明暗主题确实不同（线上面板底色）", `${dPanel} vs ${lPanel}`);
}

console.log(fails === 0 ? "\n线上验证通过" : `\n线上验证有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
