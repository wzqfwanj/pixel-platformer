// 用 pixelfx 自带的 3x5 / 5x7 像素字体写字（只有 ASCII，所以 HUD 用英文）

import { FONTS, textWidth, rasterText } from "../../pixelfx/src/core/font.js";

export function drawText(s, str, x, y, color, opts = {}) {
  const font = opts.font ?? "mini", k = opts.scale ?? 1;
  const w = textWidth(str, font) * k;
  let left = x;
  if (opts.align === "center") left = Math.round(x - w / 2);
  else if (opts.align === "right") left = Math.round(x - w);
  if (opts.shadow !== undefined) {
    rasterText(str, font, (gx, gy) => {
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s.px(left + gx * k + i + 1, y + gy * k + j + 1, opts.shadow);
    });
  }
  rasterText(str, font, (gx, gy) => {
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s.px(left + gx * k + i, y + gy * k + j, color);
  });
  return w;
}

export const textSize = (str, font = "mini", k = 1) => [textWidth(str, font) * k, FONTS[font].h * k];
