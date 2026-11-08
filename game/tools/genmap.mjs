// 生成关卡地图的 ASCII 文本，输出到 game/data/level1.js
// 图例： # 实体地面/土石   = 石台   ^ 尖刺   T 火把   C 金币   D 木桩靶   E 史莱姆   S 出生点   X 出口
//
// 这是离线工具：结果被写死进 data/level1.js，运行时不再生成，保证每次一样。
// 生成完会做一遍可玩性检查（坑宽、台阶高度、出生点、出口、尖刺是否落地）。

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "data", "level1.js");

const W = 208, H = 22, GROUND = 16;
const MAX_GAP = 3;   // 能跳过的空档宽度（格）
const MAX_STEP = 2;  // 能直接跳上的台阶高度（格）

const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const r = rng(20251108);
const range = (a, b) => a + Math.floor(r() * (b - a + 1));

const grid = Array.from({ length: H }, () => new Array(W).fill("."));
const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = c; };
const get = (x, y) => (x >= 0 && x < W && y >= 0 && y < H ? grid[y][x] : "#");

// groundY[x] = 这一列最上面一块实心砖的 y；99 = 整列空（坑）
const groundY = new Array(W).fill(GROUND);
const segments = [];

const col = (x, y) => { if (x >= 0 && x < W) groundY[x] = y; };
const cols = (x, len, y) => { for (let i = 0; i < len; i++) col(x + i, y); };

let x = 0;

// ---- 开场：平地，放出生点
cols(x, 18, GROUND);
segments.push(["flat", x, 18]);
x += 18;
const spawnX = 6;

while (x < W - 34) {
  const roll = r();

  if (roll < 0.24) {
    // 坑：直接空过去，上方一串金币画出跳跃弧线（高度取 GROUND-2，跳过去顺手吃到）
    const gap = range(2, MAX_GAP);
    cols(x, gap, 99);
    segments.push(["pit", x, gap]);
    x += gap;
    cols(x, range(5, 7), GROUND); x += 6;
  } else if (roll < 0.46) {
    // 台地：抬 1~2 格走一段再下来
    const up = range(1, MAX_STEP), len = range(7, 11);
    cols(x, 2, GROUND); x += 2;              // 起跳缓冲
    cols(x, len, GROUND - up);
    segments.push(["plateau", x, len, GROUND - up]);
    x += len;
    cols(x, 2, GROUND); x += 2;
  } else if (roll < 0.66) {
    // 凹地：下沉 1~2 格，宽 6~8，底部放尖刺
    const deep = range(1, 2), len = range(6, 8);
    cols(x, len, GROUND + deep);
    segments.push(["dip", x, len, GROUND + deep]);
    x += len;
    cols(x, range(4, 6), GROUND); x += 5;
  } else if (roll < 0.86) {
    // 石桥：坑中间一块浮台，可踩着过
    cols(x, 2, 99);
    segments.push(["bridge", x, 2, GROUND - 2]);
    x += 2;
    set(x, GROUND - 2, "="); set(x + 1, GROUND - 2, "=");
    x += 2;
    cols(x, 2, 99);
    x += 2;
    cols(x, range(4, 6), GROUND); x += 5;
  } else {
    // 浮空平台 + 金币，主路不变
    const pw = range(3, 4), py = GROUND - range(3, 4);
    for (let i = 0; i < pw; i++) set(x + i, py, "=");
    set(x + 1, py - 1, "C");
    segments.push(["platform", x, py, pw]);
    x += pw;
    cols(x, range(4, 6), GROUND); x += 5;
  }
}

// ---- 收尾平地 + 出口
cols(x, W - x, GROUND);

// ---- 地面填实
for (let cx = 0; cx < W; cx++) {
  const gy = groundY[cx];
  if (gy >= H) continue;
  for (let cy = gy; cy < H; cy++) grid[cy][cx] = "#";
}

set(spawnX, GROUND - 1, "S");
const exitX = W - 9;
set(exitX, GROUND - 1, "X");

// ---- 尖刺：凹地里，落地前给玩家看到
for (const s of segments) {
  if (s[0] !== "dip") continue;
  const [, sx, len, y2] = s;
  const n = len >= 7 ? 2 : 1;
  const cx = sx + Math.floor(len / 2) - (n === 2 ? 1 : 0);
  for (let i = 0; i < n; i++) set(cx + i, y2 - 1, "^");
}

