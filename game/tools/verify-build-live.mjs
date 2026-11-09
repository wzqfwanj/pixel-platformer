import { spawn } from "node:child_process";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "https://wkeeli.cn/pixel/game/index.html";

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

async function go(query) {
  const profile = join(HERE, ".dl-" + Date.now() + Math.random().toFixed(3));
  mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    "--user-data-dir=" + profile, "--virtual-time-budget=45000",
    "--dump-dom", BASE + "?" + query,
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

// 1. 线上代码版本
console.log("\n=== 1. 线上 build 标记 ===");
{
  const r = await go("menu=0&frames=10&script=idle&theme=dark");
  ok(!!r.png, "拿到画面");
  if (r.png) {
    // 左下角应该有 build hash 的小字
    let dark = 0;
    for (let y = 172; y < 178; y++)
      for (let x = 0; x < 30; x++) {
        const i = (y * r.png.w + x) * 4;
        if (r.png.data[i] + r.png.data[i + 1] + r.png.data[i + 2] > 100) dark++;
      }
    console.log("   左下角 build 标记区亮像素: " + dark);
    ok(dark > 5, "页面左下角显示 build 标记", dark + " px");
  }
}

// 2. 自测：按住 K 释放多次
console.log("\n=== 2. 线上自测：按住 K 不放 ===");
{
  const r = await go("menu=0&selftest=1&scenario=hold&theme=dark");
  ok(!!r.meta && r.meta.selftest, "拿到自测结果");
  if (r.meta) {
    console.log("   释放 " + r.meta.releases + " 次，最久卡 " + r.meta.worstStuck + " 帧");
    console.log("   前几次时间线: " + (r.meta.trace || []).slice(0, 5).join(" | "));
    ok(r.meta.releases >= 10, "12 秒内释放 10 次以上", r.meta.releases + " 次");
    ok(r.meta.worstStuck === 0, "没有出现\"满了不释放\"", r.meta.worstStuck + " 帧");
  }
}

console.log(fails === 0 ? "\n线上验证通过" : "\n有 " + fails + " 项失败");
process.exit(fails === 0 ? 0 : 1);
