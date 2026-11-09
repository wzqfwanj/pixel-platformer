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

// ---------------------------------------------------------------- 5.8 蓄满特效在地面上看得见
console.log("\n[5.8] 地面上的对比度（之前的坑：尘土和地面同色，只有靠墙才看得见）");
{
  // 用干净的 FxLayer，避免前面用例残留的特效污染基准亮度
  const { FxLayer: FL8 } = await import("../fx/fxlayer.js");
  const fx8 = new FL8();
  await fx8.preload();
  const lvl8 = new Level();
  const p = new Warrior(lvl8.spawn.x, lvl8.spawn.y);
  const world = {
    level: lvl8, fx: fx8, enemies: [], player: p,
    shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() {}, respawnPlayer() {},
  };
  const idle = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0 };
  for (let i = 0; i < 20; i++) p.update(DT, idle, world);
  const H = p.cfg.heavy;

  // ground-slam 的尘土和碎石全部由 stone 参数派生。默认 #4a3f69 和地面图块
  // #414c6b 几乎同色，实测对比度只有 16 —— 尘土直接融进地面，
  // 只有靠墙时（背后是亮砖或天空）才看得出轮廓。这就是"只在墙角触发"的真相。
  const stoneHex = H.stoneColor;
  ok(typeof stoneHex === "string" && /^#[0-9a-f]{6}$/i.test(stoneHex), "配置了 stoneColor", stoneHex);

  const lumOf = (h) => {
    const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
    return 0.3 * r + 0.6 * g + 0.1 * b;
  };
  const GROUND_LUM = 66;   // 石头地面实测平均亮度
  const DEFAULT_STONE = "#4a3f69";
  const contrast = Math.abs(lumOf(stoneHex) - GROUND_LUM);
  const contrastDefault = Math.abs(lumOf(DEFAULT_STONE) - GROUND_LUM);
  console.log("  默认石头色亮度差 " + contrastDefault.toFixed(0) + "，现在 " + contrast.toFixed(0));
  ok(contrast > contrastDefault * 1.8,
    "石头色和地面的亮度差明显大于默认值（尘土不会融进地面）",
    contrast.toFixed(0) + " vs " + contrastDefault.toFixed(0));
  ok(contrast > 25, "亮度差够大（肉眼能分辨）", contrast.toFixed(0));

  // 真实渲染：蓄满爆炸后地面区域要被明显提亮
  const { Surface } = await import("../core/screen.js");
  const { hex } = await import("../core/util.js");
  const baked = lvl8.bake();
  const cam = { x: 0, y: 128 };
  const buf = new Surface(320, 180);
  buf.out = new Uint8ClampedArray(320 * 180 * 4);
  const lum = (r, g, b) => 0.3 * r + 0.6 * g + 0.1 * b;

  const render = () => {
    buf.clear(hex("#0b0812"));
    buf.clearLight();
    for (let y = 0; y < 180; y++)
      for (let x = 0; x < 320; x++) {
        const c = baked.color[(cam.y + y) * baked.w + (cam.x + x)];
        if (c) buf.px(x, y, c);
      }
    world.fx.drawBack(buf, cam);
    p.draw(buf, cam);
    world.fx.drawFront(buf, cam);
  };
  const groundLum = () => {
    let s = 0, n = 0;
    for (let y = 110; y < 175; y++)
      for (let x = 100; x < 220; x++) {
        const i = y * 320 + x;
        const c = buf.color[i], l = buf.light;
        s += lum(Math.min(255, (c & 255) + l[i * 3]),
                 Math.min(255, ((c >>> 8) & 255) + l[i * 3 + 1]),
                 Math.min(255, ((c >>> 16) & 255) + l[i * 3 + 2]));
        n++;
      }
    return s / n;
  };

  // 基准
  render();
  const base = groundLum();

  // 蓄满爆炸
  p.startCharge(world);
  const hold = holdHeavy(false);
  for (let i = 0; i < 60; i++) { if (!p.charging) break; p.update(DT, hold, world); }
  p.update(DT, holdHeavy(false, true), world);
  let guard = 0;
  while (p.slash && p.slash.phase === "windup" && guard++ < 30) p.update(DT, idle, world);

  let peak = 0;
  for (let f = 0; f < 40; f++) {
    p.update(DT, idle, world);
    world.fx.update(DT, cam);
    render();
    peak = Math.max(peak, Math.abs(groundLum() - base));
  }
  console.log("  地面亮度基准 " + base.toFixed(0) + "，爆炸后最大提亮 " + peak.toFixed(0));
  ok(peak > 20, "地面被明显提亮（地形变红看得见）", "+" + peak.toFixed(0));
}

