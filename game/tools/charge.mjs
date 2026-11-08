import { readFileSync } from "node:fs";
// 蓄力机制 + 蓄力条测试。
//
// 检查什么：
//   1. 蓄力机制：按住 K 充能、松手释放、充满时间是 chargeMax
//   2. 蓄力条随进度变长（这是玩家唯一能看到的反馈）
//   3. 三段配色（冷白 / 橙金 / 红）在不同进度出现
//   4. 满蓄力有闪烁提示
//   5. 蓄力条在角色头顶、和角色不重叠
//   6. 明暗两套主题下都可见
//   7. 蓄力影响伤害（满蓄力比轻点重）
//
// 用法: node game/tools/charge.mjs

import { Surface } from "../core/screen.js";
import { hex } from "../core/util.js";
import { Level } from "../world/level.js";
import { Warrior } from "../entities/warrior.js";
import { Enemy } from "../entities/enemy.js";
import { FxLayer } from "../fx/fxlayer.js";
import { drawChargeBar } from "../ui/chargebar.js";
import { drawNinja, NINJA_DW, NINJA_DH } from "../entities/warriorNinjaArt.js";
import { setTheme } from "../core/theme.js";

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
  return { world, p, level };
}

const holdInput = (press = false, release = false) => ({
  down: release ? new Set() : new Set(["heavy"]),
  just: new Set(press ? ["heavy"] : []),
  held: (a) => !release && a === "heavy",
  pressed: (a) => press && a === "heavy",
  letGo: (a) => release && a === "heavy",
  axis: () => 0,
});

// ---------------------------------------------------------------- 1. 蓄力机制
console.log("\n[1] K 键蓄力机制");
{
  const { world, p } = makeWorld();
  ok(!p.charging, "初始没在蓄力");

  p.update(DT, holdInput(true), world);
  ok(p.charging, "按下 K 开始蓄力");
  ok(p.charge === 0 || p.charge < 0.05, "蓄力从 0 开始", `${p.charge.toFixed(3)}`);

  // 按住直到蓄满（蓄满会自动释放，所以只统计"蓄到满"用了几帧）
  const max = p.cfg.heavy.chargeMax;
  let frames = 0;
  const inp = holdInput(false);
  while (frames < 300) {
    p.update(DT, inp, world);
    frames++;
    if (p.charge >= max - 1e-6) break;
    if (!p.charging) break;
  }
  console.log(`  蓄到满用了 ${(frames * DT).toFixed(2)}s（配置 chargeMax = ${max}s）`);
  ok(Math.abs(frames * DT - max) < 0.06, "蓄力速度符合配置", `${(frames * DT).toFixed(2)}s vs ${max}s`);

  // 自动释放或松手，都不该继续蓄力
  p.update(DT, holdInput(false, true), world);
  ok(!p.charging, "蓄力已结束（自动释放或松手）");
}

// ---------------------------------------------------------------- 2. 蓄力条随进度变化
console.log("\n[2] 蓄力条随进度变长");
{
  setTheme("dark");
  const W = 30, H = 12;
  const s = new Surface(W, H);

  const fillWidthOf = (k) => {
    s.clear(0);
    drawChargeBar(s, W / 2, 10, k, 0.1);
    // 统计"填充色"像素数（非外框、非内底、非刻度）
    let n = 0;
    for (let i = 0; i < s.color.length; i++) {
      const c = s.color[i];
      if (!c) continue;
      const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
      // 填充色都是高饱和亮色：冷白(159,196,255) 橙(255,176,42) 红(255,74,48) 白(255,255,255)
      if (r > 140 && (b > 200 || g > 60)) n++;
    }
    return n;
  };

  const w0 = fillWidthOf(0);
  const w25 = fillWidthOf(0.25);
  const w50 = fillWidthOf(0.5);
  const w75 = fillWidthOf(0.75);
  const w100 = fillWidthOf(1);
  console.log(`  填充像素数：0%=${w0} 25%=${w25} 50%=${w50} 75%=${w75} 100%=${w100}`);
  ok(w0 === 0, "0% 时没有填充", `${w0}`);
  ok(w25 > w0 && w50 > w25 && w75 > w50 && w100 > w75, "填充随进度单调变长");
  // 100% 会闪烁成白色，像素数应接近满
  ok(w100 > 30, "100% 时接近填满", `${w100} px`);
}

