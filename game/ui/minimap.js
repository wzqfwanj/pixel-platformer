// 小地图：画在 HUD 右上角。
//
// 关卡模式：整关的地面剖面（坑=断口，台阶=高度变化）+ 平台 + 玩家 + 视野框 + 屏幕外的敌人
// 无尽模式：场地剖面 + 视野框 + 场上所有活着的敌人（左右两侧的威胁一眼可见）
//
// 画法取舍：
//   - 只画"地面线 + 下面 1 行淡色"，不整块填充。88x14 像素里，填充会占掉 40% 面积
//     却只表示"这里是土"，反而把重点（坑在哪）盖住。
//   - 纵向自适应：关卡 208x22，但地形只在底部几行变化（上面全是天空）。
//     先扫出地面的最高/最低点，把这一段铺满小地图高度，不然坑和台阶会被压成一条线。
//   - 边框用亮色：暗色主题下 ink 是纯黑，和背景糊在一起，小地图会"消失"。

const MINI_W = 88;
const MINI_H = 14;
const MINI_PAD = 3;
const MINI_TOP = 4;      // 贴顶：小地图在最上面，文字排在它下面

export function drawMinimap(s, game, C) {
  const level = game.level;
  if (!level) return;

  const tw = level.w, th = level.h;
  const mw = Math.min(MINI_W, Math.max(24, Math.round(tw / 2)));
  const mh = MINI_H;

  const boxW = mw + MINI_PAD * 2;
  const boxH = mh + MINI_PAD * 2;
  const bx = 320 - boxW - 4;
  const by = MINI_TOP;
  const ox = bx + MINI_PAD, oy = by + MINI_PAD;

  // ---- 扫每列：地面行（只认 "#"）和平台行（只认 "="）
  const ground = [], plat = [];
  let minG = Infinity, maxG = -Infinity;
  for (let mx = 0; mx < mw; mx++) {
    const tx0 = Math.floor((mx / mw) * tw);
    const tx1 = Math.max(tx0 + 1, Math.floor(((mx + 1) / mw) * tw));
    let g = -1, p = -1;
    for (let tx = tx0; tx < tx1; tx++) {
      for (let ty = 0; ty < th; ty++) {
        const c = level.at(tx, ty);
        if (c === "#" && g < 0) g = ty;
        if (c === "=" && p < 0) p = ty;
      }
    }
    ground.push(g);
    plat.push(p);
    if (g >= 0) { minG = Math.min(minG, g); maxG = Math.max(maxG, g); }
  }
  if (!isFinite(minG)) { minG = 0; maxG = th - 1; }

  // 平台也要算进纵向区间，否则会被 clamp 到顶部全挤在一起
  for (const p of plat) {
    if (p >= 0) { minG = Math.min(minG, p); maxG = Math.max(maxG, p); }
  }

  const bandTop = Math.max(0, minG - 1);
  const bandBot = Math.min(th - 1, maxG + 1);
  const bandH = Math.max(1, bandBot - bandTop + 1);
  // ty 越大越靠下：bandBot 落在最后一行，bandTop 落在第 0 行
  const toRow = (ty) =>
    Math.min(mh - 1, Math.max(0, (mh - 1) - Math.round(((bandBot - ty) / bandH) * (mh - 1))));

  // ---- 底板 + 亮色边框
  s.rect(bx, by, boxW, boxH, C.panel);
  s.outline(bx, by, boxW, boxH, C.text);
  s.outline(bx + 1, by + 1, boxW - 2, boxH - 2, C.ink);

  // ---- 地面线（坑=断口）+ 下面 1 行淡色表示实心
  for (let mx = 0; mx < mw; mx++) {
    if (ground[mx] < 0) continue;
    const y = oy + toRow(ground[mx]);
    s.px(ox + mx, y, C.text);
    if (y + 1 < oy + mh) s.px(ox + mx, y + 1, C.dim);
  }

  // ---- 平台（浮空石台，暗一点的颜色，和地面区分）
  for (let mx = 0; mx < mw; mx++) {
    if (plat[mx] < 0) continue;
    s.px(ox + mx, oy + toRow(plat[mx]), C.dim);
  }

  // ---- 尖刺：地面线上方戳一点亮色
  for (let mx = 0; mx < mw; mx++) {
    const tx0 = Math.floor((mx / mw) * tw);
    const tx1 = Math.max(tx0 + 1, Math.floor(((mx + 1) / mw) * tw));
    let spike = false;
    for (let tx = tx0; tx < tx1 && !spike; tx++)
      for (let ty = 0; ty < th; ty++)
        if (level.at(tx, ty) === "^") { spike = true; break; }
    if (spike && ground[mx] >= 0) {
      s.px(ox + mx, oy + Math.max(0, toRow(ground[mx]) - 1), C.accent);
    }
  }

  // ---- 世界坐标 -> 缩略图坐标
  const toX = (wx) => ox + Math.min(mw - 1, Math.max(0, Math.floor((wx / level.pxW) * mw)));
  const toY = (wy) => oy + toRow(Math.floor((wy / level.pxH) * th));

  // ---- 视野框（四个角，不遮挡地形）
  const cam = game.cam;
  const vx0 = toX(cam.x), vy0 = toY(cam.y);
  const vx1 = toX(cam.x + 320), vy1 = toY(cam.y + 180);
  const vw = Math.max(3, vx1 - vx0), vh = Math.max(3, vy1 - vy0);
  const L = 2;
  s.hline(vx0, vy0, Math.min(L, vw), C.accent);
  s.hline(vx1 - Math.min(L, vw), vy0, Math.min(L, vw), C.accent);
  s.hline(vx0, vy1 - 1, Math.min(L, vw), C.accent);
  s.hline(vx1 - Math.min(L, vw), vy1 - 1, Math.min(L, vw), C.accent);
  s.vline(vx0, vy0, Math.min(L, vh), C.accent);
  s.vline(vx1 - 1, vy0, Math.min(L, vh), C.accent);
  s.vline(vx0, vy1 - Math.min(L, vh), Math.min(L, vh), C.accent);
  s.vline(vx1 - 1, vy1 - Math.min(L, vh), Math.min(L, vh), C.accent);

  // ---- 敌人（只画屏幕外的：视野内的玩家自己看得见，不重复信息）
  for (const e of game.enemies) {
    if (e.dead) continue;
    const inView = e.cx > cam.x - 8 && e.cx < cam.x + 328 && e.cy > cam.y - 8 && e.cy < cam.y + 188;
    if (inView) continue;
    s.px(toX(e.cx), toY(e.cy), C.accent);
  }

  // ---- 玩家：三点箭头（中间挖空，压在剖面线上也看得清）
  const p = game.player;
  const pxm = toX(p.cx), pym = toY(p.cy);
  s.px(pxm, pym, C.panel);
  s.px(pxm, pym - 1, C.text);
  s.px(pxm + (p.facing > 0 ? 1 : -1), pym, C.accent);

  // ---- 关卡模式出口（闪烁）
  if (game.mode !== "endless" && level.exit) {
    const exm = toX(level.exit.x), eym = toY(level.exit.y - 10);
    const blink = Math.floor((game.time ?? 0) * 3) % 2 === 0;
    s.px(exm, eym, blink ? C.accent : C.dim);
    if (blink) s.px(exm, eym + 1, C.accent);
  }

  return { x: bx, y: by, w: boxW, h: boxH };
}
