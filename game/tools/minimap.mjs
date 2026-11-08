// 小地图测试：验证它真的画了、位置正确、信息完整。
//
// 度量方式说明：
//   地形有台阶，同一行不可能连续 —— 所以不看"单行最长连续"，
//   而看"每一列有没有地形像素"（列覆盖率）。这才是剖面线是否完整的正确判据。
//
// 用法: node game/tools/minimap.mjs

import { Surface } from "../core/screen.js";
import { Level } from "../world/level.js";
import { Warrior } from "../entities/warrior.js";
import { Enemy } from "../entities/enemy.js";
import { FxLayer } from "../fx/fxlayer.js";
import { drawHud } from "../ui/hud.js";
import { setTheme } from "../core/theme.js";
import { buildArena } from "../world/arena.js";
import { hex } from "../core/util.js";

const fx = new FxLayer();
await fx.preload();

let fails = 0;
const ok = (cond, label, extra = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

const W = 320, H = 180;

function render(theme, { mode = "level", cam = null, enemies = [] } = {}) {
  setTheme(theme);
  const level = mode === "endless" ? new Level(buildArena().rows) : new Level();
  const p = new Warrior(level.spawn.x, level.spawn.y);
  const s = new Surface(W, H);
  s.clear(hex(theme === "dark" ? "#0b0812" : "#e8e8e8"));
  const camera = cam ?? { x: Math.min(level.pxW - W, Math.max(0, p.cx - W / 2)), y: Math.max(0, p.feet - 128) };
  drawHud(s, {
    player: p, coins: 0, coinTotal: 14, enemiesKilled: 0, combo: 0, comboTimer: 0,
    showHint: false, debug: false, won: false, fps: 60, fx,
    mode, level, cam: camera, enemies, time: 1,
  });
  return { s, level, p, cam: camera };
}

const pix = (s, x, y) => {
  const c = s.color[y * W + x];
  return { r: c & 255, g: (c >>> 8) & 255, b: (c >>> 16) & 255, raw: c };
};
const isDrawn = (s, x, y) => {
  const { r, g, b } = pix(s, x, y);
  return Math.max(r, g, b) > 60;
};

function findBox(s) {
  let best = { y: -1, x0: -1, len: 0 };
  for (let y = 2; y < 60; y++) {
    let run = 0, start = -1;
    for (let x = 200; x < W; x++) {
      if (isDrawn(s, x, y)) {
        if (run === 0) start = x;
        run++;
        if (run > best.len) best = { y, x0: start, len: run };
      } else run = 0;
    }
  }
  if (best.y < 0) return null;
  let bottom = best.y;
  for (let y = best.y; y < 60; y++) {
    let run = 0;
    for (let x = best.x0; x < best.x0 + best.len; x++) if (isDrawn(s, x, y)) run++;
    if (run > best.len * 0.8) bottom = y;
  }
  return { top: best.y, bottom, x0: best.x0, x1: best.x0 + best.len - 1, w: best.len, h: bottom - best.y + 1 };
}

/** 小地图内部区域（去掉 3px padding 和边框） */
const inner = (box) => ({ x0: box.x0 + 3, x1: box.x1 - 3, y0: box.top + 3, y1: box.bottom - 3 });

/**
 * 列覆盖率：内部每一列是否至少有一个地形像素。
 * 地形像素 = 不是 panel 底色、也不是"明显的高亮标记色"（避免把敌人/玩家当成地形）。
 */
function columnCoverage(s, box, theme) {
  const { x0, x1, y0, y1 } = inner(box);
  // 地形用 text/dim 色；标记用 accent。取"中等亮度"的像素当地形不够稳，
  // 干脆看"这一列有没有任何非底色像素"，只要覆盖率高就说明剖面是完整的。
  let covered = 0, total = 0;
  const colHas = [];
  for (let x = x0; x <= x1; x++) {
    total++;
    let has = false;
    for (let y = y0; y <= y1; y++) if (isDrawn(s, x, y)) { has = true; break; }
    colHas.push({ x, has });
    if (has) covered++;
  }
  return { covered, total, ratio: covered / total, colHas };
}

// ---------------------------------------------------------------- 1. 位置与尺寸
console.log("\n[1] 小地图的位置和尺寸");
{
  const { s } = render("dark");
  const box = findBox(s);
  ok(!!box, "找得到小地图外框");
  if (box) {
    console.log(`  外框 x ${box.x0}..${box.x1}, y ${box.top}..${box.bottom}（${box.w}x${box.h}）`);
    ok(box.x1 > W - 20, "贴在右边", `右边缘 x=${box.x1}`);
    ok(box.top <= 8, "小地图在最上面（贴顶）", `上边缘 y=${box.top}`);
    ok(box.bottom < H - 10, "没有超出屏幕", `底边 y=${box.bottom}`);
    ok(box.w > 60, "宽度够看", `${box.w} px`);
    ok(box.x0 > 80, "没有压到左上角的血条", `左边缘 x=${box.x0}`);

    // 文字必须在盒子下面（这是这次调整的重点）
    let textBelow = false;
    for (let y = box.bottom + 1; y < box.bottom + 14; y++)
      for (let x = box.x0; x <= box.x1; x++) {
        const { r, g, b } = pix(s, x, y);
        if (Math.max(r, g, b) > 60) { textBelow = true; break; }
      }
    ok(textBelow, "文字排在小地图下面", `小地图底边 y=${box.bottom}`);

    // 小地图上方不该有东西（它就该是最顶上的元素）
    let above = 0;
    for (let y = 0; y < box.top; y++)
      for (let x = box.x0; x <= box.x1; x++) if (isDrawn(s, x, y)) above++;
    ok(above === 0, "小地图上方没有其他内容", `${above} px`);
  }
}

// ---------------------------------------------------------------- 2. 剖面完整性
console.log("\n[2] 剖面线覆盖了整个关卡宽度");
{
  const { s, level } = render("dark");
  const box = findBox(s);
  const cov = columnCoverage(s, box, "dark");
  console.log(`  内部 ${cov.total} 列，有地形的 ${cov.covered} 列（${(cov.ratio * 100).toFixed(0)}%）`);

  // 关卡里有坑的列本来就不该有地形，先算坑占多少
  const tw = level.w;
  let pitCols = 0;
  for (let tx = 0; tx < tw; tx++) {
    let solid = false;
    for (let ty = 0; ty < level.h; ty++) if (level.at(tx, ty) === "#") solid = true;
    if (!solid) pitCols++;
  }
  const pitRatio = pitCols / tw;
  console.log(`  关卡里坑占 ${(pitRatio * 100).toFixed(0)}%，所以覆盖率应接近 ${(100 - pitRatio * 100).toFixed(0)}%`);

  // 覆盖率应该接近 1 - 坑比例（允许标记像素造成的个别空缺）
  ok(cov.ratio > 0.9 - pitRatio, "剖面覆盖率高（坑以外都有线）", `${(cov.ratio * 100).toFixed(0)}%`);
  ok(cov.ratio < 1.0, "确实有断口（坑的位置）", `${(cov.ratio * 100).toFixed(0)}%`);
}

// ---------------------------------------------------------------- 3. 坑的断口位置正确
console.log("\n[3] 断口位置和关卡里的坑对得上");
{
  const { s, level } = render("dark");
  const box = findBox(s);
  const cov = columnCoverage(s, box, "dark");
  const { x0, x1 } = inner(box);
  const mw = x1 - x0 + 1;
  const tw = level.w;

  // 对每一列，比较"小地图有没有地形" vs "关卡对应位置有没有地面"
  let match = 0, checked = 0;
  for (const { x, has } of cov.colHas) {
    const mx = x - x0;
    const tx0 = Math.floor((mx / mw) * tw);
    const tx1 = Math.max(tx0 + 1, Math.floor(((mx + 1) / mw) * tw));
    let solid = false, spiked = false;
    for (let tx = tx0; tx < tx1 && tx < tw; tx++) {
      for (let ty = 0; ty < level.h; ty++) {
        const c = level.at(tx, ty);
        if (c === "#") solid = true;
        if (c === "^") spiked = true;
      }
    }
    // 尖刺列会有额外像素，跳过
    if (spiked) continue;
    checked++;
    if (has === solid) match++;
  }
  const acc = match / Math.max(1, checked);
  console.log(`  抽查 ${checked} 列，${match} 列一致（${(acc * 100).toFixed(0)}%）`);
  ok(acc > 0.9, "小地图的空缺和关卡的坑一一对应", `${(acc * 100).toFixed(0)}%`);
}

// ---------------------------------------------------------------- 4. 玩家标记
console.log("\n[4] 玩家标记位置正确");
{
  const { s, p, level } = render("dark");
  const box = findBox(s);
  const { x0, x1 } = inner(box);
  const mw = x1 - x0 + 1;
  const expectX = x0 + Math.floor((p.cx / level.pxW) * mw);

  let best = null;
  for (let y = box.top + 2; y < box.bottom - 1; y++)
    for (let x = box.x0 + 2; x < box.x1 - 1; x++) {
      const { r, g, b } = pix(s, x, y);
      const lum = r + g + b;
      if (lum > 650 && (!best || lum > best.lum)) best = { x, y, lum };
    }
  ok(!!best, "找得到玩家标记");
  if (best) {
    console.log(`  玩家标记 (${best.x},${best.y})，按世界坐标算 x≈${expectX}`);
    ok(Math.abs(best.x - expectX) <= 3, "标记 x 和玩家世界坐标对应", `差 ${Math.abs(best.x - expectX)} px`);
  }
}

// ---------------------------------------------------------------- 5. 屏幕外敌人
console.log("\n[5] 屏幕外的敌人才在小地图上标出来");
{
  const level = new Level();
  const p = new Warrior(level.spawn.x, level.spawn.y);
  const cam = { x: 0, y: 128 };

  // 基线：没有敌人
  const base = render("dark", { cam, enemies: [] });
  const box = findBox(base.s);
  const { x0, x1, y0, y1 } = inner(box);
  const mw = x1 - x0 + 1, mh = y1 - y0 + 1;

  const colX = (enemy) => x0 + Math.floor((enemy.cx / level.pxW) * mw);

  const farEnemy = new Enemy("slime", cam.x + 900, p.feet);
  const nearEnemy = new Enemy("slime", cam.x + 100, p.feet);

  const withFar = render("dark", { cam, enemies: [farEnemy] });
  const withNear = render("dark", { cam, enemies: [nearEnemy] });

  const lumAt = (s, x, y) => { const { r, g, b } = pix(s, x, y); return r + g + b; };

  // 扫整列（±1），统计相对基线变亮的像素总数。不依赖纵向映射的具体公式。
  const columnDelta = (shot, cx) => {
    let total = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = cx - 1; x <= cx + 1; x++) {
        if (x < x0 || x > x1) continue;
        total += Math.max(0, lumAt(shot.s, x, y) - lumAt(base.s, x, y));
      }
    return total;
  };

  const cxFar = colX(farEnemy), cxNear = colX(nearEnemy);
  const deltaFar = columnDelta(withFar, cxFar);
  const deltaNear = columnDelta(withNear, cxNear);

  console.log(`  远处敌人所在列 x=${cxFar} 相对基线亮度增加 ${deltaFar}`);
  console.log(`  视野内敌人所在列 x=${cxNear} 相对基线亮度增加 ${deltaNear}`);
  ok(deltaFar > 100, "远处敌人会在小地图上标出来", `+${deltaFar}`);
  ok(deltaNear <= deltaFar, "视野内的敌人不重复标记", `+${deltaNear} vs +${deltaFar}`);
}