// ---------------------------------------------------------------- 3. 三段配色
console.log("\n[3] 三段配色（冷白 / 橙金 / 红）");
{
  setTheme("dark");
  const W = 30, H = 12;
  const s = new Surface(W, H);

  const dominant = (k) => {
    s.clear(0);
    drawChargeBar(s, W / 2, 10, k, 0.1);
    const counts = new Map();
    for (let i = 0; i < s.color.length; i++) {
      const c = s.color[i];
      if (!c) continue;
      const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
      if (r > 140 && (b > 200 || g > 60)) {
        const key = `${r},${g},${b}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : "none";
  };

  const low = dominant(0.2), mid = dominant(0.6), high = dominant(0.95);
  console.log(`  20% 主色 rgb(${low})，60% rgb(${mid})，95% rgb(${high})`);
  ok(low !== mid && mid !== high, "三段颜色互不相同");

  const [lr, lg, lb] = low.split(",").map(Number);
  const [mr, mg, mb] = mid.split(",").map(Number);
  const [hr, hg, hb] = high.split(",").map(Number);
  ok(lb > lr, "低段偏冷（蓝 > 红）", `rgb(${low})`);
  ok(mr > mg && mg > mb, "中段偏橙金", `rgb(${mid})`);
  ok(hr > hg && hg < 100, "高段偏红", `rgb(${high})`);
}

// ---------------------------------------------------------------- 4. 满蓄力闪烁
console.log("\n[4] 满蓄力有闪烁提示");
{
  setTheme("dark");
  const W = 30, H = 12;
  const s = new Surface(W, H);
  const sample = (t) => {
    s.clear(0);
    drawChargeBar(s, W / 2, 10, 1.0, t);
    let white = 0;
    for (let i = 0; i < s.color.length; i++) {
      const c = s.color[i];
      if (!c) continue;
      if ((c & 255) > 230 && ((c >>> 8) & 255) > 230 && ((c >>> 16) & 255) > 230) white++;
    }
    return white;
  };
  // t 变化时白像素数量应该变化（在闪）
  const vals = [0, 0.05, 0.09, 0.13, 0.17, 0.21].map(sample);
  console.log(`  不同时刻的白色像素：${vals.join(" ")}`);
  ok(new Set(vals).size > 1, "满蓄力时确实在闪烁", `${[...new Set(vals)].length} 种状态`);
}

// ---------------------------------------------------------------- 5. 位置：头顶、不重叠
console.log("\n[5] 蓄力条在角色头顶且不重叠");
{
  setTheme("dark");
  const W = 32, H = 40;
  const s = new Surface(W, H);
  s.clear(0);

  const feetY = 34;
  const py = feetY - NINJA_DH;
  const cx = W / 2;

  drawNinja(s, Math.floor(cx - NINJA_DW / 2), py, 1, "walk", 0, {});
  // 记录角色像素的 y 范围
  const charRows = new Set();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (s.color[y * W + x]) charRows.add(y);

  s.clear(0);
  drawChargeBar(s, cx, py, 0.5, 0.1);
  const barRows = new Set();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (s.color[y * W + x]) barRows.add(y);

  const barMax = Math.max(...barRows), charMin = Math.min(...charRows);
  console.log(`  角色占 y ${Math.min(...charRows)}..${Math.max(...charRows)}，蓄力条占 y ${Math.min(...barRows)}..${barMax}`);
  ok(barMax < charMin, "蓄力条完全在角色上方（不遮挡角色）", `条底 y=${barMax}，角色顶 y=${charMin}`);
  const gap = charMin - barMax - 1;
  ok(gap >= 0 && gap <= 6, "和角色保持合理间距", `间距 ${gap}px`);
}

// ---------------------------------------------------------------- 6. 两套主题都可见
console.log("\n[6] 明暗两套主题下都可见");
{
  const W = 30, H = 12;
  const s = new Surface(W, H);
  for (const theme of ["dark", "light"]) {
    setTheme(theme);
    // 在主题对应背景下测试对比度
    const bg = theme === "dark" ? hex("#0b0812") : hex("#e8e8e8");
    s.clear(bg);
    drawChargeBar(s, W / 2, 10, 0.5, 0.1);

    let distinct = 0;
    for (let i = 0; i < s.color.length; i++) if (s.color[i] !== bg) distinct++;
    ok(distinct > 40, `${theme} 主题下蓄力条清晰可见`, `${distinct} px 非背景`);
  }
}

// ---------------------------------------------------------------- 7. 蓄力影响伤害
console.log("\n[7] 蓄力斩：伤害随蓄力提升");
{
  const test = (holdFrames) => {
    const { world, p } = makeWorld();
    // 放在正前方，确保在判定范围内
    const dummy = new Enemy("dummy", p.cx + 18, p.feet);
    dummy.update = () => {};
    world.enemies = [dummy];
    const hp0 = dummy.hp;

    p.update(DT, holdInput(true), world);
    const inp = holdInput(false);
    for (let i = 0; i < holdFrames; i++) p.update(DT, inp, world);
    const k = p.charge / p.cfg.heavy.chargeMax;
    p.update(DT, holdInput(false, true), world);
    const idle = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0 };
    for (let i = 0; i < 90; i++) p.update(DT, idle, world);
    return { dmg: hp0 - dummy.hp, k };
  };

  const light = test(3);
  const full = test(50);
  console.log(`  轻点（k=${light.k.toFixed(2)}）造成 ${light.dmg} 伤害；蓄满（k=${full.k.toFixed(2)}）造成 ${full.dmg} 伤害`);
  ok(light.dmg > 0, "轻点也有伤害", `${light.dmg}`);
  ok(full.dmg > light.dmg, "蓄满伤害更高", `${full.dmg} vs ${light.dmg}`);
}

// ---------------------------------------------------------------- 8. 横向判定
console.log("\n[8] 蓄力斩是横向判定（不是圆形范围）");
{
  const { world, p } = makeWorld();
  p.facing = 1;
  // 正前方 40px 处（横向）和一个在身后 10px 处的
  const front = new Enemy("dummy", p.cx + 40, p.feet);
  const behind = new Enemy("dummy", p.cx - 18, p.feet);
  const above = new Enemy("dummy", p.cx, p.feet - 60);
  for (const e of [front, behind, above]) e.update = () => {};
  world.enemies = [front, behind, above];
  const hp = { f: front.hp, b: behind.hp, a: above.hp };

  p.startCharge(world);
  const inp = holdInput(false);
  for (let i = 0; i < 50; i++) p.update(DT, inp, world);
  p.update(DT, holdInput(false, true), world);
  const idle = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0 };
  for (let i = 0; i < 60; i++) p.update(DT, idle, world);

  console.log(`  正前方：${hp.f} -> ${front.hp}（${hp.f - front.hp} 伤害）`);
  console.log(`  身后：  ${hp.b} -> ${behind.hp}（${hp.b - behind.hp} 伤害）`);
  console.log(`  高处：  ${hp.a} -> ${above.hp}（${hp.a - above.hp} 伤害）`);
  ok(front.hp < hp.f, "正前方的敌人被打中", `${hp.f - front.hp} 伤害`);
  ok(behind.hp === hp.b, "身后的敌人不受伤（是横向斩不是圆形）", "");
  ok(above.hp === hp.a, "高处的敌人不受伤", "");
}

// ---------------------------------------------------------------- 9. 穿透多个敌人
console.log("\n[9] 蓄力斩能打穿多个敌人");
{
  const { world, p } = makeWorld();
  p.facing = 1;
  // 一排三个
  const line = [
    new Enemy("dummy", p.cx + 20, p.feet),
    new Enemy("dummy", p.cx + 34, p.feet),
    new Enemy("dummy", p.cx + 46, p.feet),
  ];
  for (const e of line) e.update = () => {};
  world.enemies = line;
  const hp0 = line.map((e) => e.hp);

  p.startCharge(world);
  const inp = holdInput(false);
  for (let i = 0; i < 50; i++) p.update(DT, inp, world);
  p.update(DT, holdInput(false, true), world);
  const idle = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0 };
  for (let i = 0; i < 60; i++) p.update(DT, idle, world);

  const hit = line.filter((e, i) => e.hp < hp0[i]).length;
  console.log(`  一排 3 个敌人，被打中 ${hit} 个`);
  ok(hit >= 2, "一次能打中多个（穿透）", `${hit} / 3`);
}

// ---------------------------------------------------------------- 10. 蓄满打得更远
console.log("\n[10] 蓄满时攻击距离更远");
{
  const reachOf = (holdFrames) => {
    const { world, p } = makeWorld();
    p.facing = 1;
    // 放在较远处，只有蓄满才够得到
    const far = new Enemy("dummy", p.cx + 48, p.feet);
    far.update = () => {};
    world.enemies = [far];
    const hp0 = far.hp;
    p.startCharge(world);
    const inp = holdInput(false);
    for (let i = 0; i < holdFrames; i++) p.update(DT, inp, world);
    p.update(DT, holdInput(false, true), world);
    const idle = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0 };
    for (let i = 0; i < 60; i++) p.update(DT, idle, world);
    return hp0 - far.hp;
  };

  const dLight = reachOf(4);
  const dFull = reachOf(50);
  const H = new Warrior(0, 0).cfg.heavy;
  const reachLight = H.reachBase + H.reachPerCharge * (4 * DT / H.chargeMax);
  const reachFull = H.reachBase + H.reachPerCharge;
  console.log(`  48px 处的敌人：轻点造成 ${dLight}，蓄满造成 ${dFull}`);
  console.log(`  配置距离：轻点约 ${reachLight.toFixed(0)}px，蓄满 ${reachFull.toFixed(0)}px`);
  ok(reachFull > reachLight + 10, "蓄满的攻击距离明显更长", `${reachFull.toFixed(0)} vs ${reachLight.toFixed(0)}`);
  ok(dFull > 0, "蓄满能打到远处", `${dFull} 伤害`);
}

// ---------------------------------------------------------------- 11. 只有一个 K 技能
console.log("\n[11] K 键只有一个技能（蓄力斩）");
{
  const src = readFileSync(new URL("../entities/warrior.js", import.meta.url), "utf8");
  ok(!src.includes("doSlam"), "旧的砸地技能已移除", "");
  ok(!src.includes("slamOnLand"), "旧的下坠砸地已移除", "");
  ok(src.includes("doChargeSlash"), "蓄力斩实现存在", "");
  const { p } = makeWorld();
  // 现在只有一个攻击招式
  ok(!!p.cfg.heavy && p.cfg.heavy.id === "chargeSlash", "唯一的攻击是蓄力斩", p.cfg.heavy?.id);
  ok(!p.cfg.combo && !p.cfg.launcher && !p.cfg.air, "没有其他攻击招式", "");
}

console.log(fails === 0 ? "\n蓄力检查全部通过" : `\n有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
