// 拾取判定（纯函数，能在 node 里单测）

// 拾取盒比金币贴图大一圈：像素游戏里用"精确像素重叠"判定拾取手感很差，
// 玩家会觉得明明碰到了却没捡到。经验值是上下各放宽 10px 左右。
export const COIN_BOX = { pad: 5, up: 22, down: 8 };

/** 金币的碰撞盒（比贴图宽松，站着跑过就能吃到） */
export const coinBox = (c) => ({
  x: c.x - COIN_BOX.pad,
  // 金币的 y 是贴图左上角（大约在玩家头顶上方 13px）。
  // 拾取盒要从金币处【往下】延伸到玩家身体，才符合"走过去碰到它"的直觉。
  y: c.y - COIN_BOX.up,
  w: 8 + COIN_BOX.pad * 2,
  h: COIN_BOX.up + COIN_BOX.down,
});

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** 把玩家碰到、还没被吃掉的金币标记为 taken，返回捡到的数量 */
export function collectCoins(playerBox, coins) {
  let n = 0;
  for (const c of coins) {
    if (c.taken) continue;
    if (overlap(playerBox, coinBox(c))) {
      c.taken = true;
      n++;
    }
  }
  return n;
}