// ---------------------------------------------------------------- 6. 明暗主题
console.log("\n[6] 明暗两套主题下都可见");
{
  for (const theme of ["dark", "light"]) {
    const { s } = render(theme);
    const box = findBox(s);
    ok(!!box, `${theme} 主题下找得到小地图`);
    if (!box) continue;
    const colors = new Set();
    for (let y = box.top; y <= box.bottom; y++)
      for (let x = box.x0; x <= box.x1; x++) colors.add(s.color[y * W + x]);
    ok(colors.size >= 2, `${theme} 主题下有边框和地形两种以上颜色`, `${colors.size} 种`);

    const cov = columnCoverage(s, box, theme);
    ok(cov.ratio > 0.85, `${theme} 主题下剖面覆盖率高（看得见）`, `${(cov.ratio * 100).toFixed(0)}%`);
  }
}

// ---------------------------------------------------------------- 7. 无尽模式
console.log("\n[7] 无尽模式也有小地图");
{
  const { s } = render("dark", { mode: "endless" });
  const box = findBox(s);
  ok(!!box, "无尽模式有小地图");
  if (box) {
    const cov = columnCoverage(s, box, "dark");
    console.log(`  场地 ${cov.total} 列，有地形 ${cov.covered} 列（${(cov.ratio * 100).toFixed(0)}%）`);
    // 场地没有坑，应该接近全覆盖（允许玩家标记挖掉 1 列）
    ok(cov.ratio > 0.95, "场地剖面几乎全覆盖（无坑）", `${(cov.ratio * 100).toFixed(0)}%`);
  }
}

console.log(fails === 0 ? "\n小地图检查全部通过" : `\n有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
