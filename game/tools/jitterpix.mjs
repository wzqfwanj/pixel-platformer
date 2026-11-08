// 像素级抖动验证：不靠逻辑数据，直接看"角色在画面上的像素位置"。
// 每帧用真实的 warrior.draw() 画到一张干净画布上，找出角色像素的包围盒，
// 再结合相机，算出它在屏幕上相对地面的位置，检查有没有 ±1 来回。
//
// 用法: node game/tools/jitterpix.mjs [帧数]

import { Surface } from "../core/screen.js";
import { Level } from "../world/level.js";
import { Warrior } from "../entities/warrior.js";
import { followCamera, placeCamera, renderCamera } from "../world/camera.js";
import { FxLayer } from "../fx/fxlayer.js";
import { WARRIOR_W, WARRIOR_H } from "../entities/warriorArt.js";

const N = Number(process.argv[2] ?? 240);
const W = 320, H = 180;

const level = new Level();
const fx = new FxLayer();
await fx.preload();
const world = { level, fx, enemies: [], player: null, shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() {}, respawnPlayer() {} };
const p = new Warrior(level.spawn.x, level.spawn.y);
world.player = p;

class FakeInput {
  constructor() { this.down = new Set(["right"]); this.just = new Set(); }
  held(a) { return this.down.has(a); }
  pressed(a) { return this.just.has(a); }
  letGo() { return false; }
  axis() { return 1; }
  endFrame() { this.just.clear(); }
}
const input = new FakeInput();
const cam = placeCamera({ x: 0, y: 0 }, p, level);

// 一块够大的画布，把角色画在固定的世界原点附近，用来读包围盒
const probe = new Surface(80, 60);
const rows = [];

for (let i = 0; i < N; i++) {
  p.update(1 / 60, input, world);
  input.endFrame();
  followCamera(cam, p, level);
  const rc = renderCamera(cam, 0);

  // 用一个固定偏移的虚拟相机把角色摆到 probe 中间，这样包围盒只反映角色自身（姿势/摆动）
  probe.clear(0);
  p.draw(probe, { x: Math.round(p.cx) - 40, y: Math.round(p.feet) - 40 });
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, count = 0;
  for (let y = 0; y < probe.h; y++)
    for (let x = 0; x < probe.w; x++) {
      if (!probe.color[y * probe.w + x]) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

  // 相对地面的锚点：角色脚底的世界坐标 - 相机 = 屏幕上应该出现的位置
  rows.push({
    i,
    state: p.state,
    feetWorld: Math.round(p.feet),
    screenFeetY: Math.round(p.feet) - rc.y,
    screenCx: Math.round(p.cx) - rc.x,
    bbox: count ? { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1, count } : null,
  });
}

const use = rows.filter((r) => r.state === "run" && r.bbox);
console.log(`采样 ${rows.length} 帧，其中跑动 ${use.length} 帧\n`);

const analyze = (label, pick) => {
  // 关键：只在【原序列 rows】里真正相邻、且两帧都为 run 时比较。
  // 不能用 use（过滤后的数组）算差分，那会跨过中间的非 run 帧。
  const d = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.state !== "run" || b.state !== "run" || !a.bbox || !b.bbox) continue;
    d.push(pick(b) - pick(a));
  }
  const counts = {};
  for (const x of d) counts[x] = (counts[x] ?? 0) + 1;
  let flips = 0, tiny = 0;
  for (let i = 1; i < d.length; i++) {
    if (Math.abs(d[i]) === 1) tiny++;
    if (d[i] !== 0 && d[i - 1] !== 0 && Math.sign(d[i]) !== Math.sign(d[i - 1])) flips++;
  }
  console.log(`  ${label.padEnd(20)} ${JSON.stringify(counts).padEnd(40)} 反向 ${flips}  ±1变化 ${tiny}`);
  return { counts, flips, tiny };
};

