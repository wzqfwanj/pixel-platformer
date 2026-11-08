import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://127.0.0.1:8123/game/index.html";

async function selftest(scenario) {
  const profile = join(HERE, ".st-" + Date.now() + Math.random().toFixed(3));
  mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    "--user-data-dir=" + profile, "--virtual-time-budget=45000",
    "--dump-dom", BASE + "?menu=0&selftest=1&theme=dark&scenario=" + scenario,
  ], { stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  await new Promise((r) => proc.on("close", r));
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  const m = out.match(/data-meta="([^"]*)"/);
  return m ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")) : null;
}

for (const sc of ["hold", "holdmove", "holdjump", "tap"]) {
  const r = await selftest(sc);
  console.log("\n=== 场景 " + sc + " ===");
  if (!r) { console.log("  没拿到结果"); continue; }
  console.log("  释放 " + r.releases + " 次 | 最久\"满了不释放\" " + r.worstStuck + " 帧");
  console.log("  结束: charging=" + r.finalCharging + " charge=" + r.finalCharge +
    " state=" + r.finalState + " hitLagT=" + r.finalHitLag);
  if (r.trace.length) {
    console.log("  时间线（前 8 条）:");
    for (const t of r.trace.slice(0, 8)) console.log("    " + t);
  }
}
