// 无尽模式的逻辑测试：刷怪、难度递增、回收、死亡结算。
// 不测手感（那是 combo/smooth 的事），只测"这个模式能不能一直跑下去"。
//
// 用法: node game/tools/endless.mjs

import { Level } from "../world/level.js";
import { Warrior } from "../entities/warrior.js";
import { Enemy } from "../entities/enemy.js";
import { FxLayer } from "../fx/fxlayer.js";
import { Spawner, PHASES } from "../world/spawner.js";
import { buildArena } from "../world/arena.js";

const fx = new FxLayer();
await fx.preload();

let fails = 0;
const ok = (cond, label, extra = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

const DT = 1 / 60;
const VIEW_W = 320;

function makeWorld() {
  const arena = buildArena();
  const level = new Level(arena.rows);
  const p = new Warrior(arena.spawn.x, arena.spawn.y);
  const world = {
    level, fx, enemies: [], player: p,
    shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() { world.enemiesKilledCount = (world.enemiesKilledCount ?? 0) + 1; }, respawnPlayer() {},
    enemiesKilledCount: 0,
  };
  // 让角色落到地面
  const idle = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0, apply() {} };
  for (let i = 0; i < 10; i++) p.update(DT, idle, world);
  return { world, p, level };
}

// ---------------------------------------------------------------- 1. 竞技场
console.log("\n[1] 无尽模式的场地");
{
  const arena = buildArena();
  const level = new Level(arena.rows);
  ok(level.w >= 60, "场地够宽", `${level.w} 格`);
  ok(arena.spawn.x > 0 && level.at(Math.floor(arena.spawn.x / 16), Math.floor(arena.spawn.y / 16) - 1) !== "#",
    "出生点在空地上");
  // 中间不能有坑（无尽模式掉坑会很烦）
  let pits = 0;
  for (let tx = 2; tx < level.w - 2; tx++) {
    let hasFloor = false;
    for (let ty = 0; ty < level.h; ty++) if (level.at(tx, ty) === "#") hasFloor = true;
    if (!hasFloor) pits++;
  }
  ok(pits === 0, "地面完整没有坑", `${pits} 处空洞`);
}

// ---------------------------------------------------------------- 2. 刷怪
console.log("\n[2] 怪从两侧刷出来");
{
  const { world, p } = makeWorld();
  const spawner = new Spawner(() => 0.5);   // 固定随机，结果可复现
  let left = 0, right = 0, total = 0;
  let t = 0;
  for (let i = 0; i < 60 * 30; i++) {
    t += DT;
    const wave = spawner.update(DT, world, VIEW_W);
    for (const e of wave) {
      world.enemies.push(e);
      total++;
      if (e.cx < p.cx) left++; else right++;
    }
    // 敌人不更新（只看刷怪）
  }
  console.log(`  30 秒刷了 ${total} 只：左侧 ${left}，右侧 ${right}`);
  ok(total > 8, "有持续刷出怪", `${total} 只`);
  ok(left > 0 && right > 0, "两侧都刷（不是只从一边）", `左 ${left} / 右 ${right}`);
  ok(Math.abs(left - right) < total * 0.75, "两侧数量大致均衡");

  // 刷在视野外，玩家看不到凭空出现
  const spawner2 = new Spawner(() => 0.3);
  const w2 = makeWorld();
  let offscreen = 0, onscreen = 0;
  for (let i = 0; i < 60 * 20; i++) {
    const wave = spawner2.update(DT, w2.world, VIEW_W);
    for (const e of wave) {
      const d = Math.abs(e.cx - w2.p.cx);
      if (d > VIEW_W / 2) offscreen++; else onscreen++;
    }
  }
  console.log(`  刷怪点距离玩家：视野外 ${offscreen} 只，视野内 ${onscreen} 只`);
  ok(onscreen === 0, "全部刷在视野外（不会凭空冒出来）", `${onscreen} 只在视野内`);
}

