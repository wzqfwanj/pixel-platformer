// 背景：黄昏天空 + 两层视差山脊 + 月亮，全部代码画，烘成两张可横向循环的图

import { hex, hash2, clamp } from "../core/util.js";
import { Surface } from "../core/screen.js";

// 黄昏：从上到下 —— 深紫夜空、紫红云带、橙红落日带、地平线下的暗红
const SKY_STOPS = [
  [0.00, "#141026"],
  [0.15, "#1e1436"],
  [0.28, "#2e1a42"],
  [0.38, "#4a2648"],
  [0.46, "#74404c"],
  [0.52, "#9c5040"],
  [0.56, "#c47448"],
  [0.63, "#a85a3e"],
  [0.76, "#6a3238"],
  [1.00, "#2a1a26"],
];

const FAR = hex("#2a2038");
const FAR_TOP = hex("#3a2c4a");
const NEAR = hex("#1a1428");
const NEAR_TOP = hex("#241a30");
const MOON = hex("#ffe8b0");
const MOON_HALO = hex("#5a4468");

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const PARALLAX_W = 640;

/** 天空本身（不含山），高度 = 屏幕高 */
export function bakeSky(w, h) {
  const s = new Surface(w, h);
  const stops = SKY_STOPS.map(([t, c]) => [t, hex(c)]);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
    const k = Math.max(0, Math.min(1, (t - t0) / Math.max(1e-6, t1 - t0)));
    const c = mix(c0, c1, k);
    for (let x = 0; x < w; x++) {
      // 有序抖动消除色带
      const d = (BAYER[((y & 3) << 2) | (x & 3)] / 16 - 0.5) * 0.012;
      s.px(x, y, mix2(c, d));
    }
  }
  // 星星
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(hash2(i, 1, 11) * w), y = Math.floor(hash2(i, 2, 13) * h * 0.5);
    const b = hash2(i, 3, 17);
    if (b > 0.72) s.px(x, y, hex("#e8e0ff"));
    else if (b > 0.5) s.px(x, y, hex("#8f88b0"));
  }
  // 月亮
  const mx = Math.floor(w * 0.78), my = Math.floor(h * 0.2), r = 13;
  for (let y = -r - 5; y <= r + 5; y++)
    for (let x = -r - 5; x <= r + 5; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d <= r) s.px(mx + x, my + y, MOON);
      else if (d <= r + 4) s.blendPx(mx + x, my + y, MOON_HALO, (1 - (d - r) / 4) * 0.35);
    }
  // 月面斑
  s.px(mx - 4, my - 3, hex("#e8cf90"));
  s.px(mx - 3, my - 2, hex("#e8cf90"));
  s.px(mx + 3, my + 4, hex("#e8cf90"));
  s.px(mx + 4, my + 5, hex("#e8cf90"));
  return s;
}

function mix(a, b, t) {
  const r = ((a & 255) + (((b & 255) - (a & 255)) * t)) | 0;
  const g = (((a >>> 8) & 255) + ((((b >>> 8) & 255) - ((a >>> 8) & 255)) * t)) | 0;
  const bl = (((a >>> 16) & 255) + ((((b >>> 16) & 255) - ((a >>> 16) & 255)) * t)) | 0;
  return ((255 << 24) | (bl << 16) | (g << 8) | r) >>> 0;
}
const mix2 = (c, d) => {
  const k = 1 + d;
  const r = clamp(((c & 255) * k) | 0, 0, 255), g = clamp((((c >>> 8) & 255) * k) | 0, 0, 255), b = clamp((((c >>> 16) & 255) * k) | 0, 0, 255);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};

/** 山脊：一条可横向循环的剪影条 */
function bakeRidge(w, h, seed, baseY, amp, cTop, cBody, step = 24) {
  const s = new Surface(w, h);
  const top = [];
  // 用几个正弦叠加出山形，并保证首尾接得上（周期 = w）
  for (let x = 0; x < w; x++) {
    const p = (x / w) * Math.PI * 2;
    const y = baseY
      + Math.sin(p * 3 + seed) * amp
      + Math.sin(p * 7 + seed * 2.3) * amp * 0.45
      + Math.sin(p * 13 + seed * 3.7) * amp * 0.22
      + hash2(x, seed, 5) * 2;
    top.push(Math.round(y));
  }
  for (let x = 0; x < w; x++) {
    const ty = top[x];
    for (let y = ty; y < h; y++) {
      const k = clamp((y - ty) / Math.max(1, h - ty), 0, 1);
      let c = k < 0.12 ? cTop : mix(cTop, cBody, Math.min(1, k * 1.6));
      // 岩石纹理
      if (hash2(x, y, seed) > 0.93) c = mix2(c, 0.12);
      s.px(x, y, c);
    }
    // 顶部高光
    s.px(x, ty, mix(cTop, hex("#c98a72"), 0.35));
  }
  return s;
}

/** 两层山，合成一张 640x180 的条带（远山与近山一起，方便一次拷贝） */
export function bakeHills(w, h) {
  const far = bakeRidge(w, h, 1.7, h * 0.66, h * 0.06, FAR_TOP, FAR);
  const near = bakeRidge(w, h, 4.2, h * 0.76, h * 0.075, NEAR_TOP, NEAR);
  const s = new Surface(w, h);
  // 远山：只铺下半部分
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = far.color[y * w + x];
      if (c) s.px(x, y, c);
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = near.color[y * w + x];
      if (c) s.px(x, y, c);
    }
  return s;
}
