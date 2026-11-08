// 无尽模式的竞技场：一条长平地 + 两侧小台，没有坑也没有终点。
// 单独生成，不改动关卡模式的地图。

const W = 96, H = 20, GROUND = 14;

export function buildArena() {
  const rows = Array.from({ length: H }, () => new Array(W).fill("."));
  const set = (x, y, c) => {
    if (x >= 0 && x < W && y >= 0 && y < H) rows[y][x] = c;
  };

  // 地面
  for (let x = 0; x < W; x++) for (let y = GROUND; y < H; y++) set(x, y, "#");

  // 两侧高台（给玩家跳上去躲避，也当视觉地标）
  for (let x = 3; x < 9; x++) for (let y = GROUND - 3; y < GROUND; y++) set(x, y, "#");
  for (let x = W - 9; x < W - 3; x++) for (let y = GROUND - 3; y < GROUND; y++) set(x, y, "#");

  // 中间两块浮台，方便跳到高处躲蝙蝠
  for (let x = 24; x < 30; x++) set(x, GROUND - 4, "=");
  for (let x = W - 30; x < W - 24; x++) set(x, GROUND - 4, "=");
  for (let x = W / 2 - 4; x < W / 2 + 4; x++) set(x, GROUND - 6, "=");

  // 出生点放正中间
  set(W / 2, GROUND - 1, "S");

  // 火把
  for (const x of [12, 22, W / 2 - 12, W / 2 + 12, W - 22, W - 12]) {
    if (rows[GROUND - 1][x] === ".") set(x, GROUND - 1, "T");
  }

  return {
    rows: rows.map((r) => r.join("")),
    spawn: { x: (W / 2) * 16 + 8, y: GROUND * 16 },
    width: W * 16,
  };
}

export const ARENA_W = W;
export const ARENA_H = H;
export const ARENA_GROUND = GROUND;
