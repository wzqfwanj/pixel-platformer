// 从 Ninja Adventure 素材包（CC0）生成游戏用的黑衣人角色帧。
//
// 素材来源：https://github.com/pixel-boy/NinjaAdventure
//          Ninja Adventure Asset Pack by Pixel-Boy & AAA — CC0 1.0
//
// 精灵表布局（由 system/character/sprite_character.gd 确认）：
//   64x112，16x16 一格，4 列 x 7 行
//   列 = 朝向：0 下 / 1 上 / 2 左 / 3 右
//   行 = 动作：0-3 行走循环（4 帧）/ 4 攻击 / 5 跳跃 / 6 死亡
//
// 横版游戏只用"左/右"两列。为了让角色更像"黑衣人"，这里把原画的
// 蓝色/青色衣服重新映射成深灰黑色，保留白色面罩、肤色和红色腰带做对比。
//
// 输出：entities/ninjaFrames.js

import { writeFileSync } from "node:fs";
import { loadPNG } from "./pngread.mjs";

const SRC = process.argv[2] ?? "ref/samurai-blue.png";
const OUT = "entities/ninjaFrames.js";

const img = loadPNG(SRC);
const FW = 16, FH = 16;
const COL_RIGHT = 3, COL_LEFT = 2;

// ---- 颜色重映射：把彩色衣服改成黑色系
// 关键：不能全压成纯黑，否则站在暗背景上会糊成一团。
// 用三档深灰做出体积感，同时保留白面罩/肤色/红腰带的对比。
const REMAP = {
  // 原色 -> 新色
  "#79b8ce": "#42444e",   // 亮蓝衣服 -> 深灰（主色，保留极淡冷调以便和纯黑区分）
  "#548789": "#31333b",   // 青色 -> 更深的灰
  "#5f7160": "#373940",   // 绿灰 -> 深灰
  "#3b3643": "#232429",   // 深紫（甲片）-> 近黑
  "#4e484a": "#2c2d34",   // 灰褐 -> 深灰
  "#141b1b": "#0b0b0e",   // 描边 -> 更黑
  // 保留：肤色彩、白色、红色不做改动，角色才有辨识度
  "#f1c471": "#f1c471",
  "#ef914f": "#ef914f",
  "#f2eaf1": "#f2eaf1",
  "#d14b34": "#d14b34",
  "#9ba7aa": "#6e7480",   // 金属高光 -> 中灰
  "#e3f1f5": "#dfe3ea",
  "#a8a129": "#8a8522",
  "#56864c": "#2f4a2c",
  "#d78b4a": "#a86a38",
  "#8d977f": "#5a6154",
};

const remap = (r, g, b) => {
  const k = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  return REMAP[k] ?? k;
};

// ---- 裁出一帧，返回 16x16 的字符网格（用调色板索引）
function extract(col, row) {
  const cells = [];
  for (let y = 0; y < FH; y++) {
    const line = [];
    for (let x = 0; x < FW; x++) {
      const [r, g, b, a] = img.px(col * FW + x, row * FH + y);
      if (a < 20) { line.push(null); continue; }
      line.push(remap(r, g, b));
    }
    cells.push(line);
  }
  return cells;
}

// ---- 收集所有用到的颜色，建立索引
const colorSet = new Set();
const framesRaw = {};
for (const dir of ["right", "left"]) {
  const col = dir === "right" ? COL_RIGHT : COL_LEFT;
  framesRaw[dir] = {
    walk: [0, 1, 2, 3].map((row) => extract(col, row)),
    attack: extract(col, 4),
    jump: extract(col, 5),
    dead: extract(col, 6),
  };
  for (const group of [framesRaw[dir].walk, [framesRaw[dir].attack], [framesRaw[dir].jump], [framesRaw[dir].dead]]) {
    for (const f of group)
      for (const row of f)
        for (const c of row) if (c) colorSet.add(c);
  }
}

const palette = [...colorSet].sort();
const idx = new Map(palette.map((c, i) => [c, i]));

// 用 16 进制索引表示每个像素：0 = 透明，1..n = 调色板索引
const encodeFrame = (cells) =>
  cells.map((row) => row.map((c) => (c ? idx.get(c) + 1 : 0).toString(36)).join(""));

const build = (dir) => {
  const d = framesRaw[dir];
  return {
    walk: d.walk.map(encodeFrame),
    attack: encodeFrame(d.attack),
    jump: encodeFrame(d.jump),
    dead: encodeFrame(d.dead),
  };
};

const out = `// 由 game/tools/build-ninja-frames.mjs 自动生成，勿手改。
//
// 素材：Ninja Adventure Asset Pack by Pixel-Boy & AAA — CC0 1.0（可商用，无需署名）
//       https://github.com/pixel-boy/NinjaAdventure
//       https://pixel-boy.itch.io/ninja-adventure-asset-pack
//
// 源图里的蓝色/青色衣服已重映射为深灰黑色，做"黑衣人"造型；
// 白色面罩、肤色、红色腰带保持原样提供对比。
//
// 帧格式：16x16，每行 16 个字符，'0' = 透明，其他字符 = 调色板索引（base36，1 起）。

export const NINJA_W = ${FW};
export const NINJA_H = ${FH};

/** 调色板：#rrggbb，索引 = 字符值 - 1 */
export const NINJA_PALETTE = [
${palette.map((c) => `  "${c}",`).join("\n")}
];

const R = {
  walk: ${JSON.stringify(build("right").walk, null, 2).replace(/\n/g, "\n  ")},
  attack: ${JSON.stringify(build("right").attack, null, 2).replace(/\n/g, "\n  ")},
  jump: ${JSON.stringify(build("right").jump, null, 2).replace(/\n/g, "\n  ")},
  dead: ${JSON.stringify(build("right").dead, null, 2).replace(/\n/g, "\n  ")},
};

// 左向帧直接水平翻转右向帧即可（素材本身也提供了左向列，但翻转能保证像素完全对称）
export const NINJA_FRAMES = { right: R, left: R };
`;

writeFileSync(OUT, out);
console.log(`已写出 ${OUT}`);
console.log(`  调色板 ${palette.length} 色`);
console.log(`  行走 ${framesRaw.right.walk.length} 帧，攻击/跳跃/死亡各 1 帧，左右两向`);

// 验证一下输出能读回来
const check = await import("../" + OUT);
console.log(`  回读校验：${check.NINJA_W}x${check.NINJA_H}，调色板 ${check.NINJA_PALETTE.length}`);

// 渲染攻击帧确认重映射效果
console.log("\n攻击帧（重映射后，@=最深 .=最浅）：");
const frame = check.NINJA_FRAMES.right.attack;
const lumOf = (ch) => {
  if (ch === "0") return -1;
  const i = parseInt(ch, 36) - 1;
  const h = check.NINJA_PALETTE[i];
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return 0.3 * r + 0.6 * g + 0.1 * b;
};
const CH = "@#%*+=-:. ";
for (const row of frame) {
  let line = "";
  for (const ch of row) {
    const l = lumOf(ch);
    line += l < 0 ? " " : CH[Math.min(9, Math.floor((l / 255) * 10))];
  }
  console.log("  " + line);
}