// ---------------------------------------------------------------- 3. 难度递增
console.log("\n[3] 难度随时间递增");
{
  // 波次配置本身
  ok(PHASES.length >= 5, "有多个难度阶段", `${PHASES.length} 个`);
  let mono = true;
  for (let i = 1; i < PHASES.length; i++) {
    if (PHASES[i].spawnInterval >= PHASES[i - 1].spawnInterval) mono = false;
    if (PHASES[i].hpScale <= PHASES[i - 1].hpScale) mono = false;
  }
  ok(mono, "刷怪间隔越来越短、血量越来越高");

  // 实测：前 20 秒 vs 100 秒后的刷怪密度
  const countIn = (seconds, seedFn) => {
    const { world } = makeWorld();
    const sp = new Spawner(seedFn);
    let n = 0;
    for (let i = 0; i < 60 * seconds; i++) n += sp.update(DT, world, VIEW_W).length;
    return n;
  };
  const early = countIn(20, () => 0.5);
  const late = countIn(140, () => 0.5);
  console.log(`  前 20 秒 ${early} 只，140 秒时累计 ${late} 只`);
  ok(late > early * 3, "后期刷怪明显更密", `${late} vs ${early}`);
}

// ---------------------------------------------------------------- 4. 三种新怪都能动
console.log("\n[4] 新敌人有自己的行为");
{
  const { world, p } = makeWorld();
  for (const type of ["bat", "skull", "gargoyle"]) {
    const e = new Enemy(type, p.cx + 60, p.cy);
    e.maxHp = e.hp;
    world.enemies = [e];
    const x0 = e.x, y0 = e.y;
    for (let i = 0; i < 90; i++) e.update(DT, world);
    const moved = Math.abs(e.x - x0) > 4;
    ok(moved, `${type} 会朝玩家移动`, `dx=${(e.x - x0).toFixed(1)}`);
  }

  // 蝙蝠应该会飞（有竖直方向的飘移）
  const bat = new Enemy("bat", p.cx + 50, p.cy - 30);
  world.enemies = [bat];
  const ys = [];
  for (let i = 0; i < 60; i++) { bat.update(DT, world); ys.push(bat.y); }
  const yRange = Math.max(...ys) - Math.min(...ys);
  ok(yRange > 3, "蝙蝠上下飘（不是直线平飞）", `y 变化范围 ${yRange.toFixed(1)}px`);

  // 石像鬼会蓄力冲撞：短时间内速度应该超过基础速度
  const g = new Enemy("gargoyle", p.cx + 80, p.cy);
  world.enemies = [g];
  let maxSpeed = 0;
  for (let i = 0; i < 60 * 5; i++) {
    g.update(DT, world);
    maxSpeed = Math.max(maxSpeed, Math.abs(g.vx));
  }
  ok(maxSpeed > g.def.speed * 2, "石像鬼会猛冲", `峰值 ${maxSpeed.toFixed(0)} vs 基础 ${g.def.speed}`);
}

// ---------------------------------------------------------------- 5. 回收
console.log("\n[5] 敌人会被回收，同屏数量有上限");
{
  const { world, p } = makeWorld();
  const spawner = new Spawner(() => 0.5);
  let peak = 0;

  // 模拟"边打边刷"：场上存活一直维持在 10 只左右
  for (let i = 0; i < 60 * 120; i++) {
    for (const e of spawner.update(DT, world, VIEW_W)) world.enemies.push(e);

    // 每 30 帧杀掉一只（模拟玩家清理）
    if (i % 30 === 0) {
      const victim = world.enemies.find((e) => !e.dead);
      if (victim) { victim.dead = true; victim.deadT = 0; }
    }

    world.enemies = world.enemies.filter((e) => !(e.dead && e.deadT > 0.6));
    peak = Math.max(peak, world.enemies.filter((e) => !e.dead).length);
  }

  console.log(`  2 分钟：刷了 ${spawner.spawned} 只，峰值在场 ${peak} 只`);
  ok(spawner.spawned > 30, "边打边刷能持续补充", `累计 ${spawner.spawned} 只`);
  ok(peak <= spawner.maxAlive, "同屏永不超上限", `峰值 ${peak} / 上限 ${spawner.maxAlive}`);

  // 反向验证：完全不杀，刷怪必须停下（否则会堆积到卡死）
  const w2 = makeWorld();
  const sp2 = new Spawner(() => 0.5);
  let n2 = 0;
  for (let i = 0; i < 60 * 120; i++) {
    const wave = sp2.update(DT, w2.world, VIEW_W);
    n2 += wave.length;
    w2.world.enemies.push(...wave);
  }
  console.log(`  完全不杀怪时：共生成 ${n2} 只（会被上限拦住）`);
  ok(n2 <= sp2.maxAlive + 2, "不杀怪时刷怪会停在上限附近", `${n2} 只，上限 ${sp2.maxAlive}`);
}

