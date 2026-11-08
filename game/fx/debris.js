// 碎石飞溅：蓄满爆炸时从地面炸起来的小石块。
//
// 为什么自己写而不用 pixelfx 的特效：
//   pixelfx 的粒子是"画在特效帧里"的，跟着特效一起结束。
//   碎石需要【在世界里飞、落地、弹一下、再消失】——这要有自己的物理和生命周期，
//   而且落地点要跟随地形（掉坑里就该消失）。所以单独做一个轻量系统。
//
// 性能：上限 60 块，用对象池复用。每块只是一个 { x, y, vx, vy, size, life }，
// 没有分配压力。

import { hex } from "../core/util.js";
import { hash2 } from "../core/util.js";

const MAX = 60;

// 石头的三档灰度，随机挑一档让碎石有层次
const COLORS = [hex("#6b6a78"), hex("#8a8896"), hex("#4e4d59")];
const GLOW = hex("#ffb04a");   // 蓄满时碎石带余烬

class Chunk {
  constructor() {
    this.active = false;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.size = 1;
    this.life = 0;
    this.maxLife = 1;
    this.spin = 0;
    this.rot = 0;
    this.color = COLORS[0];
    this.hot = false;
  }
}

export class DebrisSystem {
  constructor() {
    this.pool = Array.from({ length: MAX }, () => new Chunk());
    this.cursor = 0;
  }

  get active() {
    let n = 0;
    for (const c of this.pool) if (c.active) n++;
    return n;
  }

  /**
   * 炸出一批碎石。
   * @param x,y    爆点（一般是角色脚下）
   * @param count  数量
   * @param power  0..1，蓄力程度。影响飞散速度和大小
   */
  burst(x, y, count, power = 1) {
    for (let i = 0; i < count; i++) {
      const c = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % MAX;

      // 均匀分布在 -PI..0（只往上飞），蓄力越足角度越散
      const spread = Math.PI * (0.65 + 0.35 * power);
      const ang = -Math.PI / 2 + (hash2(i, count, 3) - 0.5) * spread;
      const speed = (70 + hash2(i, count, 7) * 90) * (0.55 + 0.75 * power);

      c.active = true;
      c.x = x + (hash2(i, count, 11) - 0.5) * 10;
      c.y = y - 1;
      c.vx = Math.cos(ang) * speed;
      c.vy = Math.sin(ang) * speed;
      c.size = hash2(i, count, 13) > 0.55 ? 2 : 1;
      c.maxLife = 0.5 + hash2(i, count, 17) * 0.7;
      c.life = c.maxLife;
      c.spin = (hash2(i, count, 19) - 0.5) * 14;
      c.rot = 0;
      c.color = COLORS[Math.floor(hash2(i, count, 23) * COLORS.length) % COLORS.length];
      c.hot = power >= 0.85 && hash2(i, count, 29) > 0.55;
    }
  }

  update(dt, level) {
    const GRAV = 620;
    for (const c of this.pool) {
      if (!c.active) continue;

      c.life -= dt;
      if (c.life <= 0) { c.active = false; continue; }

      c.vy += GRAV * dt;
      c.rot += c.spin * dt;

      // 分轴移动 + 碰撞，避免高速穿墙
      const nx = c.x + c.vx * dt;
      if (!level.solidAt(nx, c.y)) c.x = nx;
      else c.vx *= -0.45;      // 撞墙反方向弹一点

      const ny = c.y + c.vy * dt;
      if (!level.solidAt(c.x, ny)) {
        c.y = ny;
      } else {
        // 落地：弹一下、快速耗尽
        if (c.vy > 60) {
          c.vy *= -0.32;
          c.vx *= 0.6;
        } else {
          c.vy = 0;
          c.vx *= 0.82;
          c.life = Math.min(c.life, 0.22);
        }
      }

      // 掉出地图就回收
      if (c.y > level.pxH + 20) c.active = false;
    }
  }

  draw(s, cam) {
    const camX = cam.x | 0, camY = cam.y | 0;
    for (const c of this.pool) {
      if (!c.active) continue;
      const sx = Math.round(c.x) - camX;
      const sy = Math.round(c.y) - camY;
      if (sx < -6 || sy < -6 || sx > s.w + 6 || sy > s.h + 6) continue;

      // 快消失时用抖动淡化（像素风不做真 alpha）
      const t = c.life / c.maxLife;
      if (t < 0.3 && (hash2(Math.floor(c.x), Math.floor(c.y), 41) > t / 0.3)) continue;

      if (c.size === 1) {
        s.px(sx, sy, c.color);
        // 带余烬的碎石点一颗亮色
        if (c.hot) s.addLight(sx, sy, 60, 30, 6);
      } else {
        // 2x2 石块，按旋转决定缺哪个角，看起来在翻
        const q = ((Math.floor(c.rot) % 4) + 4) % 4;
        s.px(sx, sy, c.color);
        if (q !== 0) s.px(sx + 1, sy, c.color);
        if (q !== 1) s.px(sx, sy + 1, c.color);
        s.px(sx + 1, sy + 1, c.color);
        if (c.hot) s.addLight(sx, sy, 80, 40, 8);
      }

      // 飞行中的碎石拖一点余烬光
      if (c.hot && c.vy < 0) s.addLight(sx, sy + 1, 30, 14, 4);
    }
  }

  clear() {
    for (const c of this.pool) c.active = false;
  }
}
