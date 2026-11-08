// 用参考图转出来的 4 帧来画角色。
//
// 和 warriorArt.js 的程序化绘制是两套：这里只负责"把 REF_FRAMES 的第 N 帧贴上去"，
// 姿势参数（倾斜、纵向拉伸、翻转）由 pose() 驱动 —— 虽然只有 4 张图，
// 仍能表现跑动、跳跃、受击等状态，不至于完全僵硬。
//
// 注意颜色格式：Surface 用的是 0xAABBGGRR，必须经过 hex() 转换，
// 不能直接把 "#141021" 当整数用，否则红蓝会颠倒。

import { SpritePlate } from "../core/spriteplate.js";
import { hex } from "../core/util.js";
import { REF_FRAMES, REF_W, REF_H, REF_AXIS_X, REF_PALETTE } from "./refFrames.js";

// 描边留 1px，画布比精灵大 2
const plate = new SpritePlate(REF_W + 2, REF_H + 2);

// 调色板：字符串 -> 颜色整数，只转一次
const PAL = Object.fromEntries(Object.entries(REF_PALETTE).map(([k, v]) => [k, hex(v)]));

/**
 * 画一帧参考图角色。
 * @param s       目标画布
 * @param x,y     精灵左上角（屏幕坐标，已减相机）
 * @param facing  1 向右 / -1 向左
 * @param frame   0..3
 * @param opts    { tilt, stretch, lift }
 *                tilt   -1..1，以脚为支点的左右倾斜（整数像素偏移）
 *                stretch 0.85..1.15，纵向拉伸
 *                lift  向上偏移（跳跃用）
 */
export function drawRefWarrior(s, x, y, facing, frame, opts = {}) {
  const rows = REF_FRAMES[Math.max(0, Math.min(REF_FRAMES.length - 1, frame))];
  if (!rows) return;

  const tilt = opts.tilt ?? 0;
  const stretch = opts.stretch ?? 1;
  const lift = Math.round(opts.lift ?? 0);

  plate.render((p) => {
    // 逐行绘制：支持纵向拉伸 + 以脚为支点的倾斜
    for (let ry = 0; ry < rows.length; ry++) {
      // 源行 -> 目标行（以脚底为基准缩放）
      const rel = rows.length - 1 - ry;                    // 距脚底的行数
      const ty = Math.round(rows.length - 1 - rel * stretch);
      if (ty < 0 || ty >= REF_H + 2) continue;
      // 倾斜：越靠上偏移越大（脚为支点），取整保持像素干净
      const shift = Math.round((tilt * rel) / rows.length * 3);
      const row = rows[ry];
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx];
        if (ch === ".") continue;
        const c = PAL[ch];
        if (!c) continue;
        const tx = 1 + rx + shift;
        if (tx < 0 || tx >= REF_W + 2) continue;
        p.px(tx, 1 + ty, c);
      }
    }
  });

  plate.blit(s, x - 1, y - 1 - lift, true);
}

export { REF_AXIS_X, REF_W, REF_H };
