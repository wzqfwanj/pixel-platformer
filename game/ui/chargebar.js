// 蓄力条：K 键蓄力时画在角色头顶。
//
// 放在这里而不是 HUD，是因为蓄力是"角色身上正在发生的事"，
// 玩家视线这时候在角色身上，抬眼去左上角看条会分神。
//
// 两套配色（随主题）解决可见性问题：
//   暗色主题：外框中灰、内部更深，靠"填充色发亮"来读数
//   亮色主题：外框浅灰、内部中灰，靠"填充色变深"来读数
// 之前底板和边框同色，在暗背景上整条糊成一根黑带，等于没有。
//
// 三段填充色让玩家不用读数字就知道攒到哪了：
//   0-40%  冷白（刚开始）
//   40-85% 橙金（有威力了）
//   85-100% 亮红 + 闪烁（满了，松手就砸）

import { hex } from "../core/util.js";
import { getTheme } from "../core/theme.js";

const C = {
  edgeDark: hex("#7a7f96"),    // 暗色主题：外框（要亮，才浮得出来）
  edgeLight: hex("#4a4e60"),   // 亮色主题：外框（要深）
  innerDark: hex("#0e0c16"),   // 暗色主题：内部底
  innerLight: hex("#c8cad4"),  // 亮色主题：内部底
  cold: hex("#9fc4ff"),
  warm: hex("#ffb02a"),
  hot: hex("#ff4a30"),
  full: hex("#ffffff"),
  tick: hex("#5c6076"),
};

const BAR_W = 20;
const BAR_H = 5;

/**
 * @param s     画布
 * @param cx    角色中心 x（屏幕坐标）
 * @param top   角色头顶 y（屏幕坐标）
 * @param k     0..1 蓄力进度
 * @param t     时间（做闪烁）
 */
export function drawChargeBar(s, cx, top, k, t) {
  const dark = getTheme().name === "dark";
  const x = Math.round(cx - BAR_W / 2);
  const y = Math.round(top) - 9;

  const full = k >= 0.995;
  // 满了以后闪烁，提醒可以松手
  const blink = full && Math.floor(t * 12) % 2 === 0;

  // 外框（暗色主题用亮框，亮色主题用深框）
  s.rect(x - 1, y - 1, BAR_W + 2, BAR_H + 2, dark ? C.edgeDark : C.edgeLight);
  // 内部底
  s.rect(x, y, BAR_W, BAR_H, dark ? C.innerDark : C.innerLight);

  // 填充（留 1px 内边距）
  const innerW = BAR_W - 2;
  const fw = Math.max(0, Math.round(innerW * k));
  const color = k < 0.4 ? C.cold : k < 0.85 ? C.warm : C.hot;
  if (fw > 0) s.rect(x + 1, y + 1, fw, BAR_H - 2, blink ? C.full : color);

  // 25% / 50% / 75% 刻度（细线，方便估读）
  for (let i = 1; i <= 3; i++) {
    const tx = x + Math.round((BAR_W - 1) * (i / 4));
    s.px(tx, y, dark ? C.tick : C.innerLight);
    s.px(tx, y + BAR_H - 1, dark ? C.tick : C.innerLight);
  }

  // 满蓄力：上方加一道亮线，远看也醒目
  if (full) {
    s.hline(x - 1, y - 3, BAR_W + 2, blink ? C.full : C.hot);
  }
}

export { BAR_W as CHARGE_BAR_W, BAR_H as CHARGE_BAR_H };
