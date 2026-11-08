// 基础设施：颜色、数学、随机数
// 颜色统一用 0xAABBGGRR 的 32 位整数（和 pixelfx 一致，直接写进 Uint32Array 就是 RGBA 字节序）

export const hex = (s) => {
  if (typeof s === "number") return s;
  let h = s.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};
export const rgba = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
export const R = (c) => c & 255, G = (c) => (c >>> 8) & 255, B = (c) => (c >>> 16) & 255, A = (c) => (c >>> 24) & 255;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

// 确定性随机：同一个种子每次一样，方便复现
export const rng = (seed = 1) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};
// 二维哈希，做砖块的纹理变化用（不需要连续随机，只要每格固定）
export const hash2 = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------------- 缓动 ----------------
// 手感全靠这几个曲线：出刀用 easeOutCubic（爆发式开始、末端减速）才有"啪"的脆感；
// 收招用 easeOutQuad 慢慢回位。全部 linear 的话动作会很机械。

export const easeInQuad = (t) => t * t;
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * 指数平滑：帧率无关的"朝目标靠拢"。
 * tau 是时间常数（秒），越小越跟手。用它做姿态混合，状态切换就不会硬切。
 */
export const damp = (current, target, tau, dt) => {
  if (tau <= 0) return target;
  return target + (current - target) * Math.exp(-dt / tau);
};

/** 角度平滑：沿最短弧走，避免 2π 跳变导致手臂突然绕一圈 */
export const dampAngle = (current, target, tau, dt) => {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + d * (1 - Math.exp(-dt / tau));
};

export const aabb = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
