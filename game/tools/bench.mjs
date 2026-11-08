// 性能测试：在 node 里跑同一套 update + render，量每帧耗时（JS 引擎一样，能代表浏览器的 CPU 成本）
// 用法: node game/tools/bench.mjs [帧数]

import { Surface, blitRect } from "../core/screen.js";
import { Level } from "../world/level.js";
import { Warrior } from "../entities/warrior.js";
import { Enemy } from "../entities/enemy.js";
import { FxLayer } from "../fx/fxlayer.js";
import { bakeSky, bakeHills, PARALLAX_W } from "../world/background.js";
import { drawHud } from "../ui/hud.js";
import { collectCoins } from "../world/pickups.js";
import { hex } from "../core/util.js";

const W = 320, H = 180;
const N = Number(process.argv[2] ?? 600);

const fx = new FxLayer();
await fx.preload();
const level = new Level();
const baked = level.bake();
const sky = bakeSky(W, H);
const hills = bakeHills(PARALLAX_W, H);

const buf = new Surface(W, H);
buf.out = new Uint8ClampedArray(W * H * 4);
const imgData = buf.out;

const cam = { x: 0, y: 0 };
let shakeAmt = 0, hitLagT = 0;

const p = new Warrior(level.spawn.x, level.spawn.y);
const enemies = level.enemySpawns.map((e) => new Enemy(e.type, e.x, e.y));
for (const t of level.torches) fx.spawn("fire/torch", t.x, t.y + 2, { sticky: true, lift: 1.25 });

const world = {
  level, fx, enemies, player: p,
  shake: (a) => { shakeAmt = Math.max(shakeAmt, a); },
  hitLag: (t) => { hitLagT = Math.max(hitLagT, t); },
  onHit: () => {},
  onEnemyKilled: () => {},
  respawnPlayer: () => {},
};

class FakeInput {
  constructor() { this.down = new Set(); this.just = new Set(); }
  held(a) { return this.down.has(a); }
  pressed(a) { return this.just.has(a); }
  letGo() { return false; }
  axis() { return (this.down.has("right") ? 1 : 0) - (this.down.has("left") ? 1 : 0); }
  apply(want) {
    this.just.clear();
    for (const k of want) if (!this.down.has(k)) this.just.add(k);
    this.down = new Set(want);
  }
}
const input = new FakeInput();

function update(dt) {
  const want = new Set(["right"]);
  const near = enemies.find((e) => !e.dead && Math.abs(e.cx - p.cx) < 34 && Math.abs(e.cy - p.cy) < 30);
  if (near) want.add("attack");
  if (p.onGround && Math.abs(p.vx) < 4) want.add("jump");
  input.apply(want);

  if (hitLagT > 0) { hitLagT -= dt; fx.update(dt * 0.12, cam); return; }
  p.update(dt, input, world);
  for (const e of enemies) e.update(dt, world);
  collectCoins(p.box, level.coins);
  fx.update(dt, cam);
  shakeAmt = Math.max(0, shakeAmt - dt * 22);
  const tx = Math.max(0, Math.min(level.pxW - W, p.cx - W / 2));
  cam.x += (tx - cam.x) * Math.min(1, dt * 7);
  cam.y = Math.max(0, Math.min(level.pxH - H, p.feet - 118));
}

function render() {
  buf.clearLight();
  buf.clear(hex("#0b0812"));
  const sh = shakeAmt;
  const c = {
    x: Math.round(cam.x + (sh > 0 ? (Math.random() * 2 - 1) * sh : 0)),
    y: Math.round(cam.y + (sh > 0 ? (Math.random() * 2 - 1) * sh : 0)),
  };
  blitRect(sky, buf, 0, 0, W, H, 0, 0);
  const off = Math.round((c.x * 0.28) % PARALLAX_W);
  for (let i = -1; i <= 1; i++) blitRect(hills, buf, 0, 0, PARALLAX_W, H, i * PARALLAX_W - off, 0);
  blitRect(baked, buf, c.x, c.y, W, H, 0, 0);
  fx.drawBack(buf, c);
  for (const e of enemies) e.draw(buf, c);
  p.draw(buf, c);
  fx.drawFront(buf, c);
  drawHud(buf, {
    player: p, coins: 3, coinTotal: level.coins.length, enemiesKilled: 1,
    combo: 3, comboTimer: 1, showHint: true, debug: false, won: false, fps: 60, fx,
  });
  buf.composite(imgData);
}

// 预热
for (let i = 0; i < 60; i++) { update(1 / 60); render(); }

let updateMs = 0, renderMs = 0;
const times = [];
for (let i = 0; i < N; i++) {
  let t0 = performance.now();
  update(1 / 60);
  let t1 = performance.now();
  render();
  let t2 = performance.now();
  updateMs += t1 - t0;
  renderMs += t2 - t1;
  times.push(t2 - t0);
}
times.sort((a, b) => a - b);
const pct = (q) => times[Math.min(times.length - 1, Math.floor(times.length * q))];

console.log(`跑了 ${N} 帧（含 ${fx.count} 个活跃特效）`);
console.log(`  逻辑 update 平均 ${(updateMs / N).toFixed(3)} ms`);
console.log(`  渲染 render 平均 ${(renderMs / N).toFixed(3)} ms`);
console.log(`  单帧总计   平均 ${(times.reduce((a, b) => a + b, 0) / N).toFixed(3)} ms, 中位 ${pct(0.5).toFixed(3)} ms, p95 ${pct(0.95).toFixed(3)} ms, 最慢 ${times[times.length - 1].toFixed(3)} ms`);
console.log(`  按平均算理论上限 ${Math.round(1000 / (times.reduce((a, b) => a + b, 0) / N))} fps（16.67ms 是 60fps 预算）`);
