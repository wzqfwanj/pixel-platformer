import { Level } from "../world/level.js";
import { Warrior } from "../entities/warrior.js";
import { FxLayer } from "../fx/fxlayer.js";
import { Spawner } from "../world/spawner.js";
import { buildArena } from "../world/arena.js";

const fx = new FxLayer();
await fx.preload();
const DT = 1 / 60;

/** 正确的输入桩：跨帧保留 down，只在"新按下"时进 just。 */
function makeInput() {
  return {
    down: new Set(),
    just: new Set(),
    held(a) { return this.down.has(a); },
    pressed(a) { return this.just.has(a); },
    letGo: () => false,
    axis() { return (this.down.has("right") ? 1 : 0) - (this.down.has("left") ? 1 : 0); },
    /** 设定这一帧想按的键 */
    set(want) {
      this.just.clear();
      for (const k of want) if (!this.down.has(k)) this.just.add(k);
      this.down = new Set(want);
    },
  };
}

export function run(strategy, maxSeconds = 180, verbose = false, seed0 = 2024) {
  const arena = buildArena();
  const level = new Level(arena.rows);
  const p = new Warrior(arena.spawn.x, arena.spawn.y);
  let kills = 0;
  const world = {
    level, fx, enemies: [], player: p,
    shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() { kills++; }, respawnPlayer() {},
  };
  const idle = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0, set() {} };
  for (let i = 0; i < 10; i++) p.update(DT, idle, world);

  // 敌人内部（骷髅跳跃、特效种子）用的是 Math.random，会让结果不可复现。
  // 整个模拟期间换成种子随机，结束后还原。
  const __realRandom = Math.random;
  let __r = seed0;
  Math.random = () => ((__r = (__r * 1664525 + 1013904223) >>> 0) / 4294967296);

  let seed = seed0;
  const sp = new Spawner(() => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296));
  const input = makeInput();

  let deathT = null;
  const log = [];
  for (let f = 0; f < 60 * maxSeconds; f++) {
    for (const e of sp.update(DT, world, 320)) world.enemies.push(e);
    if (p.state === "dead" && deathT === null) { deathT = f / 60; }

    const want = strategy(p, world, f);
    input.set(want);
    p.update(DT, input, world);

    // 敌人接触伤害（这段逻辑在 main.js 里，simcore 必须同样实现，否则玩家不会掉血）
    if (p.state !== "dead") {
      for (const e of world.enemies) {
        if (e.dead || e.def.contact <= 0 || e.contactCd > 0) continue;
        const hit = p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y;
        if (hit && p.invuln <= 0) {
          if (p.takeDamage(e.def.contact, e.cx, world)) e.contactCd = 0.8;
        }
      }
    }

    for (const e of world.enemies) e.update(DT, world);
    world.enemies = world.enemies.filter((e) => !(e.dead && e.deadT > 0.6) && Math.abs(e.cx - p.cx) < 320 * 2.2);

    if (f % 600 === 0 && verbose) {
      log.push(`  ${(f / 60).toFixed(0)}s: hp=${p.hp.toFixed(0)} 敌=${world.enemies.filter((e) => !e.dead).length} 杀=${kills}`);
    }
    if (deathT !== null && f / 60 > deathT + 3) break;
  }
  Math.random = __realRandom;
  return { deathT, kills, hp: p.hp, log, spawned: sp.spawned };
}

// 只砍不躲
export const fightOnly = (p, world) => {
  const want = new Set();
  const alive = world.enemies.filter((e) => !e.dead);
  if (!alive.length || p.state === "dead") return want;
  const near = alive.reduce((a, b) => (Math.abs(a.cx - p.cx) < Math.abs(b.cx - p.cx) ? a : b));
  const dx = near.cx - p.cx;
  // 攻击范围：身体中心算起约 28px，留点余量取 26
  if (Math.abs(dx) > 20) want.add(dx > 0 ? "right" : "left");
  if (Math.abs(dx) < 26) want.add("attack");
  return want;
};

// 砍 + 被围冲刺脱身（冲刺时松开攻击，不然冲刺会被打断）
export const fightDash = (p, world, f) => {
  const want = fightOnly(p, world, f);
  const alive = world.enemies.filter((e) => !e.dead);
  const close = alive.filter((e) => Math.abs(e.cx - p.cx) < 18).length;
  if (close >= 2 && p.dashCd <= 0) {
    const near = alive.reduce((a, b) => (Math.abs(a.cx - p.cx) < Math.abs(b.cx - p.cx) ? a : b));
    want.delete("attack");
    want.add("dash");
    want.add(near.cx > p.cx ? "left" : "right");
  }
  return want;
};

// 直接运行时的对比输出
if (process.argv[1] && process.argv[1].endsWith("simcore.mjs")) {
  for (const [name, strat] of [["A 只砍不躲", fightOnly], ["B 砍+冲刺脱身", fightDash]]) {
    const r = run(strat, 180, true);
    console.log(`\n${name}`);
    console.log(r.log.join("\n"));
    console.log(`  -> 存活 ${r.deathT === null ? ">180" : r.deathT.toFixed(0)}s，杀 ${r.kills}，刷 ${r.spawned}`);
  }
}
