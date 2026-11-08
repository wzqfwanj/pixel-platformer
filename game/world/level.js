// 关卡：解析 ASCII 地图，提供碰撞查询，并把静态图块烘成一张大图

import { Surface } from "../core/screen.js";
import { level1, TILE, LEVEL_W, LEVEL_H } from "../data/level1.js";
import { drawSolid, drawPlatform, drawSpikes, drawTorchMount } from "./tiles.js";

const SOLID = new Set(["#", "="]);
const SOLID_PLATFORM = new Set(["="]);

export class Level {
  constructor(rows = level1) {
    this.rows = rows;
    this.h = rows.length;
    this.w = rows[0].length;
    this.T = TILE;
    this.pxW = this.w * TILE;
    this.pxH = this.h * TILE;
    this.spawn = { x: TILE * 3, y: 0 };
    this.exit = { x: 0, y: 0 };
    this.torches = [];
    this.coins = [];
    this.enemySpawns = [];
    this.spikes = [];
    this.parse();
  }

  at(tx, ty) {
    if (tx < 0 || tx >= this.w || ty < 0 || ty >= this.h) return ty >= this.h ? "." : "#";
    return this.rows[ty][tx];
  }
  isSolidTile(tx, ty) {
    return SOLID.has(this.at(tx, ty));
  }
  isHazardTile(tx, ty) {
    return this.at(tx, ty) === "^";
  }
  /** 像素坐标处是否是实心 */
  solidAt(px, py) {
    return this.isSolidTile(Math.floor(px / TILE), Math.floor(py / TILE));
  }
  hazardAt(px, py) {
    return this.isHazardTile(Math.floor(px / TILE), Math.floor(py / TILE));
  }
  /** 矩形内有没有实心块 */
  solidRect(x, y, w, h) {
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 1) / TILE);
    const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 1) / TILE);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) if (this.isSolidTile(tx, ty)) return true;
    return false;
  }
  hazardRect(x, y, w, h) {
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 1) / TILE);
    const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 1) / TILE);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) if (this.isHazardTile(tx, ty)) return true;
    return false;
  }

  parse() {
    for (let ty = 0; ty < this.h; ty++)
      for (let tx = 0; tx < this.w; tx++) {
        const ch = this.rows[ty][tx];
        const cx = tx * TILE + TILE / 2, by = (ty + 1) * TILE;
        if (ch === "S") this.spawn = { x: cx, y: by };
        else if (ch === "X") this.exit = { x: cx, y: by };
        else if (ch === "T") this.torches.push({ x: cx, y: by, tileX: tx, tileY: ty });
        else if (ch === "C") this.coins.push({ x: tx * TILE + 6, y: ty * TILE + 4, taken: false, phase: tx % 5 });
        else if (ch === "D") this.enemySpawns.push({ type: "dummy", x: cx, y: by });
        else if (ch === "E") this.enemySpawns.push({ type: "slime", x: cx, y: by });
        else if (ch === "^") this.spikes.push({ x: tx * TILE, y: ty * TILE });
      }
  }

  /** 把整张关卡的静态图块烘到一块 Surface 上（只烘颜色） */
  bake() {
    const s = new Surface(this.pxW, this.pxH);
    for (let ty = 0; ty < this.h; ty++)
      for (let tx = 0; tx < this.w; tx++) {
        const ch = this.at(tx, ty);
        if (ch === "#")
          drawSolid(s, tx, ty, TILE, !this.isSolidTile(tx, ty - 1),
            this.isSolidTile(tx, ty - 1), this.isSolidTile(tx - 1, ty), this.isSolidTile(tx + 1, ty));
        else if (ch === "=") drawPlatform(s, tx, ty, TILE);
        else if (ch === "^") drawSpikes(s, tx, ty, TILE);
        // 火把的木头支架由 pixelfx 的 fire/torch 特效自己画，这里留空
      }
    return s;
  }
}

export { TILE, SOLID_PLATFORM };
