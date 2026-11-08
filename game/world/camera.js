// 相机：死区跟随 + 整数化。
//
// 之前是 lerp(cam, target, dt*7) 再取整，结果相机每帧走 0/1/2/3 像素不等，
// 匀速跑动时整个场景的滚动节奏不匀 —— 这就是横向的"抖"。
//
// 现在的做法：相机以角色的【整数】位置为准，死区内完全不动，出死区后 1:1 跟上。
// 匀速跑动时相机每帧的位移 = 角色每帧的位移（都是那 1 或 2 像素），滚动速度恒定。
// 而且因为角色绘制也用同一个 round(cx)，角色在屏幕上的位置可以做到纹丝不动。

export const VIEW_W = 320;
export const VIEW_H = 180;

const DEAD_X = 22;   // 水平死区半宽：角色在这个范围内左右移动，相机不动
const LOOK_AHEAD = 14;
const GROUND_LINE = 128;  // 角色脚底在屏幕上的目标高度
const DEAD_Y = 26;   // 竖直死区：小跳不让画面跟着晃

/** 初始化：把相机放到能看见角色的位置，取整 */
export function placeCamera(cam, player, level) {
  cam.x = Math.round(player.cx - VIEW_W / 2);
  cam.y = Math.round(player.feet - GROUND_LINE);
  clampToLevel(cam, level);
  return cam;
}

/** 每帧跟随。cam.x / cam.y 始终保持整数。 */
export function followCamera(cam, player, level) {
  const wantX = Math.round(player.cx) + player.facing * LOOK_AHEAD;
  const centerX = cam.x + VIEW_W / 2;

  if (wantX > centerX + DEAD_X) cam.x = wantX - DEAD_X - VIEW_W / 2;
  else if (wantX < centerX - DEAD_X) cam.x = wantX + DEAD_X - VIEW_W / 2;

  const fireY = Math.round(player.feet) - GROUND_LINE;
  if (fireY > cam.y + DEAD_Y) cam.y = fireY - DEAD_Y;
  else if (fireY < cam.y - DEAD_Y) cam.y = fireY + DEAD_Y;

  clampToLevel(cam, level);
  return cam;
}

function clampToLevel(cam, level) {
  cam.x = Math.max(0, Math.min(level.pxW - VIEW_W, cam.x));
  cam.y = Math.max(0, Math.min(level.pxH - VIEW_H, cam.y));
}

/** 渲染用的相机：加上震屏位移，仍然取整 */
export function renderCamera(cam, shake = 0) {
  if (shake <= 0.01) return { x: cam.x | 0, y: cam.y | 0 };
  return {
    x: Math.round(cam.x + (Math.random() * 2 - 1) * shake),
    y: Math.round(cam.y + (Math.random() * 2 - 1) * shake),
  };
}
