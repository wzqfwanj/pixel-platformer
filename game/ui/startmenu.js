// 启动菜单：进入游戏前选择模式。
//
// 为什么放在画布里而不是 HTML 叠加层：
//   整个游戏是 320x180 的软件渲染画面，菜单用同一套像素字体和主题色，
//   缩放一致、风格统一。HTML 叠加层会破坏像素感。
//
// 注意：pixelfx 的位图字体只支持 ASCII（大写字模 54 个字符，没有小写、没有中文）。
// 所以菜单文字必须是英文大写 —— 否则 drawText 一个像素也画不出来，只剩空框。
//
// 操作：A/D 或 ←/→ 选择，空格/回车确认，也可以直接按 1 / 2。

import { drawText } from "../core/text.js";

const OPTIONS = [
  { id: "level", label: "LEVEL MODE", desc: "RUN AND COLLECT COINS, REACH THE EXIT" },
  { id: "endless", label: "ENDLESS MODE", desc: "SURVIVE WAVES OF MONSTERS" },
];

// 颜色（0xAABBGGRR）
const C = {
  panelOn: 0xff262238,
  panelOff: 0xff1a1826,
  edgeOn: 0xffffffff,
  edgeOff: 0xff6e6a86,
  edgeInner: 0xff9a94ac,
  textOn: 0xffffffff,
  textOff: 0xffa8a2b8,
  descOn: 0xffc8c2d4,
  descOff: 0xff7e788e,
  dim: 0xff7a7488,
  hint: 0xffd8d4e0,
  titleBg: 0xff101018,
  titleEdge: 0xffe8e8f0,
};

export class StartMenu {
  constructor() {
    this.index = 0;
    this.t = 0;
  }

  get selected() {
    return OPTIONS[this.index].id;
  }

  /** @returns 选中的模式 id，或者 null（还没确认） */
  update(dt, input) {
    this.t += dt;
    const left = input.pressed("left");
    const right = input.pressed("right");
    if (left || right) {
      this.index = (this.index + (right ? 1 : -1) + OPTIONS.length) % OPTIONS.length;
    }

    if (input.pressed("menu1")) return OPTIONS[0].id;
    if (input.pressed("menu2")) return OPTIONS[1].id;
    if (input.pressed("jump") || input.pressed("confirm")) return this.selected;
    return null;
  }

  draw(s) {
    // 背景压暗（棋盘抖动，像素风不做真 alpha）
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++)
        if (((x + y) & 1) === 0) s.blendPx(x, y, 0xff000000, 0.7);

    // 标题
    s.rect(40, 20, 240, 22, C.titleBg);
    s.outline(40, 20, 240, 22, C.titleEdge);
    drawText(s, "PIXEL KNIGHT", 160, 26, C.titleEdge, { font: "big", scale: 2, align: "center" });
    drawText(s, "SELECT MODE", 160, 46, C.dim, { align: "center" });

    // 两个选项
    const boxW = 220, boxH = 30, gap = 10, startY = 62;
    for (let i = 0; i < OPTIONS.length; i++) {
      const opt = OPTIONS[i];
      const y = startY + i * (boxH + gap);
      const on = i === this.index;

      s.rect(50, y, boxW, boxH, on ? C.panelOn : C.panelOff);
      s.outline(50, y, boxW, boxH, on ? C.edgeOn : C.edgeOff);
      if (on) s.outline(51, y + 1, boxW - 2, boxH - 2, C.edgeInner);

      drawText(s, opt.label, 64, y + 6, on ? C.textOn : C.textOff, { font: "big" });
      drawText(s, opt.desc, 64, y + 19, on ? C.descOn : C.descOff);

      if (on && Math.floor(this.t * 4) % 2 === 0) {
        drawText(s, ">", 53, y + 10, C.textOn, { scale: 2 });
        drawText(s, "<", 252, y + 10, C.textOn, { scale: 2 });
      }
    }

    // 底部提示
    if (Math.floor(this.t * 2) % 2 === 0) {
      drawText(s, "A D CHOOSE    SPACE START", 160, 140, C.hint, { align: "center" });
    }
    drawText(s, "OR PRESS 1 / 2", 160, 150, C.dim, { align: "center" });
  }
}