console.log("每帧位移：");
const bboxX = analyze("精灵包围盒左沿", (r) => r.bbox.minX);
const bboxY = analyze("精灵包围盒上沿", (r) => r.bbox.minY);
const bboxW = analyze("精灵包围盒宽", (r) => r.bbox.w);
const bboxH = analyze("精灵包围盒高", (r) => r.bbox.h);
const sFeet = analyze("脚底屏幕 Y", (r) => r.screenFeetY);
const sCx = analyze("角色屏幕中心 X", (r) => r.screenCx);

// 包围盒宽高应该恒定（同一姿势），变宽变高说明有残留像素没清掉或姿势跳变
const widths = [...new Set(use.map((r) => r.bbox.w))];
const heights = [...new Set(use.map((r) => r.bbox.h))];
console.log(`\n包围盒尺寸种类：宽 ${JSON.stringify(widths)} 高 ${JSON.stringify(heights)}`);

// 姿势 bob 的频率：上沿每帧变化的次数
const topVals = use.map((r) => r.bbox.minY);
let switches = 0;
for (let i = 1; i < topVals.length; i++) if (topVals[i] !== topVals[i - 1]) switches++;
const hz = (switches / use.length) * 60 / 2;
console.log(`上沿变化 ${switches} 次 / ${use.length} 帧 -> 上下摆动约 ${hz.toFixed(1)} Hz`);

console.log("\n判定：");
let bad = 0;
if (bboxX.flips > 2) { console.log(`  ✗ 精灵水平方向反向 ${bboxX.flips} 次`); bad++; }
else console.log("  ✓ 精灵自身在画布里位置稳定（水平无来回）");
if (sCx.flips > 2) { console.log(`  ✗ 角色屏幕中心 X 反向 ${sCx.flips} 次 —— 横向抖动`); bad++; }
else console.log("  ✓ 角色屏幕 X 单调（死区跟随起作用）");
if (sFeet.flips > 0) { console.log(`  ✗ 脚底屏幕 Y 有反向 ${sFeet.flips} 次 —— 竖直抖动`); bad++; }
else console.log("  ✓ 脚底屏幕 Y 无反向");
// 连续腿动会让包围盒宽度变化，这本身正常（两条腿同一帧各动 1px 时宽度会变 2）。
// 真正的判据是"每一条轮廓边每帧最多动 1 像素"，那才是眼睛看到的平滑度。
// 只比较原序列里真正相邻的帧（过滤后的 use 会跨越中间的 idle/fall 帧）
const edgeJump = (pick) => {
  let m = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.state !== "run" || b.state !== "run" || !a.bbox || !b.bbox) continue;
    m = Math.max(m, Math.abs(pick(b) - pick(a)));
  }
  return m;
};
const jumpL = edgeJump((r) => r.bbox.minX), jumpR = edgeJump((r) => r.bbox.maxX);
console.log(`  宽度取值 ${JSON.stringify(widths)}；左边缘单帧最大移动 ${jumpL}px，右边缘 ${jumpR}px`);
if (jumpL > 1 || jumpR > 1) {
  console.log(`  ✗ 轮廓边缘单帧跳变超过 1px（左 ${jumpL} / 右 ${jumpR}）`);
  bad++;
} else {
  console.log("  ✓ 轮廓逐帧平滑（每条边每帧最多动 1px，腿连续摆动）");
}
if (bboxH.flips > 4) { console.log(`  ✗ 包围盒高度在跳 ${JSON.stringify(bboxH.counts)}`); bad++; }

console.log("\n前 16 帧明细（包围盒 = 角色自身在画布上的像素范围）：");
console.log("   i  state  bbox(x,y,w,h)  count  屏幕脚Y  屏幕中心X");
for (const r of use.slice(0, 16)) {
  const b = r.bbox;
  console.log(`  ${String(r.i).padStart(3)}  ${r.state.padEnd(5)} (${b.minX},${b.minY},${b.w},${b.h})`.padEnd(34) +
    `${String(b.count).padStart(5)} ${String(r.screenFeetY).padStart(7)} ${String(r.screenCx).padStart(9)}`);
}

console.log(bad === 0 ? "\n结论：像素级检查通过，没有抖动" : `\n结论：发现 ${bad} 处问题`);
process.exit(bad === 0 ? 0 : 1);
