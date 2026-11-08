// 抖动量测（纯 Node，不开浏览器）。
// 直接复用 main.js 用的那份相机模块（world/camera.js），不复制逻辑，
// 所以这里量到的就是游戏里真实发生的事。
//
// 判定标准：
//   抖动 = 像素位置反复的 ±1 变化（尤其反向）
//   台阶 = 一次性的 16 像素落差，那是地形，不算抖动
//
// 用法: node game/tools/jitter.mjs [帧数]

import { Level } from "../world/level.js";
import { Warrior } from "../entities/warrior.js";
import { WARRIOR_H, WARRIOR_CX, WARRIOR_W } from "../entities/warriorArt.js";
import { FxLayer } from "../fx/fxlayer.js";
import { placeCamera, followCamera, renderCamera } from "../world/camera.js";

const N = Number(process.argv[2] ?? 300);

const fx = new FxLayer();
const level = new Level();
const world = {
  level, fx, enemies: [], player: null,
  shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() {}, respawnPlayer() {},
};
const p = new Warrior(level.spawn.x, level.spawn.y);
world.player = p;

class FakeInput {
  constructor() { this.down = new Set(["right"]); this.just = new Set(); }
  held(a) { return this.down.has(a); }
  pressed(a) { return this.just.has(a); }
  letGo() { return false; }
  axis() { return 1; }
  endFrame() { this.just.clear(); }
}
const input = new FakeInput();
const cam = placeCamera({ x: 0, y: 0 }, p, level);

const BODY = [WARRIOR_W - 1 - WARRIOR_CX, WARRIOR_CX];
const rows = [];
for (let i = 0; i < N; i++) {
  p.update(1 / 60, input, world);
  input.endFrame();
  followCamera(cam, p, level);
  const rc = renderCamera(cam, 0);
  const pose = p.pose();
  const body = BODY[p.facing > 0 ? 1 : 0];
  rows.push({
    i,
    state: p.state,
    wx: p.cx, wy: p.feet,
    camX: rc.x, camY: rc.y,
    sX: Math.round(p.cx) - body - 1 - rc.x,
    sY: Math.round(p.feet) - WARRIOR_H - rc.y,
    bob: pose.bob ?? 0,
  });
}

const use = rows.filter((r) => r.state === "run");
const sample = use.length > 30 ? use : rows;
console.log(`采样 ${rows.length} 帧（跑动 ${use.length} 帧）\n`);

const analyze = (label, fn) => {
  const v = sample.map(fn);
  const d = [];
  for (let i = 1; i < v.length; i++) d.push(v[i] - v[i - 1]);
  let flips = 0, zeros = 0, tiny = 0;
  for (let i = 1; i < d.length; i++) {
    if (d[i] === 0) zeros++;
    if (Math.abs(d[i]) === 1) tiny++;
    if (d[i] !== 0 && d[i - 1] !== 0 && Math.sign(d[i]) !== Math.sign(d[i - 1])) flips++;
  }
  const counts = {};
  for (const x of d) counts[x] = (counts[x] ?? 0) + 1;
  console.log(`  ${label.padEnd(18)} ${JSON.stringify(counts).padEnd(44)} 反向 ${String(flips).padStart(2)}  ±1 变化 ${String(tiny).padStart(2)}  停滞 ${zeros}`);
  return { counts, flips, zeros, tiny, total: d.length };
};

console.log("每帧像素位移：");
const sx = analyze("角色屏幕 X", (r) => r.sX);
const sy = analyze("角色屏幕 Y", (r) => r.sY);
const cx = analyze("相机 X", (r) => r.camX);
const cy = analyze("相机 Y", (r) => r.camY);

console.log("\n逐帧明细（前 20 帧）：");
console.log("   i  wx      wy    camX  camY  sX  sY  bob  state");
for (const r of sample.slice(0, 20)) {
  console.log(
    `  ${String(r.i).padStart(3)} ${r.wx.toFixed(1).padStart(7)} ${r.wy.toFixed(0).padStart(4)}  ` +
    `${String(r.camX).padStart(4)} ${String(r.camY).padStart(5)} ${String(r.sX).padStart(3)} ${String(r.sY).padStart(3)} ` +
    `${String(r.bob).padStart(4)}  ${r.state}`
  );
}

const bigJumps = Object.entries(sy.counts).filter(([k]) => Math.abs(Number(k)) > 1);
console.log("\n判定：");
let bad = 0;
if (sx.flips > 2) { console.log(`  ✗ 水平反向 ${sx.flips} 次 —— 有来回抖动`); bad++; }
else console.log("  ✓ 水平：无反向，最多单向推进");

if (sy.tiny > 2) { console.log(`  ✗ 竖直 ±1 变化 ${sy.tiny} 次 —— 有抖动`); bad++; }
else console.log(`  ✓ 竖直：±1 变化 ${sy.tiny} 次，身体没有上下颠`);

if (bigJumps.length) console.log(`  · 台阶落差 ${JSON.stringify(Object.fromEntries(bigJumps))}（地形导致，正常）`);

console.log(`  · 相机停滞 ${cx.zeros}/${cx.total} 帧：角色在死区内或关卡边界时会为 0，属正常`);
console.log(bad === 0 ? "\n结论：抖动已消除" : `\n结论：还有 ${bad} 处问题`);
process.exit(bad === 0 ? 0 : 1);
