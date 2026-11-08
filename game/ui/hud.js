// HUD：血条、连击、金币、操作提示、结算文字。
// 规范要求黑白色调 + 明暗切换，所以这里全部走主题色，不写死颜色。

import { hex } from "../core/util.js";
import { drawText } from "../core/text.js";
import { getTheme } from "../core/theme.js";

/** 把主题里的 #rrggbb 转成缓冲区用的颜色整数，顺手缓存（主题切换时重建） */
let cache = { name: null, colors: null };
function colors() {
  const t = getTheme();
  if (cache.name === t.name) return cache.colors;
  const h = t.hud;
  const c = {
    panel: hex(h.panel),
    ink: hex(h.ink),
    text: hex(h.text),
    dim: hex(h.dim),
    bar: hex(h.bar),
    barHi: hex(h.barHi),
    barBack: hex(h.barBack),
    barEdge: hex(h.barEdge),
    accent: hex(h.accent),
    shadow: t.name === "dark" ? hex(h.ink) : undefined,
  };
  cache = { name: t.name, colors: c };
  return c;
}

function heart(s, x, y, c) {
  const rows = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."];
  s.sprite(rows, { "#": c.bar }, x, y);
}

export function drawHud(s, game) {
  const C = colors();
  const p = game.player;
  const sh = C.shadow;

  // ---- 血条
  s.rect(4, 4, 74, 12, C.panel);
  s.outline(4, 4, 74, 12, C.ink);
  heart(s, 6, 7, C);
  const bx = 16, by = 8, bw = 58, bh = 5;
  s.rect(bx, by, bw, bh, C.barBack);
  const k = Math.max(0, Math.min(1, p.hp / p.maxHp));
  s.rect(bx, by, Math.round(bw * k), bh, C.bar);
  s.hline(bx, by, Math.round(bw * k), C.barHi);
  s.outline(bx - 1, by - 1, bw + 2, bh + 2, C.barEdge);
  drawText(s, `${Math.ceil(p.hp)}`, bx + bw + 3, by, C.text, { shadow: sh });

  // ---- 右上：金币 / 击杀
  drawText(s, `COIN ${game.coins}/${game.coinTotal}`, 316, 6, C.accent, { align: "right", shadow: sh });
  drawText(s, `${game.enemiesKilled} KILL`, 316, 14, C.dim, { align: "right", shadow: sh });

  // ---- 连击：当前连击大字，峰值小字
  if (game.combo >= 2) {
    drawText(s, `x${game.combo}`, 12, 22, C.accent, { font: "big", scale: 2, shadow: sh });
    drawText(s, "COMBO", 12 + 24, 26, C.text, { shadow: sh });
  } else if (game.comboBest >= 3) {
    drawText(s, `BEST x${game.comboBest}`, 12, 23, C.dim, { shadow: sh });
  }

  // ---- 底部操作提示
  if (game.showHint) {
    const hint = "A D MOVE  SPACE JUMP  J ATTACK  K HEAVY  SHIFT DASH  T THEME  R RESTART";
    s.rect(0, 167, 320, 13, C.panel);
    s.hline(0, 167, 320, C.ink);
    drawText(s, hint, 160, 171, C.dim, { align: "center", shadow: sh });
  }

  // ---- 调试信息
  if (game.debug) {
    const lines = [
      `FPS ${game.fps.toFixed(0)}  FX ${game.fx.count}  THEME ${getTheme().name}`,
      `POS ${p.cx.toFixed(0)},${p.feet.toFixed(0)}  VX ${p.vx.toFixed(0)} VY ${p.vy.toFixed(0)}`,
      `STATE ${p.state}  GROUND ${p.onGround ? 1 : 0}  ATK ${p.atk ? p.atk.idx + 1 : "-"}`,
    ];
    lines.forEach((l, i) => drawText(s, l, 6, 30 + i * 7, C.accent, { shadow: sh }));
  }

  // ---- 结算 / 死亡
  if (game.won) {
    s.rect(0, 62, 320, 52, C.panel);
    s.hline(0, 62, 320, C.ink);
    s.hline(0, 113, 320, C.ink);
    drawText(s, "STAGE CLEAR", 160, 72, C.accent, { font: "big", scale: 2, align: "center", shadow: sh });
    drawText(s, `COINS ${game.coins}/${game.coinTotal}   KILLS ${game.enemiesKilled}`, 160, 94, C.text, { align: "center", shadow: sh });
    drawText(s, "PRESS R TO PLAY AGAIN", 160, 104, C.dim, { align: "center", shadow: sh });
  } else if (p.state === "dead") {
    s.rect(0, 74, 320, 26, C.panel);
    drawText(s, "YOU DIED", 160, 80, C.accent, { font: "big", scale: 2, align: "center", shadow: sh });
  }
}