// ---- 火把：主地面 / 台地上，间隔 14~20 格
let lastTorch = -99;
for (let cx = 8; cx < W - 8; cx++) {
  const gy = groundY[cx];
  if (gy === 99) continue;
  if (cx - lastTorch < range(14, 20)) continue;
  if (grid[gy - 1][cx] !== ".") continue;
  if (grid[gy - 2] && grid[gy - 2][cx] !== ".") continue;
  if (r() > 0.7) continue;
  set(cx, gy - 1, "T");
  lastTorch = cx;
}

// ---- 金币：坑上方弧线、台地上、平地
// 平地上的金币放在 GROUND-1（贴着地面），走过去就能吃到 ——
// 这是玩家最容易遇到、也最该"正常计数"的那类。
for (const s of segments) {
  if (s[0] === "pit") {
    const [, px, gap] = s;
    for (let i = 0; i < gap; i++) set(px + i, GROUND - 2, "C");
  }
  if (s[0] === "plateau") {
    const [, px, len, ly] = s;
    set(px + Math.floor(len / 2), ly - 2, "C");
  }
}

// ---- 贴地金币：沿主地面每隔一段放一枚
// 之前所有金币都挂在空中（离地 28~60px），站着一枚也吃不到，
// 玩家会以为"金币计数坏了"。这里补一批贴地金币，跑过去就能捡。
let lastGroundCoin = -99;
for (let cx = 18; cx < W - 18; cx++) {
  if (cx - lastGroundCoin < 21) continue;
  // 主地面：GROUND 这一行是实心，上面一格空着
  if (get(cx, GROUND) !== "#" || get(cx, GROUND - 1) !== ".") continue;
  if (get(cx, GROUND - 2) !== ".") continue;
  set(cx, GROUND - 1, "C");
  lastGroundCoin = cx;
}

// ---- 木桩靶与史莱姆：都站在主地面上，互相错开
const freeSpot = (cx, gy) => {
  for (let cy = gy - 1; cy >= gy - 3; cy--) if (get(cx, cy) !== ".") return false;
  return true;
};
let lastEnemy = -99;
for (let cx = 30; cx < W - 26; cx++) {
  if (cx - lastEnemy < 11) continue;
  const gy = groundY[cx];
  if (gy !== GROUND || !freeSpot(cx, gy)) continue;
  if (r() > 0.75) continue;
  set(cx, gy - 1, r() < 0.55 ? "D" : "E");
  lastEnemy = cx;
}

// ---- 可玩性检查
const problems = [];
let openRun = 0;
for (let cx = 0; cx < W; cx++) {
  if (groundY[cx] === 99) { openRun++; continue; }
  if (openRun > MAX_GAP) problems.push(`坑太宽: x=${cx - openRun} 宽 ${openRun}`);
  openRun = 0;
}
for (let cx = 1; cx < W; cx++) {
  const a = groundY[cx - 1], b = groundY[cx];
  if (a === 99 || b === 99) continue;
  if (a - b > MAX_STEP) problems.push(`台太高: x=${cx} 从 y=${a} 到 y=${b}`);
}
if (groundY[spawnX] === 99) problems.push("出生点在坑上");
if (groundY[exitX] === 99) problems.push("出口在坑上");
for (let cx = 0; cx < W; cx++)
  if (grid[GROUND - 1][cx] === "^" && groundY[cx] !== GROUND + 1 && groundY[cx] !== GROUND + 2)
    problems.push(`尖刺没落在凹地里: x=${cx}`);

const count = (ch) => grid.flat().filter((c) => c === ch).length;
const stats = {
  torches: count("T"), coins: count("C"), dummies: count("D"),
  slimes: count("E"), spikes: count("^"), platforms: count("="),
};

const rows = grid.map((row) => row.join(""));
const data = `// 关卡的 ASCII 地图，由 game/tools/genmap.mjs 生成，可以手改。
// 图例： # 实体地面/土石   = 石台   ^ 尖刺   T 火把   C 金币   D 木桩靶   E 史莱姆   S 出生点   X 出口
export const TILE = 16;
export const LEVEL_W = ${W};
export const LEVEL_H = ${H};
export const level1 = [
${rows.map((r2) => '  "' + r2 + '",').join("\n")}
];
`;
mkdirSync(join(HERE, "..", "data"), { recursive: true });
writeFileSync(OUT, data, "utf8");

const ruler = "     " + Array.from({ length: W }, (_, i) => (i % 10 === 0 ? String(Math.floor(i / 10) % 10) : " ")).join("");
console.log(ruler);
rows.forEach((row, i) => console.log(String(i).padStart(3, " ") + "  " + row));
console.log(`\n${W}x${H} 格 = ${W * 16}x${H * 16} 像素`);
console.log("内容:", JSON.stringify(stats));
console.log(problems.length ? "问题:\n  " + problems.join("\n  ") : "可玩性检查: 通过");