console.log("\n[5.5] 战斗循环成立：会打的人能活一阵");
{
  const { run, fightOnly, fightDash } = await import("./simcore.mjs");
  const a = run(fightOnly, 120, false, 2024);
  const b = run(fightDash, 120, false, 2024);
  console.log(`  只砍不躲：存活 ${a.deathT === null ? ">120" : a.deathT.toFixed(0)}s，杀 ${a.kills}`);
  console.log(`  砍+冲刺：存活 ${b.deathT === null ? ">120" : b.deathT.toFixed(0)}s，杀 ${b.kills}`);

  ok(a.kills > 10, "只砍不躲也能杀不少（攻击够得到）", `${a.kills} 只`);
  ok((a.deathT ?? 120) > 30, "不至于开局就被秒", `${(a.deathT ?? 120).toFixed(0)}s`);
  // 注：只有蓄力斩时，冲刺会打断蓄力，必然降低输出 —— 这是设计取舍，不列为断言。
}

console.log("\n[6] 连续跑 3 分钟不出错");
{
  const { world, p } = makeWorld();
  let seed = 12345;
  const spawner = new Spawner(() => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296));

  // 蓄力斩是唯一攻击，用"中距离游击"打法（和 simcore 一致）
  const input = {
    down: new Set(), just: new Set(), rel: new Set(),
    held(k) { return this.down.has(k); },
    pressed(k) { return this.just.has(k); },
    letGo(k) { return this.rel.has(k); },
    axis() { return (this.down.has("right") ? 1 : 0) - (this.down.has("left") ? 1 : 0); },
    apply(want) {
      this.just.clear();
      this.rel.clear();
      for (const k of want) if (!this.down.has(k)) this.just.add(k);
      for (const k of this.down) if (!want.has(k)) this.rel.add(k);
      this.down = new Set(want);
    },
  };

  const SAFE = 46;
  let err = null, maxOnScreen = 0;

  try {
    for (let i = 0; i < 60 * 180; i++) {
      for (const e of spawner.update(DT, world, VIEW_W)) world.enemies.push(e);

      const alive = world.enemies.filter((e) => !e.dead);
      const want = new Set();
      if (alive.length && p.state !== "dead") {
        const near = alive.reduce((x, y) => (Math.abs(x.cx - p.cx) < Math.abs(y.cx - p.cx) ? x : y));
        const dx = near.cx - p.cx, dist = Math.abs(dx);
        if (!p.slash) {
          if (dist < SAFE - 12) {
            want.add(dx > 0 ? "left" : "right");
            if (p.charging) want.add("heavy");
          } else {
            want.add("heavy");
            if (dist > 70) want.add(dx > 0 ? "right" : "left");
          }
        }
      }
      input.apply(want);
      p.update(DT, input, world);

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
      world.enemies = world.enemies.filter((e) => !(e.dead && e.deadT > 0.6) && Math.abs(e.cx - p.cx) < VIEW_W * 2.2);
      maxOnScreen = Math.max(maxOnScreen, world.enemies.filter((e) => !e.dead).length);
    }
  } catch (e) {
    err = e;
  }
  ok(!err, "3 分钟模拟没有抛错", err ? err.message : "");
  const aliveN = world.enemies.filter((e) => !e.dead).length;
  console.log(`  结束时：刷了 ${spawner.spawned} 只，场上存活 ${aliveN} 只，峰值 ${maxOnScreen} 只，玩家 hp ${p.hp.toFixed(0)}`);
  ok(spawner.spawned > 18, "怪物被持续补充（生成多于上限）", `生成 ${spawner.spawned} 只`);
  ok(aliveN > 0, "场上有活着的敌人", `${aliveN} 只`);
  ok(maxOnScreen <= 22, "同屏敌人数量有上限", `峰值 ${maxOnScreen}`);
}


console.log(fails === 0 ? "\n无尽模式检查全部通过" : `\n有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
