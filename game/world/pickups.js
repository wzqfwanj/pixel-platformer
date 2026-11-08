// 拾取判定（纯函数，能在 node 里单测）

export const COIN_BOX = { pad: 3, up: 5, h: 18 };

/** 金币的碰撞盒（比贴图宽松一点，好捡） */
export const coinBox = (c) => ({ x: c.x - 3, y: c.y - 5, w: 11, h: 18 });

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
