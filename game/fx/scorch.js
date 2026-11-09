// 爆炸余温：ground-slam 的 heat(t) 在 0.8 秒后就归零，裂缝和火山口的红光全灭，
// 只剩暗色石头 —— 肉眼感觉"放一下就没了"。
//
// 上游库不改，在游戏层补一层"余温"：爆炸中心附近的地面持续泛暗红光，慢慢衰减。
// 这不是新特效，只是给地面加一点光照，成本极低（每帧几个圆的光晕计算）。

import { hex } from "../core/util.js";

const EMBER = hex("#ff5a1e");     // 余烬红
const SCORCH = hex("#3a1a18");    // 烧焦的暗红

export class ScorchLayer {
  constructor() {
    this.marks = [];
  }

  /**
   * 在地上留一块烧痕。
   * @param x,y  爆心（世界坐标，y 是地面线）
   * @param radius 半径
   * @param power  0..1，蓄力程度，决定余温强度
   * @param life   持续秒数
   */
  add(x, y, radius, power = 1, life = 1.6) {
    this.marks.push({
      x, y, radius,
      power,
      life,
      maxLife: life,
      // 每块烧痕给一点随机相位，多块叠加时不会整齐地一起闪
      phase: Math.random() * Math.PI * 2,
    });
    // 上限保护
    if (this.marks.length > 8) this.marks.shift();
  }

  update(dt) {
    for (const m of this.marks) m.life -= dt;
    this.marks = this.marks.filter((m) => m.life > 0);
  }

  /** 画在关卡之后、角色之前（烧痕属于地面） */
  draw(s, cam) {
    const camX = cam.x | 0, camY = cam.y | 0;
    for (const m of this.marks) {
      const t = m.life / m.maxLife;              // 1 -> 0
      // t: 1（刚生成）-> 0（消失）。pow(t, 0.55) 让尾巴拖长：
      // 前 1 秒掉得慢，最后 0.6 秒才快速收尾，肉眼能看清"地上留着一块烧痕"。
      const k = Math.pow(t, 0.35);
      if (k <= 0.01) continue;
      const r = m.radius * (0.55 + 0.45 * t);    // 略微收缩
      const cx = m.x - camX, cy = m.y - camY;
      if (cx < -r - 8 || cy < -r - 8 || cx > s.w + r + 8 || cy > s.h + r + 8) continue;

      // 地面上的暗红痕迹（颜色层，抖动淡化）
      const rr = Math.round(r);
      for (let dy = -rr * 0.25; dy <= rr * 0.25; dy += 1) {
        const halfW = Math.sqrt(Math.max(0, r * r - (dy * 4) * (dy * 4)));
        for (let dx = -halfW; dx <= halfW; dx += 1) {
          const d = Math.sqrt(dx * dx + (dy * 4) * (dy * 4)) / r;
          if (d > 1) continue;
          const edge = (1 - d) * k;
          // 用有序抖动做像素风淡化
          const bayer = ((Math.floor(dx) & 3) << 2) | (Math.floor(dy) & 3);
          const threshold = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][bayer] / 16;
          if (edge * 0.9 < threshold) continue;
          s.blendPx(cx + dx, cy + dy, SCORCH, edge * 0.85);
        }
      }

      // 余温的光（叠加到光照缓冲），中心亮边缘暗
      const flicker = 0.85 + Math.sin(m.life * 22 + m.phase) * 0.15;
      // 半径铺开到 1.6 倍：让光覆盖整个爆心区域，不只是中间一小块
      s.addGlow(cx, cy - r * 0.1, r * 1.6, 210 * k * flicker, 78 * k * flicker, 18 * k * flicker);
    }
  }

  clear() {
    this.marks.length = 0;
  }

  get count() {
    return this.marks.length;
  }
}
