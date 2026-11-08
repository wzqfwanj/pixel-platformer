// 攻击系统测试：现在只有一个攻击方式 —— K 键蓄力爆炸。
//
// 原来验证连招/上挑/空中斩的测试已经删掉（那些技能不存在了）。
// 这个文件专门确认：
//   1. 只有 K 能攻击，J（如果按了）不产生任何攻击
//   2. 蓄力爆炸能打中正前方的敌人
//   3. 蓄力过程、伤害、距离、穿透都正常
//   4. 完整的一轮：按住 -> 蓄满 -> 松手 -> 打中 -> 收招
//
// 用法: node game/tools/attack.mjs

import { readFileSync } from "node:fs";
import { Level } from "../world/level.js";
import { Warrior } from "../entities/warrior.js";
import { Enemy } from "../entities/enemy.js";
import { FxLayer } from "../fx/fxlayer.js";

const fx = new FxLayer();
await fx.preload();

let fails = 0;
const ok = (c, l, e = "") => { console.log(`  ${c ? "ok  " : "FAIL"} ${l}${e ? "  " + e : ""}`); if (!c) fails++; };

const DT = 1 / 60;

function makeWorld() {
  const level = new Level();
  const world = {
    level, fx, enemies: [], player: null,
    shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() {}, respawnPlayer() {},
    spawned: [],   // 记录放过哪些特效，用来检查蓄满用了 ground-slam
  };
  // 包一层 fx.spawn，把特效 id 记下来
  const realSpawn = fx.spawn.bind(fx);
  fx.spawn = (id, x, y, opts) => { world.spawned.push(id); return realSpawn(id, x, y, opts); };
  const p = new Warrior(level.spawn.x, level.spawn.y);
  world.player = p;
  const idle = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0 };
  for (let i = 0; i < 12; i++) p.update(DT, idle, world);
  return { world, p, level, idle, tick: () => {} };
}

const holdHeavy = (press = false, release = false) => ({
  down: release ? new Set() : new Set(["heavy"]),
  just: new Set(press ? ["heavy"] : []),
  held: (a) => !release && a === "heavy",
  pressed: (a) => press && a === "heavy",
  letGo: (a) => release && a === "heavy",
  axis: () => 0,
});

// ---------------------------------------------------------------- 1. 只剩一个攻击方式
console.log("\n[1] 攻击方式只有 K");
{
  const src = readFileSync(new URL("../entities/warrior.js", import.meta.url), "utf8");

  ok(!src.includes("combo: ["), "没有连招定义", "");
  ok(!src.includes("launcher: {"), "没有上挑定义", "");
  ok(!src.includes("startMove"), "没有连招派生方法", "");
  ok(!/this\.atk\b/.test(src), "没有旧的攻击状态", "");
  ok(src.includes("doChargeBlast"), "蓄力爆炸存在", "");

  // 输入映射里不应再有 attack
  const inpSrc = readFileSync(new URL("../core/input.js", import.meta.url), "utf8");
  ok(!inpSrc.includes('attack: ['), "输入映射里没有 attack 键", "");
  ok(inpSrc.includes('heavy: ["KeyK"'), "K 键还在", "");
}

// ---------------------------------------------------------------- 2. J 键无效
console.log("\n[2] 按 J 不产生攻击");
{
  const { world, p } = makeWorld();
  const dummy = new Enemy("dummy", p.cx + 18, p.feet);
  dummy.update = () => {};
  world.enemies = [dummy];
  const hp0 = dummy.hp;

  // 模拟按 J（input 里已经没有 attack 映射了，这里直接给一个不存在的动作名）
  const jInput = {
    down: new Set(["attack"]), just: new Set(["attack"]),
    held: (a) => a === "attack", pressed: (a) => a === "attack",
    letGo: () => false, axis: () => 0,
  };
  for (let i = 0; i < 60; i++) p.update(DT, jInput, world);

  ok(dummy.hp === hp0, "按 J 打不掉血", `${hp0} -> ${dummy.hp}`);
  ok(!p.charging && !p.slash, "按 J 不触发任何攻击状态", "");
}