// ---------------------------------------------------------------- 5.9 特效有足够长的可见时间
console.log("\n[5.9] 蓄满爆炸的可见时间（之前只有 1.3 秒，感觉\"放一下就没了\"）");
{
  // ground-slam 自身的 heat(t) 在 0.8 秒后归零，裂缝和火山口的红光全灭。
  // 游戏层补了 ScorchLayer（地上留烧痕 + 余温光），把可见时间拉到 3 秒以上。
  const { FxLayer: FL9 } = await import("../fx/fxlayer.js");
  const { ScorchLayer } = await import("../fx/scorch.js");
  const { Surface } = await import("../core/screen.js");
  const { hex } = await import("../core/util.js");
  const fx9 = new FL9();
  await fx9.preload();
  const scorch = new ScorchLayer();
  const lvl9 = new Level();
  const baked = lvl9.bake();
  const pl = new Warrior(lvl9.spawn.x, lvl9.spawn.y);
  const cam = { x: 0, y: 128 };
  const w = {
    level: lvl9, fx: fx9, scorch, enemies: [], player: pl,
    shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() {}, respawnPlayer() {},
  };
  const idl = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0 };
  for (let i = 0; i < 20; i++) pl.update(DT, idl, w);

  const buf = new Surface(320, 180);
  buf.out = new Uint8ClampedArray(320 * 180 * 4);
  const lum = (r, g, b) => 0.3 * r + 0.6 * g + 0.1 * b;
  const render = () => {
    buf.clear(hex("#0b0812"));
    buf.clearLight();
    for (let y = 0; y < 180; y++)
      for (let x = 0; x < 320; x++) {
        const c = baked.color[(cam.y + y) * baked.w + (cam.x + x)];
        if (c) buf.px(x, y, c);
      }
    scorch.draw(buf, cam);
    fx9.drawBack(buf, cam);
    pl.draw(buf, cam);
    fx9.drawFront(buf, cam);
  };
  const groundLum = () => {
    let s = 0, n = 0;
    for (let y = 110; y < 175; y++)
      for (let x = 100; x < 220; x++) {
        const i = y * 320 + x, c = buf.color[i], l = buf.light;
        s += lum(Math.min(255, (c & 255) + l[i * 3]),
                 Math.min(255, ((c >>> 8) & 255) + l[i * 3 + 1]),
                 Math.min(255, ((c >>> 16) & 255) + l[i * 3 + 2]));
        n++;
      }
    return s / n;
  };

  render();
  const base = groundLum();

  pl.startCharge(w);
  const hold = holdHeavy(false);
  for (let i = 0; i < 60; i++) { if (!pl.charging) break; pl.update(DT, hold, w); }
  pl.update(DT, holdHeavy(false, true), w);

  let firstVisible = -1, lastVisible = -1;
  for (let f = 0; f < 360; f++) {
    pl.update(DT, idl, w);
    fx9.update(DT, cam);
    scorch.update(DT);
    render();
    if (groundLum() - base > 8) {
      if (firstVisible < 0) firstVisible = f;
      lastVisible = f;
    }
  }
  const seconds = (lastVisible - firstVisible + 1) / 60;
  console.log("  地面提亮 >8 的时段: " + (firstVisible / 60).toFixed(2) + "s .. " +
    (lastVisible / 60).toFixed(2) + "s = " + seconds.toFixed(2) + " 秒");
  ok(seconds > 2.5, "可见时间超过 2.5 秒（不再\"放一下就没了\"）", seconds.toFixed(2) + "s");
}

