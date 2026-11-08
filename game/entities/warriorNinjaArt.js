// 黑衣人的绘制层：把 Ninja Adventure（CC0）的 16x16 帧贴到游戏画布上。
//
// 素材只有 4 帧行走循环 + 各 1 帧攻击/跳跃/死亡，所以：
//   - 行走：真 4 帧循环（这是之前缺的）
//   - 攻击：单帧 + 身体倾斜/前冲，主要视觉重量交给 pixelfx 的刀光特效和命中定格
//   - 跳跃/下落：用 jump 帧 + 纵向拉伸
//
// 黑衣人在暗背景上的可见性问题：素材本身是深色的，如果再用深色描边会糊成一团。
// 所以描边改用亮灰色做"轮廓光"，让黑色剪影从暗背景里浮出来。

import { SpritePlate } from "../core/spriteplate.js";
import { hex } from "../core/util.js";
import { NINJA_W, NINJA_H, NINJA_PALETTE, NINJA_FRAMES } from "./ninjaFrames.js";

// 1 倍：素材 16x16 正好是一个图块的高度，和关卡比例一致。
// （之前试过 2 倍 = 32px = 两格高，视觉上比碰撞盒大太多，比例失调。）
export const NINJA_SCALE = 1;
const DW = NINJA_W * NINJA_SCALE;
const DH = NINJA_H * NINJA_SCALE;

const plate = new SpritePlate(DW + 2, DH + 2);

// 调色板 -> 颜色整数，只转一次
const PAL = NINJA_PALETTE.map((h) => hex(h));

// 描边颜色：亮灰，做轮廓光
const RIM = hex("#6f7488");
const RIM_FLASH = hex("#ffffff");

/** 把一帧的字符行解码成 [x, y, color] 列表（每帧只解一次，缓存） */
const cache = new Map();
function decode(rows) {
  const key = rows.join("|");
  let list = cache.get(key);
  if (list) return list;
  list = [];
  for (let y = 0; y < rows.length; y++) {
    const line = rows[y];
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      if (ch === "0") continue;
      const ci = parseInt(ch, 36) - 1;
      const c = PAL[ci];
      if (c === undefined) continue;
      list.push(x, y, c);
    }
  }
  cache.set(key, list);
  return list;
}

/**
 * 画一帧黑衣人。
 * @param s       目标画布
 * @param x,y     精灵左上角（屏幕坐标，已减相机）
 * @param facing  1 向右 / -1 向左
 * @param anim    "walk" | "attack" | "jump" | "dead"
 * @param frame   行走帧序号（0..3），其他动作用 0
 * @param opts    { tilt, stretch, lift, flash }
 */
export function drawNinja(s, x, y, facing, anim, frame, opts = {}) {
  const set = NINJA_FRAMES.right;      // 左右都用右向帧，靠 flip 镜像
  let rows;
  if (anim === "walk") rows = set.walk[((frame % 4) + 4) % 4];
  else rows = set[anim] ?? set.walk[0];
  if (!rows) return;

  const pts = decode(rows);
  const tilt = opts.tilt ?? 0;
  const stretch = opts.stretch ?? 1;
  const lift = Math.round(opts.lift ?? 0);
  const rimColor = opts.flash ? RIM_FLASH : RIM;

  plate.render((p) => {
    for (let i = 0; i < pts.length; i += 3) {
      const sx = pts[i], sy = pts[i + 1], c = pts[i + 2];
      // 纵向拉伸（以脚为基准）+ 倾斜（脚为支点，向上偏移递增），仍在 16x16 坐标里算
      const rel = NINJA_H - 1 - sy;
      const ty = Math.round(NINJA_H - 1 - rel * stretch);
      const shift = Math.round((tilt * rel) / NINJA_H * 3);
      const tx = sx + shift;
      if (tx < 0 || tx >= NINJA_W || ty < 0 || ty >= NINJA_H) continue;
      // 按 scale 铺成方块
      for (let ky = 0; ky < NINJA_SCALE; ky++)
        for (let kx = 0; kx < NINJA_SCALE; kx++)
          p.px(1 + tx * NINJA_SCALE + kx, 1 + ty * NINJA_SCALE + ky, c);
    }
  });

  // facing < 0 时镜像贴图；描边用亮灰做轮廓光
  plate.blit(s, x - 1, y - 1 - lift, true, rimColor, facing < 0);
}

export { NINJA_W, NINJA_H, DW as NINJA_DW, DH as NINJA_DH };