// ---------------------------------------------------------------- 3. K 完整流程
console.log("\n[3] K 键完整流程：蓄力 -> 松手 -> 打中");
{
  const { world, p, idle } = makeWorld();
  const dummy = new Enemy("dummy", p.cx + 18, p.feet);
  dummy.update = () => {};
  world.enemies = [dummy];
  const hp0 = dummy.hp;

  p.update(DT, holdHeavy(true), world);
  ok(p.charging, "按下 K 开始蓄力", "");

  // 蓄到 90%（不触发自动释放），验证蓄力速率
  const max = p.cfg.heavy.chargeMax;
  const target = max * 0.9;
  let frames = 0;
  const inp = holdHeavy(false);
  while (p.charge < target && frames < 300) { p.update(DT, inp, world); frames++; }
  ok(Math.abs(frames * DT - target) < 0.05, "蓄力速率符合配置", `蓄到 ${target.toFixed(2)}s 用了 ${(frames * DT).toFixed(2)}s`);

  // 松手
  p.update(DT, holdHeavy(false, true), world);
  ok(!p.charging, "松手结束蓄力", "");
  ok(!!p.slash, "进入蓄力爆炸动作", "");

  // 走完动作
  for (let i = 0; i < 90; i++) p.update(DT, idle, world);
  ok(dummy.hp < hp0, "敌人被打中", `${hp0} -> ${dummy.hp}（${hp0 - dummy.hp} 伤害）`);
  ok(!p.slash, "动作结束后回到正常状态", p.state);
}

// ---------------------------------------------------------------- 3.5 蓄满自动释放
console.log("\n[3.5] 蓄满后自动释放（按住不放不会卡住）");
{
  const { world, p, idle } = makeWorld();
  const dummy = new Enemy("dummy", p.cx + 18, p.feet);
  dummy.update = () => {};
  world.enemies = [dummy];
  const hp0 = dummy.hp;

  // 一直按住不放（模拟玩家忘记松手）
  p.update(DT, holdHeavy(true), world);
  const inp = holdHeavy(false);
  for (let i = 0; i < 120; i++) p.update(DT, inp, world);   // 一直按着

  ok(!p.charging, "蓄满后自动停止蓄力（不会卡住）", `charging=${p.charging}`);
  ok(dummy.hp < hp0, "按住不放也能打出伤害", `${hp0} -> ${dummy.hp}`);
}

// ---------------------------------------------------------------- 4. 范围爆炸：四面都打到
console.log("\n[4] 范围爆炸：前后左右都打到");
{
  const { world, p, idle } = makeWorld();
  p.facing = 1;
  // 爆心在脚下，三个方向各放一个
  const specs = [
    { label: "右侧", dx: 30 },
    { label: "左侧（身后）", dx: -30 },
    { label: "右侧更远", dx: 44 },
  ];
  const enemies = specs.map((s) => {
    const e = new Enemy("dummy", p.cx + s.dx, p.feet);
    e.update = () => {};
    e._label = s.label;
    return e;
  });
  world.enemies = enemies;

  p.startCharge(world);
  const inp = holdHeavy(false);
  for (let i = 0; i < 50; i++) p.update(DT, inp, world);
  p.update(DT, holdHeavy(false, true), world);
  for (let i = 0; i < 90; i++) p.update(DT, idle, world);

  for (const e of enemies) console.log(`    ${e._label}: ${e.maxHp} -> ${e.hp}`);
  const hit = enemies.filter((e) => e.hp < e.maxHp).length;
  console.log(`  ${enemies.length} 个敌人，被打中 ${hit} 个`);
  ok(hit === 3, "范围内的敌人都被打中（含身后）", `${hit} / 3`);
  ok(enemies[1].hp < enemies[1].maxHp, "身后的也被打到（是圆形范围）", "");
}

