import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(HERE, "..");
const browser = "C:/Program Files/Google/Chrome/Application/chrome.exe";

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
  const profile = join(HERE, `.el-${label}-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const full = `${url}?frames=${frames}&script=endless&mode=endless`;
  const proc = spawn(browser, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, "--virtual-time-budget=40000",
    "--enable-logging=stderr", "--log-level=0", "--dump-dom", full,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stderr.on("data", (d) => (err += d));
  await new Promise((r) => proc.on("close", r));
  try { rmSync(profile, { recursive: true, force: true }); } catch {}

  const shot = out.match(/data-shot="data:image\/png;base64,([^"]+)"/);
  const metaM = out.match(/data-meta="([^"]*)"/);
  const info = out.match(/<div id="info">([^<]*)<\/div>/);
  const meta = metaM ? JSON.parse(metaM[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")) : null;
  return { png: shot ? decodePNG(Buffer.from(shot[1], "base64")) : null, meta, info: info ? info[1] : null, err, full };
}

let fails = 0;
const ok = (c, l, e = "") => { console.log(`  ${c ? "ok  " : "FAIL"} ${l}${e ? "  " + e : ""}`); if (!c) fails++; };

console.log("\n[线上无尽模式]");
const r1 = await grab("t10", "https://wkeeli.cn/pixel/game/index.html", 600);
const r2 = await grab("t60", "https://wkeeli.cn/pixel/game/index.html", 3600);

for (const [name, r] of [["10 秒", r1], ["60 秒", r2]]) {
  console.log(`-- ${name} --`);
  console.log(`   info: ${r.info ?? "(无)"}`);
  const bad = r.err.split(/\r?\n/).filter((l) =>
    /Uncaught|SyntaxError|TypeError|Failed to load resource|net::ERR|404/.test(l) &&
    !/GPU|gpu_|Fontconfig|dbus|Vulkan|DevTools|SharedImage|GLES|extension|favicon/i.test(l));
  for (const l of bad.slice(0, 5)) console.log("   ! " + l.slice(0, 180));
  ok(bad.length === 0, `${name}: 没有报错`, bad.length ? `${bad.length} 条` : "");
  if (!r.png) { ok(false, `${name}: 抓到画面`); continue; }
  let sum = 0; const uniq = new Set();
  for (let i = 0; i < r.png.w * r.png.h; i++) {
    const rr = r.png.data[i * 4], gg = r.png.data[i * 4 + 1], bb = r.png.data[i * 4 + 2];
    sum += (rr + gg + bb) / 3;
    if (uniq.size < 20000) uniq.add((rr >> 3) << 10 | (gg >> 3) << 5 | (bb >> 3));
  }
  const lum = sum / (r.png.w * r.png.h);
  ok(lum > 15 && uniq.size > 100, `${name}: 画面有内容`, `亮度 ${lum.toFixed(0)}, ${uniq.size} 色`);
  if (r.meta) {
    const alive = (r.meta.enemies ?? []).filter((e) => !e.dead);
    const types = [...new Set(alive.map((e) => e.t))].join(",");
    console.log(`   敌人 ${alive.length} 只 [${types}]，玩家 ${r.meta.state} hp=${r.meta.hp}`);
    ok(alive.length > 0, `${name}: 场上有敌人`, `${alive.length} 只`);
  }
  writeFileSync(join(GAME, `preview-endless-${name.replace(/\s/g, "")}.png`),
    Buffer.from(r.out?.match?.(/data-shot="data:image\/png;base64,([^"]+)"/)?.[1] ?? "", "base64"));
}

// 后期应该出现多种怪
if (r2.meta) {
  const alive = (r2.meta.enemies ?? []).filter((e) => !e.dead);
  const types = new Set(alive.map((e) => e.t));
  ok(types.size >= 2, "60 秒后出现多种敌人", [...types].join(","));
}

console.log(fails === 0 ? "\n线上无尽模式验证通过" : `\n有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