// ---------------------------------------------------------------- 5.10 按键不会被吞
console.log("\n[5.10] 在爆炸动作 / hitLag 期间按 K 不能被吞掉");
{
  // 真凶："按 K 开始蓄力"原本在第 333 行，前面有 5 个提前 return
  //（死亡 / 受伤 / 蓄力中 / 爆炸动作 0.49s / 冲刺）。
  // 玩家在爆炸动作期间点按 K 会被完全忽略，看起来就是"只能释放一次"。
  // 更糟的是 hitLag（命中定帧）期间整个 player.update 被跳过，
  // input.endFrame() 又把 just 清掉 —— 那一帧的按键彻底消失。
  //
  // 修法：重攻击输入缓冲（0.6 秒），并且记录位置提到 main 的 hitLag 判断之前。

  const { FxLayer } = await import("../fx/fxlayer.js");
  const { ScorchLayer } = await import("../fx/scorch.js");
  const fl = new FxLayer();
  await fl.preload();
  const scorch = new ScorchLayer();
  const lvl = new Level();
  const p = new Warrior(lvl.spawn.x, lvl.spawn.y);
  let hitLagT = 0;
  const w = {
    level: lvl, fx: fl, scorch, enemies: [], player: p,
    shake() {}, hitLag(x) { hitLagT = Math.max(hitLagT, x); },
    onHit() {}, onEnemyKilled() {}, respawnPlayer() {},
  };
  const idl = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0 };
  for (let i = 0; i < 20; i++) p.update(DT, idl, w);

  const input = {
    down: new Set(), just: new Set(), rel: new Set(),
    held(a) { return this.down.has(a); },
    pressed(a) { return this.just.has(a); },
    letGo(a) { return this.rel.has(a); },
    axis() { return 0; },
    set(want) {
      this.just.clear(); this.rel.clear();
      for (const k of want) if (!this.down.has(k)) this.just.add(k);
      for (const k of this.down) if (!want.has(k)) this.rel.add(k);
      this.down = new Set(want);
    },
    endFrame() { this.just.clear(); this.rel.clear(); },
  };

  // 复刻 main.js 的 update 顺序（缓冲记录在 hitLag 之前）
  const step = (held) => {
    input.set(held ? new Set(["heavy"]) : new Set());
    if (input.pressed("heavy")) p.heavyBuffer = 0.6;   // main 里做的
    if (hitLagT > 0) {
      hitLagT -= DT;
      fl.update(DT * 0.12, { x: 0, y: 128 });
      scorch.update(DT * 0.12);
      input.endFrame();
      return false;
    }
    p.update(DT, input, w);
    fl.update(DT, { x: 0, y: 128 });
    scorch.update(DT);
    input.endFrame();
    return true;
  };

  // 场景：第 0-33 帧按住（蓄满释放），第 40-42 帧在 slash/hitLag 期间再点一次
  let releases = 0, lastSlash = null, presses = 0;
  for (let f = 0; f < 300; f++) {
    const held = f < 33 || (f >= 40 && f < 42);
    if (held && !input.down.has("heavy")) presses++;
    step(held);
    if (p.slash && !lastSlash) releases++;
    lastSlash = p.slash;
  }
  console.log("  按 K " + presses + " 次 → 释放 " + releases + " 次");
  ok(presses >= 2, "测试确实按了 2 次以上", String(presses));
  ok(releases >= presses, "每次按键都换来了释放（一个都没吞）", releases + "/" + presses);

  // 再测：极快点按（每 8 帧一下）
  const p2 = new Warrior(lvl.spawn.x, lvl.spawn.y);
  const w2 = { ...w, player: p2 };
  hitLagT = 0;
  for (let i = 0; i < 20; i++) p2.update(DT, idl, w2);
  let r2 = 0, pv = 0, last2 = null;
  for (let f = 0; f < 300; f++) {
    const held = f % 8 === 0;
    if (held && !input.down.has("heavy")) pv++;
    input.set(held ? new Set(["heavy"]) : new Set());
    if (input.pressed("heavy")) p2.heavyBuffer = 0.6;
    if (hitLagT > 0) { hitLagT -= DT; input.endFrame(); continue; }
    p2.update(DT, input, w2);
    input.endFrame();
    if (p2.slash && !last2) r2++;
    last2 = p2.slash;
  }
  console.log("  极快连点：按 K " + pv + " 次 → 释放 " + r2 + " 次");
  ok(r2 >= 5, "极快连点也能连续释放", r2 + " 次");
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