// ---------------------------------------------------------------- 5. 距离衰减
console.log("\n[5] 越靠近爆心伤害越高");
{
  const { world, p, idle } = makeWorld();
  const near = new Enemy("dummy", p.cx + 6, p.feet);
  const far = new Enemy("dummy", p.cx + 44, p.feet);
  near.update = () => {};
  far.update = () => {};
  world.enemies = [near, far];

  p.startCharge(world);
  const inp = holdHeavy(false);
  for (let i = 0; i < 50; i++) p.update(DT, inp, world);
  p.update(DT, holdHeavy(false, true), world);
  for (let i = 0; i < 90; i++) p.update(DT, idle, world);

  const dNear = near.maxHp - near.hp;
  const dFar = far.maxHp - far.hp;
  console.log(`  近处(6px) ${dNear} 伤害，远处(44px) ${dFar} 伤害`);
  ok(dNear > 0 && dFar > 0, "两边都受伤", "");
  ok(dNear > dFar, "近处伤害更高（有距离衰减）", `${dNear} vs ${dFar}`);
}

// ---------------------------------------------------------------- 5.5 只有蓄满才放 ground-slam
console.log("\n[5.5] 蓄满才放 ground-slam（地形变红 + 石头飞溅）");
{
  // 蓄力到指定比例后引爆，返回这次放过哪些特效
  const spawnsAt = (k) => {
    const { world, p, idle } = makeWorld();
    p.startCharge(world);
    const inp = holdHeavy(false);
    const frames = Math.max(2, Math.round((k * p.cfg.heavy.chargeMax) / DT));
    for (let i = 0; i < frames; i++) p.update(DT, inp, world);
    p.update(DT, holdHeavy(false, true), world);
    for (let i = 0; i < 30; i++) p.update(DT, idle, world);
    return world.spawned.slice();
  };

  const light = spawnsAt(0.2);
  const full = spawnsAt(1.0);
  console.log("  轻蓄放过: " + light.join(", "));
  console.log("  蓄满放过: " + full.join(", "));

  ok(light.indexOf("explosions/dirt-explosion") >= 0, "轻蓄有土爆", "");
  ok(light.indexOf("impacts/ground-slam") < 0, "轻蓄不放 ground-slam", "");
  ok(full.indexOf("impacts/ground-slam") >= 0, "蓄满放 ground-slam", "");
}

// ---------------------------------------------------------------- 5.6 ground-slam 自带地形变化和飞石
console.log("\n[5.6] ground-slam 自带地形变红和石头飞溅");
{
  const mod = await import("../../pixelfx/src/fx/impacts/ground-slam.js");
  const meta = mod.meta;
  console.log("  name: " + meta.name);
  console.log("  size: " + JSON.stringify(meta.size) + "  dur: " + meta.duration);

  const pal = (meta.options && meta.options.palette) || [];
  const warm = pal.slice(1, 4).every((h) => {
    const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
    return r > b;
  });
  console.log("  调色板: " + pal.slice(0, 4).join(" ") + " -> " + (warm ? "暖色" : "冷色"));
  ok(warm, "调色板是红橙色系（地形看起来变红）", "");
  ok(meta.size[0] >= 200, "尺寸够大，能盖住一片地面", JSON.stringify(meta.size));

  // 渲染起手一帧，确认大量红色像素
  const { createFrame, clearFrame, createFx } = await import("../../pixelfx/src/core/fx.js");
  const w = meta.size[0], h = meta.size[1];
  const frame = createFrame(w, h);
  const fxo = createFx(mod, { x: meta.origin[0], y: meta.origin[1], seed: 7 });
  fxo.update(0.05);
  clearFrame(frame);
  fxo.draw(frame, "back");
  fxo.draw(frame, "front");

  let red = 0, total = 0;
  for (let i = 0; i < frame.color.length; i++) {
    const c = frame.color[i];
    if (!c) continue;
    total++;
    const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
    if (r > g * 1.25 && r > b * 1.25) red++;
  }
  const pct = total ? red / total * 100 : 0;
  console.log("  起手 0.05s：不透明 " + total + " px，偏红 " + red + " (" + pct.toFixed(0) + "%)");
  ok(pct > 10, "起手瞬间地形明显变红", pct.toFixed(0) + "%");
}



