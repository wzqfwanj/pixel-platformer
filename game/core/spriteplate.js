// 给精灵加 1 像素描边：先画到透明的小画布上，再带描边贴到场景。
// 亮背景下没有描边角色会糊在背景里；暗背景下的深色角色则要用亮描边（轮廓光）浮出来。

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
   * @param outline   是否画描边
   * @param inkColor  描边颜色（深色角色用亮色做轮廓光）
   * @param flip      是否水平镜像
   */
  blit(dst, dx, dy, outline = true, inkColor = INK, flip = false) {
    const src = this.surf, w = this.w, h = this.h;
    // 镜像时 x 索引反过来
    const sx = (x) => (flip ? w - 1 - x : x);

    if (outline) {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (src.color[y * w + sx(x)]) continue;
          // 这个空格子的四邻有没有像素？有就涂描边
          const n =
            (x > 0 && src.color[y * w + sx(x - 1)]) ||
            (x < w - 1 && src.color[y * w + sx(x + 1)]) ||
            (y > 0 && src.color[(y - 1) * w + sx(x)]) ||
            (y < h - 1 && src.color[(y + 1) * w + sx(x)]);
          if (n) dst.px(dx + x, dy + y, inkColor);
        }
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = src.color[y * w + sx(x)];
        if (!c) continue;
        const a = (c >>> 24) & 255;
        if (a >= 250) dst.px(dx + x, dy + y, c);
        else if (a > 0) dst.blendPx(dx + x, dy + y, c, a / 255);
      }
  }
}
