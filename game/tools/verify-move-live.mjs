import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "https://wkeeli.cn/pixel/game/index.html";

async function go(query) {
  const profile = join(HERE, ".fn-" + Date.now() + Math.random().toFixed(3));
  mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    "--user-data-dir=" + profile, "--virtual-time-budget=60000",
    "--dump-dom", BASE + "?" + query,
  ], { stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  await new Promise((r) => proc.on("close", r));
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  const m = out.match(/data-meta="([^"]*)"/);
  return m ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")) : null;
}

let fails = 0;
const ok = (c, l, e) => { console.log((c ? "  ok   " : "  FAIL ") + l + (e ? "  " + e : "")); if (!c) fails++; };

console.log("\n=== 线上：按住 K 边跑 30 秒 ===");
{
  const m = await go("menu=0&frames=1800&script=holdheavy&theme=dark");
  ok(!!m, "拿到 meta");
  if (m) {
    const sc = m.spawnCount || {};
    const slam = sc["impacts/ground-slam"] ?? 0;
    console.log("   玩家 x=" + m.px + " | ground-slam 释放 " + slam + " 次 | fx 存活 " + m.fxCount);
    ok(slam >= 20, "移动中也能持续释放", slam + " 次");
    // 位置不强制（脚本不会跳坑），但要确认玩家没被卡在地图外
    ok(m.py < 400, "玩家没有被卡到地图外", "feet=" + m.py);
    console.log("   备注：holdheavy 脚本不判断地形，掉坑会被拉回安全点，位置不作为判据");
  }
}

console.log("\n=== 线上：自测各场景 ===");
for (const sc of ["hold", "holdmove", "holdjump", "tap"]) {
  const r = await go("menu=0&selftest=1&scenario=" + sc + "&theme=dark");
  ok(!!r && r.releases >= 10, sc + " 释放 " + (r ? r.releases : "?") + " 次，卡 " + (r ? r.worstStuck : "?") + " 帧");
}

console.log(fails === 0 ? "\n线上验证通过" : "\n有 " + fails + " 项失败");
process.exit(fails === 0 ? 0 : 1);