// ---------------------------------------------------------------- 5.7 连续蓄满不退化
console.log("\n[5.7] 连续蓄满 10 次，ground-slam 每次都要有");
{
  const { world, p, idle } = makeWorld();
  const slamsPerRound = [];
  const livePerRound = [];

  for (let round = 0; round < 10; round++) {
    // 等到空闲再蓄力
    for (let i = 0; i < 200 && (p.slash || p.charging || p.state === "attack"); i++) {
      p.update(DT, idle, world);
    }
    world.spawned.length = 0;

    p.startCharge(world);
    const hold = holdHeavy(false);
    for (let i = 0; i < 60; i++) {
      p.update(DT, hold, world);
      if (!p.charging) break;
    }
    // 推进到爆炸
    let guard = 0;
    while (p.slash && p.slash.phase === "windup" && guard++ < 30) p.update(DT, idle, world);
    p.update(DT, idle, world);

    slamsPerRound.push(world.spawned.filter((s) => s === "impacts/ground-slam").length);
    livePerRound.push(world.liveSameMax ?? 0);
    // 让特效走完，避免下一轮堆积
    for (let i = 0; i < 40; i++) p.update(DT, idle, world);
  }

  console.log("  每轮 ground-slam 次数: " + slamsPerRound.join(","));
  const allOne = slamsPerRound.every((n) => n === 1);
  ok(allOne, "连续 10 次蓄满，每次都放 ground-slam", slamsPerRound.join(","));

  // 同类特效并发上限（用干净的 FxLayer，避免受前面用例影响）
  const { FxLayer: FL } = await import("../fx/fxlayer.js");
  const fx2 = new FL();
  await fx2.preload();
  let peak = 0;
  // 按真实节奏：每次蓄满间隔约 1 秒，期间正常推进（淡出的会消失）
  for (let k = 0; k < 12; k++) {
    fx2.spawn("impacts/ground-slam", 104, 256, { seed: k, maxSame: 1 });
    for (let f = 0; f < 60; f++) {
      fx2.update(1 / 60, { x: 0, y: 128 });
      peak = Math.max(peak, fx2.live.filter((e) => e.id === "impacts/ground-slam").length);
    }
  }
  const live = fx2.live.filter((e) => e.id === "impacts/ground-slam").length;
  console.log("  连续放 12 个 ground-slam 后，同时存活 " + live + " 个（峰值 " + peak + "）");
  ok(peak <= 2, "同类大特效不会无限堆积（maxSame 生效）", "峰值 " + peak);
}

// ---------------------------------------------------------------- 6. 轻点 vs 蓄满
console.log("\n[6] 轻点和蓄满的差别");
{
  const run = (holdFrames) => {
    const { world, p, idle } = makeWorld();
    p.facing = 1;
    const dummy = new Enemy("dummy", p.cx + 18, p.feet);
    dummy.update = () => {};
    world.enemies = [dummy];
    p.startCharge(world);
    const inp = holdHeavy(false);
    for (let i = 0; i < holdFrames; i++) p.update(DT, inp, world);
    const k = p.charge / p.cfg.heavy.chargeMax;
    p.update(DT, holdHeavy(false, true), world);
    for (let i = 0; i < 90; i++) p.update(DT, idle, world);
    return { dmg: dummy.maxHp - dummy.hp, k };
  };
  const light = run(4);
  const full = run(50);
  console.log(`  轻点(k=${light.k.toFixed(2)}) ${light.dmg} 伤害；蓄满(k=${full.k.toFixed(2)}) ${full.dmg} 伤害`);
  ok(light.dmg > 0, "轻点有伤害", `${light.dmg}`);
  ok(full.dmg > light.dmg, "蓄满伤害更高", `${full.dmg} vs ${light.dmg}`);
}

// ---------------------------------------------------------------- 7. 空中也能放
console.log("\n[7] 空中也能放蓄力爆炸");
{
  const { world, p, idle } = makeWorld();
  p.facing = 1;
  p.y -= 40;
  p.onGround = false;
  p.vy = 0;
  p.startCharge(world);
  const inp = holdHeavy(false);
  for (let i = 0; i < 50; i++) p.update(DT, inp, world);
  p.update(DT, holdHeavy(false, true), world);
  ok(!!p.slash, "空中松手也能进入蓄力爆炸", "");
  for (let i = 0; i < 90; i++) p.update(DT, idle, world);
  ok(!p.slash, "动作能正常结束", p.state);
}

console.log(fails === 0 ? "\n攻击系统检查全部通过" : `\n有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
