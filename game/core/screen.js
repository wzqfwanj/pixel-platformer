// 软件渲染画布：一块 Uint32 颜色缓冲 + 一块光照缓冲，最后一次性塞进 ImageData。
// 和 pixelfx 用同一套像素格式，所以特效帧可以直接贴进来。

import { hex, rgba, R, G, B, A, clamp } from "./util.js";

export class Surface {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.color = new Uint32Array(w * h);
    this.light = new Uint8ClampedArray(w * h * 3); // 叠加光，最后统一加到颜色上
  }

  clear(c = 0) {
    this.color.fill(c);
    this.light.fill(0);
  }
  clearLight() {
    this.light.fill(0);
  }

  px(x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.color[y * this.w + x] = c;
  }

  /** 半透明像素，a 是 0..1 */
  blendPx(x, y, c, a = 1) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = y * this.w + x, d = this.color[i], da = A(d) / 255, oa = a + da * (1 - a);
    if (oa <= 0) return;
    const k = a / oa, inv = 1 - k;
    const r = (R(c) * k + R(d) * inv) | 0, g = (G(c) * k + G(d) * inv) | 0, b = (B(c) * k + B(d) * inv) | 0;
    this.color[i] = rgba(r, g, b, (oa * 255) | 0);
  }

  rect(x, y, w, h, c) {
    x |= 0; y |= 0; w |= 0; h |= 0;
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(this.w, x + w), y1 = Math.min(this.h, y + h);
    for (let j = y0; j < y1; j++) this.color.fill(c, j * this.w + x0, j * this.w + x1);
  }

  /** 只画边框 */
  outline(x, y, w, h, c) {
    this.rect(x, y, w, 1, c); this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c); this.rect(x + w - 1, y, 1, h, c);
  }

  hline(x, y, w, c) { this.rect(x, y, w, 1, c); }
  vline(x, y, h, c) { this.rect(x, y, 1, h, c); }

  /** 一点叠加光（r/g/b 是 0..255 的增量） */
  addLight(x, y, r, g, b) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3, L = this.light;
    L[i] = Math.min(255, L[i] + r);
    L[i + 1] = Math.min(255, L[i + 1] + g);
    L[i + 2] = Math.min(255, L[i + 2] + b);
  }

  /** 圆盘形的叠加光，r 像素半径，边缘按 (1-d)² 衰减 */
  addGlow(cx, cy, r, cr, cg, cb) {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h, Math.ceil(cy + r));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy) / r;
        if (d >= 1) continue;
        const k = (1 - d) * (1 - d);
        this.addLight(x, y, cr * k, cg * k, cb * k);
      }
  }

  /**
   * ASCII 像素图：rows 是等长字符串数组，pal 把字符映射成颜色，'.' 与 ' ' 是透明。
   * opts: { flip } 水平翻转。
   */
  sprite(rows, pal, x, y, opts = {}) {
    const flip = !!opts.flip, w = rows[0].length;
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === "." || ch === " ") continue;
        const c = pal[ch];
        if (c === undefined) continue;
        const sx = x + (flip ? w - 1 - i : i);
        this.px(sx, y + j, c);
      }
    }
  }

  /**
   * 把一个 pixelfx 特效帧贴进来：先按 alpha 混合颜色，再把 light 累积到光照缓冲。
   * (x, y) 是这一帧左上角在屏幕上的位置。
   */
  blitEffect(frame, x, y, lift = 1) {
    const { w, h, color, light } = frame;
    for (let j = 0; j < h; j++) {
      const sy = y + j;
      if (sy < 0 || sy >= this.h) continue;
      for (let i = 0; i < w; i++) {
        const sx = x + i;
        if (sx < 0 || sx >= this.w || sx >= this.w) continue;
        const si = j * w + i, c = color[si], l = light[si] & 0xffffff;
        if (c) {
          const a = A(c);
          if (a >= 255) this.color[sy * this.w + sx] = c;
          else if (a > 0) this.blendPx(sx, sy, c, a / 255);
        }
        if (l) this.addLight(sx, sy, (l & 255) * lift, ((l >>> 8) & 255) * lift, ((l >>> 16) & 255) * lift);
      }
    }
  }

  /** 把颜色 + 光照合成到 RGBA 字节数组（ImageData 的 data） */
  composite(out) {
    const n = this.w * this.h, C = this.color, L = this.light;
    for (let i = 0; i < n; i++) {
      const c = C[i], a = A(c);
      let r = R(c), g = G(c), b = B(c);
      if (a < 255) {
        // 透明像素：让画布底色透出来（页面背景）
        const k = a / 255;
        r = r * k; g = g * k; b = b * k;
      }
      r += L[i * 3]; g += L[i * 3 + 1]; b += L[i * 3 + 2];
      const o = i * 4;
      out[o] = r > 255 ? 255 : r;
      out[o + 1] = g > 255 ? 255 : g;
      out[o + 2] = b > 255 ? 255 : b;
      out[o + 3] = a;
    }
    return out;
  }
}

/** 预先把一整张图烘到一块 Surface 里，之后只做拷贝 */
export function bake(w, h, draw) {
  const s = new Surface(w, h);
  draw(s);
  return s;
}

/**
 * 从大图上拷一块矩形到目标（忽略光照）。颜色 0 视为透明、跳过不写，
 * 这样"天空 -> 山 -> 关卡"可以一层层叠上去。
 */
export function blitRect(src, dst, sx, sy, sw, sh, dx, dy) {
  for (let j = 0; j < sh; j++) {
    const yy = dy + j, syy = sy + j;
    if (yy < 0 || yy >= dst.h || syy < 0 || syy >= src.h) continue;
    const x0 = Math.max(0, dx), x1 = Math.min(dst.w, dx + sw);
    const off = Math.max(0, sx + (x0 - dx));
    for (let x = x0; x < x1; x++) {
      const c = src.color[syy * src.w + off + (x - x0)];
      if (c) dst.color[yy * dst.w + x] = c;
    }
  }
}
