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

  // 按住直到接近满
  const max = p.cfg.heavy.chargeMax;
  let frames = 0;
  const inp = holdInput(false);
  while (p.charge < max - 1e-6 && frames < 300) {
    p.update(DT, inp, world);
    frames++;
  }
  console.log(`  充满耗时 ${(frames * DT).toFixed(2)}s（配置 chargeMax = ${max}s）`);
  ok(Math.abs(frames * DT - max) < 0.05, "充满耗时符合配置", `${(frames * DT).toFixed(2)}s vs ${max}s`);
  ok(p.charge <= max + 1e-6, "蓄力不会超过上限", `${p.charge.toFixed(3)}`);

  // 松手释放
  p.update(DT, holdInput(false, true), world);
  ok(!p.charging, "松手结束蓄力");
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
console.log("\n[7] 蓄力越满，重砸伤害越高");
{
  const test = (holdFrames) => {
    const { world, p } = makeWorld();
    const dummy = new Enemy("dummy", p.cx + 20, p.feet);
    dummy.update = () => {};
    world.enemies = [dummy];
    const hp0 = dummy.hp;

    p.update(DT, holdInput(true), world);
    const inp = holdInput(false);
    for (let i = 0; i < holdFrames; i++) p.update(DT, inp, world);
    const k = p.charge / p.cfg.heavy.chargeMax;
    p.update(DT, holdInput(false, true), world);
    // 走完重砸动作
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

console.log(fails === 0 ? "\n蓄力检查全部通过" : `\n有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
