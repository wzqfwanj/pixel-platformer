// 角色素材测试：确认从 Ninja Adventure（CC0）生成的黑衣人帧是完好的。
//
// 检查什么：
//   1. 帧数据尺寸正确（16x16）、调色板索引都在范围内
//   2. 行走 4 帧彼此不完全相同（是真循环，不是复制粘贴）
//   3. 攻击帧和行走帧不同（确实是另一个动作）
//   4. "黑衣人"：衣服色是深色（亮度低），且保留白色/肤色做对比
//   5. 左右翻转正确
//   6. 渲染出来不是空的
//
// 用法: node game/tools/ninja.mjs

import { Surface } from "../core/screen.js";
import { hex } from "../core/util.js";
import { drawNinja, NINJA_W, NINJA_H, NINJA_DW, NINJA_DH } from "../entities/warriorNinjaArt.js";
import { NINJA_FRAMES, NINJA_PALETTE } from "../entities/ninjaFrames.js";

let fails = 0;
const ok = (c, l, e = "") => { console.log(`  ${c ? "ok  " : "FAIL"} ${l}${e ? "  " + e : ""}`); if (!c) fails++; };

const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lum = (h) => { const [r, g, b] = rgb(h); return 0.3 * r + 0.6 * g + 0.1 * b; };

// ---------------------------------------------------------------- 1. 数据结构
console.log("\n[1] 帧数据完整性");
{
  ok(NINJA_W === 16 && NINJA_H === 16, "帧尺寸 16x16", `${NINJA_W}x${NINJA_H}`);
  const f = NINJA_FRAMES.right;
  ok(f.walk.length === 4, "行走 4 帧", `${f.walk.length}`);
  ok(!!f.attack && !!f.jump && !!f.dead, "攻击/跳跃/死亡帧齐全");

  let badLen = 0, badIdx = 0;
  const all = [...f.walk, f.attack, f.jump, f.dead];
  for (const frame of all) {
    if (frame.length !== NINJA_H) badLen++;
    for (const row of frame) {
      if (row.length !== NINJA_W) badLen++;
      for (const ch of row) {
        if (ch === "0") continue;
        const i = parseInt(ch, 36) - 1;
        if (!(i >= 0 && i < NINJA_PALETTE.length)) badIdx++;
      }
    }
  }
  ok(badLen === 0, "所有帧的宽高都是 16x16", badLen ? `${badLen} 处不符` : "");
  ok(badIdx === 0, "调色板索引都在范围内", badIdx ? `${badIdx} 处越界` : `${NINJA_PALETTE.length} 色`);
}

// ---------------------------------------------------------------- 2. 行走是真循环
console.log("\n[2] 行走循环的姿势是否真的在变");
{
  const w = NINJA_FRAMES.right.walk;
  const diff = (a, b) => {
    let n = 0;
    for (let y = 0; y < a.length; y++)
      for (let x = 0; x < a[y].length; x++) if (a[y][x] !== b[y][x]) n++;
    return n;
  };

  // 素材原画里第 0 帧和第 2 帧是同一张（走成 A-B-A-C 的四拍循环，每只脚各一步）。
  // 所以这里不要求 4 帧都不同，而是要求：相邻帧必须有差异，且至少有 3 个不同姿势。
  const uniq = new Set(w.map((f) => f.join("|")));
  ok(uniq.size >= 3, "至少有 3 个不同姿势（是真动画）", `${uniq.size} 种`);

  const d01 = diff(w[0], w[1]), d12 = diff(w[1], w[2]), d23 = diff(w[2], w[3]), d30 = diff(w[3], w[0]);
  console.log(`  相邻帧差异：0-1=${d01} 1-2=${d12} 2-3=${d23} 3-0=${d30} 像素`);
  ok(Math.min(d01, d12, d23, d30) > 3, "每一对相邻帧都有可见差异（不会卡帧）", `最小 ${Math.min(d01, d12, d23, d30)} px`);

  // 第 1 帧和第 3 帧必须和基础帧不同，否则等于没动
  ok(diff(w[0], w[1]) > 3 && diff(w[0], w[3]) > 3, "第 1、3 帧都与基础帧不同",
    `0-1=${diff(w[0], w[1])} 0-3=${diff(w[0], w[3])}`);

  // 记录一下 A-B-A-C 的事实，方便以后换素材时对照
  const same02 = diff(w[0], w[2]) === 0;
  console.log(`  备注：第 0 帧与第 2 帧${same02 ? "相同（原画的 A-B-A-C 四拍循环）" : "不同"}`);
}

