// 战士的像素画：代码画的，靠姿势参数驱动（跑动相位、挥砍角度、受击闪白）。
// 精灵 26x26，脚底在第 25 行，身体中心在 lx=10，右边留出来给剑挥砍。

import { hex } from "../core/util.js";

const C = {
  ink: hex("#100d18"),
  steelD: hex("#2b3348"),
  steel: hex("#4a5570"),
  steelL: hex("#7d8cb0"),
  steelXL: hex("#c2cee6"),
  clothD: hex("#5e1018"),
  cloth: hex("#a82430"),
  clothL: hex("#e06250"),
  skin: hex("#f0c49a"),
  skinD: hex("#c98b6a"),
  gold: hex("#e8b424"),
  goldD: hex("#a86408"),
  blade: hex("#e8f0ff"),
  bladeD: hex("#8f9dc0"),
  hilt: hex("#6a4426"),
  white: hex("#ffffff"),
  bladeGlow: hex("#ffffff"),
  bladeTrail: hex("#9fd8ff"),
};

export const WARRIOR_W = 26;
export const WARRIOR_CX = 10;  // 身体中心在精灵内的 x
export const WARRIOR_H = 26;

/**
 * pose:
 *   legs: "stand" | "run" | "jump" | "fall" | "attack" | "dead"
 *   phase: 0..3 跑步相位
 *   sword: 挥砍角度（弧度，0 = 指向右，正值向下）
 *   bob / lean: 身体上下、前倾
 *   flash: 受击闪白
 *   charge: 0..1 蓄力
 */
