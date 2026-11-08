// 给精灵加 1 像素深色描边：先画到透明的小画布上，再带描边贴到场景。
// 亮夕阳背景下，没有描边角色会糊在背景里。

import { Surface } from "./screen.js";
import { hex } from "./util.js";

const INK = hex("#100c18");

export class SpritePlate {
  constructor(w, h) {
    this.surf = new Surface(w, h);
    this.w = w;
    this.h = h;
  }

  /** 清空重画：drawFn(plate) 在 plate 的局部坐标里画 */
  render(drawFn) {
    this.surf.clear(0);
    drawFn(this.surf);
    return this.surf;
  }

  /**
   * 贴到目标画布 (dx, dy)，带 1 像素描边。
   * outline=false 时就是普通贴图。也可以给描边染色（受击闪白时用亮色）。
   */
  blit(dst, dx, dy, outline = true, inkColor = INK) {
    const src = this.surf, w = this.w, h = this.h;
    if (outline) {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (src.color[y * w + x]) continue;
          // 这个空格子的四邻有没有像素？有就涂描边
          const n =
            (x > 0 && src.color[y * w + x - 1]) ||
            (x < w - 1 && src.color[y * w + x + 1]) ||
            (y > 0 && src.color[(y - 1) * w + x]) ||
            (y < h - 1 && src.color[(y + 1) * w + x]);
          if (n) dst.px(dx + x, dy + y, inkColor);
        }
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = src.color[y * w + x];
        if (!c) continue;
        const a = (c >>> 24) & 255;
        if (a >= 250) dst.px(dx + x, dy + y, c);
        else if (a > 0) dst.blendPx(dx + x, dy + y, c, a / 255);
      }
  }
}
