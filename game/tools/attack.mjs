// 攻击系统测试：现在只有一个攻击方式 —— K 键蓄力斩。
//
// 原来验证连招/上挑/空中斩的测试已经删掉（那些技能不存在了）。
// 这个文件专门确认：
//   1. 只有 K 能攻击，J（如果按了）不产生任何攻击
//   2. 蓄力斩能打中正前方的敌人
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
  const world = { level, fx, enemies: [], player: null, shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() {}, respawnPlayer() {} };
  const p = new Warrior(level.spawn.x, level.spawn.y);
  world.player = p;
  const idle = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0 };
  for (let i = 0; i < 12; i++) p.update(DT, idle, world);
  return { world, p, level, idle };
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
  ok(src.includes("doChargeSlash"), "蓄力斩存在", "");

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
  ok(!!p.slash, "进入蓄力斩动作", "");

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

// ---------------------------------------------------------------- 4. 一次能打多个
console.log("\n[4] 一次打穿多个敌人");
{
  const { world, p, idle } = makeWorld();
  p.facing = 1;
  const line = [20, 34, 46].map((dx) => {
    const e = new Enemy("dummy", p.cx + dx, p.feet);
    e.update = () => {};
    return e;
  });
  world.enemies = line;

  p.startCharge(world);
  const inp = holdHeavy(false);
  for (let i = 0; i < 50; i++) p.update(DT, inp, world);
  p.update(DT, holdHeavy(false, true), world);
  for (let i = 0; i < 90; i++) p.update(DT, idle, world);

  const hit = line.filter((e) => e.hp < e.maxHp).length;
  console.log(`  3 个敌人，被打中 ${hit} 个`);
  ok(hit === 3, "全部命中（穿透）", `${hit} / 3`);
}

// ---------------------------------------------------------------- 5. 判定方向
console.log("\n[5] 只打前方，不打身后");
{
  const { world, p, idle } = makeWorld();
  p.facing = 1;
  const front = new Enemy("dummy", p.cx + 30, p.feet);
  const behind = new Enemy("dummy", p.cx - 20, p.feet);
  front.update = () => {};
  behind.update = () => {};
  world.enemies = [front, behind];

  p.startCharge(world);
  const inp = holdHeavy(false);
  for (let i = 0; i < 50; i++) p.update(DT, inp, world);
  p.update(DT, holdHeavy(false, true), world);
  for (let i = 0; i < 90; i++) p.update(DT, idle, world);

  ok(front.hp < front.maxHp, "前方敌人受伤", `${front.maxHp - front.hp} 伤害`);
  ok(behind.hp === behind.maxHp, "身后敌人不受伤", "");
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
console.log("\n[7] 空中也能放蓄力斩");
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
  ok(!!p.slash, "空中松手也能进入蓄力斩", "");
  for (let i = 0; i < 90; i++) p.update(DT, idle, world);
  ok(!p.slash, "动作能正常结束", p.state);
}

console.log(fails === 0 ? "\n攻击系统检查全部通过" : `\n有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