export function drawWarrior(s, x, y, facing, pose) {
  const flip = facing < 0;
  const flash = !!pose.flash;
  // 本地坐标 -> 屏幕（flip 时以精灵中线镜像）
  const put = (lx, ly, c) => s.px(flip ? x + WARRIOR_W - 1 - lx : x + lx, y + ly, flash ? C.white : c);
  const rect = (lx, ly, w, h, c) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(lx + i, ly + j, c);
  };
  const line = (x0, y0, x1, y1, c, thick = 1) => {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy;
    for (;;) {
      for (let t = 0; t < thick; t++) put(x0, y0 + t, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  };

  // 姿态里全是浮点，取整只在真正落笔时做一次，避免每层各舍一次造成抖动
  const bob = Math.round(pose.bob ?? 0);
  const lean = Math.round(pose.lean ?? 0);
  const stretch = pose.stretch ?? 1;
  const CX = 10;          // 身体中心
  const legs = pose.legs ?? "stand";

  // ---------- 披风（压在最下面）
  if (legs !== "dead") {
    const ph = pose.flutter ?? 0;
    for (let j = 0; j < 10; j++) {
      const w = 6 - Math.floor(j / 4);
      const off = Math.round(Math.sin(ph * 5 + j * 0.45) * 1.4) + Math.floor(j / 4);
      const top = 10 + j + bob;
      for (let i = 0; i < w; i++) {
        const lx = CX - 3 - off + i - 2;
        put(lx, top, i === 0 || i === w - 1 ? C.ink : C.clothD);
      }
    }
  }

  // ---------- 腿
  const legY = 18 + bob;
  if (legs === "dead") {
    rect(CX - 5, 22, 11, 2, C.steelD);
    rect(CX - 6, 24, 13, 2, C.ink);
  } else if (legs === "run") {
    // 连续相位：sin 曲线驱动，60fps 下每一帧都在动，不会"跳步"
    const ph = pose.phase ?? 0;                 // 0..4 浮点
    const a = (ph / 4) * Math.PI * 2;
    const swing = Math.sin(a) * 3.2;            // -3.2..3.2
    const lift = Math.max(0, Math.sin(a * 2)) * 1.3;

    // 后腿（相位相反）
    const bSwing = -swing;
    const bx = Math.round(CX - 2 + Math.min(0, bSwing));
    const bl = Math.round(lift * Math.max(0, Math.sin(a * 2 + Math.PI)));
    rect(bx, legY + bl, 3, 6 - bl, C.steelD);
    rect(bx - 1, legY + 6, 4, 2, C.ink);

    // 前腿
    const fx = Math.round(CX + 1 + Math.max(0, swing));
    const fl = Math.round(Math.max(0, Math.sin(a * 2)) * 1.3);
    rect(fx, legY + fl, 3, 6 - fl, C.steel);
    rect(fx - 1, legY + 6, 4, 2, C.ink);
  } else if (legs === "jump" || legs === "fall") {
    const up = legs === "jump" ? 1 : 0;
    rect(CX - 3, legY - 1 - up, 3, 6, C.steelD);
    rect(CX - 4, legY + 5 - up, 4, 2, C.ink);
    rect(CX + 1, legY + up, 3, 6, C.steel);
    rect(CX + 1, legY + 5 + up, 4, 2, C.ink);
  } else {
    rect(CX - 3, legY, 3, 7, C.steelD);
    rect(CX - 4, legY + 6, 4, 2, C.ink);
    rect(CX + 1 - lean, legY, 3, 7, C.steel);
    rect(CX, legY + 6, 4, 2, C.ink);
  }

  // ---------- 躯干（stretch > 1 时略微拉长，< 1 时压扁）
  const stretchOff = Math.round((stretch - 1) * 8);   // -1..1 左右
  const ty = 10 + bob - (stretchOff > 0 ? 0 : -stretchOff), tx = CX - 4 + lean;
  rect(tx, ty, 8, 8, C.steel);
  rect(tx, ty, 8, 1, C.steelL);
  rect(tx, ty, 1, 8, C.steelD);
  rect(tx + 7, ty, 1, 8, C.steelD);
  // 红色战袍
  rect(tx + 2, ty + 2, 4, 6, C.cloth);
  rect(tx + 2, ty + 2, 1, 6, C.clothD);
  rect(tx + 5, ty + 2, 1, 6, C.clothL);
  // 腰带
  rect(tx, ty + 7, 8, 1, C.goldD);
  put(tx + 4, ty + 7, C.gold);
  // 肩甲
  rect(tx - 1, ty, 2, 3, C.steelL);
  put(tx - 1, ty, C.steelXL);
  put(tx - 1, ty + 2, C.ink);
  rect(tx + 7, ty, 2, 3, C.steelL);
  put(tx + 8, ty, C.steelXL);
  put(tx + 8, ty + 2, C.ink);

  // ---------- 头 / 头盔
  const hy = 2 + bob - Math.max(0, stretchOff), hx = CX - 3 + lean;
  rect(hx, hy, 6, 7, C.steel);
  rect(hx, hy, 6, 1, C.steelL);
  rect(hx, hy, 1, 7, C.steelD);
  rect(hx + 5, hy, 1, 7, C.steelD);
  // 面甲开口（朝前）
  rect(hx + 2, hy + 3, 4, 2, C.ink);
  put(hx + 3, hy + 3, C.skin);
  put(hx + 4, hy + 3, C.skin);
  put(hx + 4, hy + 4, C.skinD);
  // 护鼻
  put(hx + 2, hy + 3, C.steelL);
  put(hx + 2, hy + 4, C.steelL);
  // 盔顶与红缨
  rect(hx, hy - 1, 6, 1, C.steelD);
  put(hx + 2, hy - 3, C.clothL);
  put(hx + 1, hy - 2, C.cloth);
  put(hx + 2, hy - 2, C.clothL);
  put(hx + 1, hy - 1, C.clothD);
  // 脖子
  rect(hx + 2, hy + 7, 2, 1, C.skinD);

  // ---------- 后臂
  rect(tx - 2, ty + 2, 2, 5, C.steelD);
  put(tx - 1, ty + 6, C.skinD);

  // ---------- 刀光拖尾
  // 攻击判定期间，每帧把剑的角度记进 pose.trail。这里把历史角度逐层画成残影，
  // 越旧越淡、越短，视觉上连成一道弧 —— 像素游戏里"挥砍流畅"最关键的一招。
  if (pose.trail && pose.trail.length > 1) {
    const shX0 = tx + 8, shY0 = ty + 3;
    for (let gi = pose.trail.length - 1; gi >= 1; gi--) {
      const a = pose.trail[gi];
      const fade = 1 - gi / (pose.trail.length + 0.5);   // 0.5..0.9
      const hx0 = shX0 + Math.round(Math.cos(a) * 3);
      const hy0 = shY0 + Math.round(Math.sin(a) * 3);
      // 残影只画剑身中段到剑尖，越旧越短
      const len = 8 - gi * 1.2;
      for (let d = 3; d <= len; d += 1) {
        const px = hx0 + Math.round(Math.cos(a) * d);
        const py = hy0 + Math.round(Math.sin(a) * d);
        const sx = flip ? x + WARRIOR_W - 1 - px : x + px;
        s.blendPx(sx, y + py, gi === 1 ? C.bladeGlow : C.bladeTrail, fade * 0.55);
      }
    }
  }

  // ---------- 前臂 + 剑
  const ang = pose.sword ?? Math.PI / 2.2;
  const shX = tx + 8, shY = ty + 3;            // 肩点
  const elbowX = shX + Math.round(Math.cos(ang) * 2);
  const elbowY = shY + Math.round(Math.sin(ang) * 2);
  const handX = shX + Math.round(Math.cos(ang) * 3);
  const handY = shY + Math.round(Math.sin(ang) * 3);
  line(shX, shY, elbowX, elbowY, C.steelL, 2);
  line(elbowX, elbowY, handX, handY, C.steel, 2);
  put(handX, handY, C.skin);

  // 剑：剑柄 + 护手 + 双刃
  const bl = 8;
  const tipX = handX + Math.round(Math.cos(ang) * bl), tipY = handY + Math.round(Math.sin(ang) * bl);
  const gx = Math.cos(ang + Math.PI / 2), gy = Math.sin(ang + Math.PI / 2);
  put(Math.round(handX - gx), Math.round(handY - gy), C.gold);
  put(Math.round(handX + gx), Math.round(handY + gy), C.gold);
  // 刃：贴着剑身画亮面 + 一条暗面做出厚度
  line(handX, handY, tipX, tipY, C.blade);
  line(
    Math.round(handX + gx * 0.9), Math.round(handY + gy * 0.9),
    Math.round(tipX + gx * 0.9), Math.round(tipY + gy * 0.9),
    C.bladeD
  );
  put(tipX, tipY, C.white);

  // ---------- 蓄力光环
  if (pose.charge > 0) {
    const k = pose.charge;
    for (let i = 0; i < 6; i++) {
      const a = (k * 9 + i * 1.05) % (Math.PI * 2);
      const r = 10 + Math.sin(k * 12 + i) * 2;
      put(Math.round(CX + Math.cos(a) * r), Math.round(13 + bob + Math.sin(a) * r * 0.6), i % 2 ? C.gold : C.clothL);
    }
  }
}

export const WARRIOR_COLORS = C;
