// HUD：血条、连击、金币、操作提示、结算文字。
// 规范要求黑白色调 + 明暗切换，所以这里全部走主题色，不写死颜色。

import { hex } from "../core/util.js";
import { drawText } from "../core/text.js";
import { getTheme } from "../core/theme.js";
import { drawMinimap } from "./minimap.js";

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

  // 右上角：小地图在最上面，文字排在它下沿之下。
  // 结算/死亡画面不画小地图，这时文字回到顶部。
  const mapBox = game.won ? null : drawMinimap(s, game, C);
  const textRight = mapBox ? mapBox.x + mapBox.w : 316;
  const textTop = mapBox ? mapBox.y + mapBox.h + 3 : 6;

  if (game.mode === "endless") {
    // 无尽模式右上：生存时间（大字）+ 击杀数 + 下一波倒计时
    const t = game.surviveTime ?? 0;
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60);
    const timeStr = `${mm}:${String(ss).padStart(2, "0")}`;
    drawText(s, timeStr, textRight, textTop, C.accent, { font: "big", align: "right", shadow: sh });
    drawText(s, `${game.enemiesKilled} KILL`, textRight, textTop + 10, C.dim, { align: "right", shadow: sh });

    // 左下：波次 + 场上敌人数
    const alive = game.enemies.filter((e) => !e.dead).length;
    const ph = game.spawner?.phase;
    if (ph) {
      drawText(s, ph.name, 4, 160, C.text, { shadow: sh });
      drawText(s, `NEXT ${(game.spawner.countdown).toFixed(1)}s   ON ${alive}`, 4, 166, C.dim, { shadow: sh });
    }

    // 波次切换的提示文字（闪 2 秒）
    if ((game.waveT ?? 0) > 0) {
      const a = Math.min(1, game.waveT);
      drawText(s, game.waveText, 160, 46, C.accent, { font: "big", scale: 2, align: "center", shadow: sh });
    }
  } else {
    // ---- 关卡模式右上：金币 / 击杀（同样排在小地图下面）
    drawText(s, `COIN ${game.coins}/${game.coinTotal}`, textRight, textTop, C.accent, { align: "right", shadow: sh });
    drawText(s, `${game.enemiesKilled} KILL`, textRight, textTop + 8, C.dim, { align: "right", shadow: sh });
  }

  // ---- 连击：当前连击大字，峰值小字
  if (game.combo >= 2) {
    drawText(s, `x${game.combo}`, 12, 22, C.accent, { font: "big", scale: 2, shadow: sh });
    drawText(s, "COMBO", 12 + 24, 26, C.text, { shadow: sh });
  } else if (game.comboBest >= 3) {
    drawText(s, `BEST x${game.comboBest}`, 12, 23, C.dim, { shadow: sh });
  }

  // ---- 底部操作提示
  if (game.showHint) {
    const hint = "A D MOVE   SPACE JUMP   HOLD K CHARGE SLASH   SHIFT DASH   T THEME   M MODE";
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
    s.rect(0, 58, 320, 58, C.panel);
    s.hline(0, 58, 320, C.ink);
    s.hline(0, 115, 320, C.ink);
    const endless = game.mode === "endless";
    drawText(s, endless ? "GAME OVER" : "STAGE CLEAR", 160, 66, C.accent, { font: "big", scale: 2, align: "center", shadow: sh });
    if (endless) {
      const t = game.surviveTime ?? 0;
      const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
      drawText(s, `SURVIVED ${mm}:${String(ss).padStart(2, "0")}   KILLS ${game.enemiesKilled}`, 160, 90, C.text, { align: "center", shadow: sh });
      drawText(s, `BEST COMBO x${game.comboBest ?? 0}`, 160, 100, C.dim, { align: "center", shadow: sh });
    } else {
      drawText(s, `COINS ${game.coins}/${game.coinTotal}   KILLS ${game.enemiesKilled}`, 160, 92, C.text, { align: "center", shadow: sh });
    }
    drawText(s, endless ? "R RESTART   M TOGGLE MODE" : "R RESTART   M ENDLESS MODE", 160, 108, C.dim, { align: "center", shadow: sh });
  } else if (p.state === "dead" && game.mode !== "endless") {
    s.rect(0, 74, 320, 26, C.panel);
    drawText(s, "YOU DIED", 160, 80, C.accent, { font: "big", scale: 2, align: "center", shadow: sh });
  }
}