console.log("\n[3] 攻击帧是独立动作");
{
  const f = NINJA_FRAMES.right;
  const diff = (a, b) => {
    let n = 0;
    for (let y = 0; y < Math.min(a.length, b.length); y++)
      for (let x = 0; x < a[y].length; x++) if (a[y][x] !== b[y][x]) n++;
    return n;
  };
  const d = diff(f.attack, f.walk[0]);
  console.log(`  攻击 vs 行走0：${d} 像素不同`);
  ok(d > 8, "攻击帧与行走帧明显不同", `${d} px`);

  // 跳跃和死亡也必须是独立姿势，不能悄悄复用了行走帧
  const dj = Math.min(diff(f.jump, f.walk[0]), diff(f.jump, f.walk[1]), diff(f.jump, f.walk[3]));
  const dd = Math.min(diff(f.dead, f.walk[0]), diff(f.dead, f.walk[1]), diff(f.dead, f.walk[3]));
  console.log(`  跳跃 vs 行走（最近的一帧）：${dj} px；死亡：${dd} px`);
  ok(dj > 8, "跳跃帧是独立姿势", `${dj} px`);
  ok(dd > 8, "死亡帧是独立姿势", `${dd} px`);
}

// ---------------------------------------------------------------- 4. 黑衣人配色
console.log("\n[4] 是「黑衣人」：主体深色 + 保留高光对比");
{
  // 统计每帧用到的主色
  const counts = new Map();
  const f = NINJA_FRAMES.right;
  for (const frame of [...f.walk, f.attack]) {
    for (const row of frame)
      for (const ch of row) {
        if (ch === "0") continue;
        const i = parseInt(ch, 36) - 1;
        counts.set(i, (counts.get(i) ?? 0) + 1);
      }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log("  主要颜色：");
  for (const [i, n] of sorted.slice(0, 5)) {
    const h = NINJA_PALETTE[i];
    console.log(`    ${h}  亮度 ${lum(h).toFixed(0)}  ${n} px`);
  }

  const main = NINJA_PALETTE[sorted[0][0]];
  ok(lum(main) < 110, "主体颜色是深色（读作黑）", `${main} 亮度 ${lum(main).toFixed(0)}`);

  // 必须有一个明显亮的颜色做对比（白面罩/肤色），否则暗背景上认不出来
  const brightest = NINJA_PALETTE.reduce((a, b) => (lum(a) > lum(b) ? a : b));
  ok(lum(brightest) > 150, "有亮色高光（面罩/皮肤）做对比", `${brightest} 亮度 ${lum(brightest).toFixed(0)}`);

  const contrast = lum(brightest) - lum(main);
  ok(contrast > 60, "明暗对比足够（暗背景上看得清）", `对比 ${contrast.toFixed(0)}`);
}

// ---------------------------------------------------------------- 5. 左右翻转
console.log("\n[5] 左右朝向");
{
  const s1 = new Surface(NINJA_DW + 6, NINJA_DH + 6);
  const s2 = new Surface(NINJA_DW + 6, NINJA_DH + 6);
  s1.clear(hex("#000000"));
  s2.clear(hex("#000000"));
  drawNinja(s1, 3, 3, 1, "walk", 0, {});
  drawNinja(s2, 3, 3, -1, "walk", 0, {});

  // 两者应该互为镜像
  let mismatched = 0, painted = 0;
  for (let y = 0; y < s1.h; y++)
    for (let x = 0; x < s1.w; x++) {
      const a = s1.color[y * s1.w + x];
      const b = s2.color[y * s2.w + (s1.w - 1 - x)];
      if (a || b) painted++;
      if (a !== b) mismatched++;
    }
  console.log(`  翻转后比对：${painted} 个非空像素，${mismatched} 处不匹配`);
  ok(painted > 100, "角色确实画出来了", `${painted} px`);
  ok(mismatched / Math.max(1, painted) < 0.02, "左右朝向是精确镜像", `${mismatched} 处差异`);
}

// ---------------------------------------------------------------- 6. 渲染非空
console.log("\n[6] 各动作都能渲染");
{
  for (const anim of ["walk", "attack", "jump", "dead"]) {
    const s = new Surface(NINJA_DW + 6, NINJA_DH + 6);
    s.clear(hex("#000000"));
    drawNinja(s, 3, 3, 1, anim, 0, {});
    let n = 0;
    for (let i = 0; i < s.color.length; i++) if (s.color[i]) n++;
    ok(n > 80, `${anim} 帧渲染非空`, `${n} px`);
  }
}

console.log(fails === 0 ? "\n角色素材检查全部通过" : `\n有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
