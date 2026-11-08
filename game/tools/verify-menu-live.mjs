import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL_MENU = "https://wkeeli.cn/pixel/game/index.html?frames=1&menu=1";
const URL_GAME = "https://wkeeli.cn/pixel/game/index.html?frames=600&script=auto&menu=0";

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

async function grab(url) {
  const profile = join(HERE, ".lv-" + Date.now());
  mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    "--user-data-dir=" + profile, "--virtual-time-budget=30000",
    "--dump-dom", url,
  ], { stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  await new Promise((r) => proc.on("close", r));
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  const shot = out.match(/data-shot="data:image\/png;base64,([^"]+)"/);
  const m = out.match(/data-meta="([^"]*)"/);
  return {
    png: shot ? decodePNG(Buffer.from(shot[1], "base64")) : null,
    meta: m ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")) : null,
    info: (out.match(/<div id="info">([^<]*)<\/div>/) || [])[1],
  };
}

let fails = 0;
const ok = (c, l, e) => { console.log((c ? "  ok   " : "  FAIL ") + l + (e ? "  " + e : "")); if (!c) fails++; };

console.log("\n=== 线上：菜单 ===");
{
  const r = await grab(URL_MENU);
  ok(!!r.png, "拿到画面");
  ok(r.meta?.scene === "menu", "页面状态是菜单", JSON.stringify(r.meta));
  ok(r.info === "菜单", "info 显示菜单", r.info);
  if (r.png) {
    let bright = 0;
    for (let i = 0; i < r.png.w * r.png.h; i++) {
      const rr = r.png.data[i * 4], g = r.png.data[i * 4 + 1], b = r.png.data[i * 4 + 2];
      if (0.3 * rr + 0.6 * g + 0.1 * b > 150) bright++;
    }
    ok(bright > 1000, "菜单有可见文字", bright + " 亮像素");
  }
}

console.log("\n=== 线上：关卡模式与金币 ===");
{
  const r = await grab(URL_GAME);
  ok(!!r.meta, "拿到 meta");
  if (r.meta) {
    console.log("   金币 " + r.meta.gotCoins + "/" + r.meta.totalCoins + " | 玩家 x=" + r.meta.px);
    ok(r.meta.totalCoins > 0, "有金币", r.meta.totalCoins + " 枚");
    ok(r.meta.gotCoins > 0, "金币计数正常", r.meta.gotCoins + " 枚");
  }
}

console.log(fails === 0 ? "\n线上验证通过" : "\n有 " + fails + " 项失败");
process.exit(fails === 0 ? 0 : 1);
