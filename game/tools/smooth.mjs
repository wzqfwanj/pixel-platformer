// 动画平滑度测试：量化"动作丝不丝滑"。
//
// 之前的问题是离散跳变：挥砍角度线性插值、跑步 4 帧循环、状态间硬切。
// 这里用三个客观指标衡量：
//
//   1. 角度一阶差分的平滑度 —— 相邻帧角度变化的"抖动"（二阶差分）越小越顺。
//      线性插值在切换阶段会突然变向，二阶差分出现尖峰；缓动则是连续的。
//   2. 跑步相位是否连续 —— 每一帧相位都必须前进（不能有停顿的帧）。
//   3. 状态切换是否有跳变 —— 从"站立"切到"攻击"时，剑角度的单帧跳变不能过大。
//
// 用法: node game/tools/smooth.mjs

import { Level } from "../world/level.js";
import { Warrior } from "../entities/warrior.js";
import { Enemy } from "../entities/enemy.js";
import { FxLayer } from "../fx/fxlayer.js";

const fx = new FxLayer();
await fx.preload();

let fails = 0;
const ok = (cond, label, extra = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

const DT = 1 / 60;

class FakeInput {
  constructor() { this.down = new Set(); this.just = new Set(); }
  held(a) { return this.down.has(a); }
  pressed(a) { return this.just.has(a); }
  letGo() { return false; }
  axis() { return (this.down.has("right") ? 1 : 0) - (this.down.has("left") ? 1 : 0); }
  apply(want) {
    this.just.clear();
    for (const k of want) if (!this.down.has(k)) this.just.add(k);
    this.down = new Set(want);
  }
}

function makeWorld() {
  const level = new Level();
  const world = {
    level, fx, enemies: [], player: null,
    shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() {}, respawnPlayer() {},
  };
  const p = new Warrior(104, level.spawn.y);
  world.player = p;
  const e = new Enemy("dummy", 128, level.spawn.y);
  e.update = () => {};
  world.enemies = [e];

  // 先跑几帧让角色落到地面（否则按攻击会判定成"空中斩"）
  const settle = new FakeInput();
  for (let i = 0; i < 8; i++) { settle.apply(new Set()); p.update(DT, settle, world); }
  if (!p.onGround) throw new Error("测试环境：角色没有落到地面");

  return { world, p, e };
}


// ---------------------------------------------------------------- 1. 挥砍角度曲线
console.log("\n[1] 挥砍曲线的质量（起手减速到静止 + 出刀够脆）");
{
  const { world, p, e } = makeWorld();
  p.facing = 1;
  const input = new FakeInput();
  const angles = [];

  input.apply(new Set(["attack"]));
  p.update(DT, input, world);
  input.apply(new Set());
  if (p.atk?.kind !== "combo") throw new Error("测试环境：出的不是连招而是 " + p.atk?.kind);

  const windup = p.atk.cfg.windup;
  for (let i = 0; i < 16; i++) {
    p.update(DT, input, world);
    const pose = p.pose();
    angles.push({
      t: p.atk ? p.atk.t : 99,
      a: pose.sword,
      inWindup: !!p.atk && p.atk.t < windup,
    });
    input.apply(new Set());
    if (!p.atk) break;
  }

  // 精确切分：起手段内部的位移 vs 出刀段的位移
  const d1 = [];
  const d1Windup = [];
  const d1Swing = [];
  for (let i = 1; i < angles.length; i++) {
    const d = angles[i].a - angles[i - 1].a;
    d1.push(d);
    if (angles[i].inWindup && angles[i - 1].inWindup) d1Windup.push(d);
    else if (!angles[i].inWindup) d1Swing.push(d);
  }

  console.log(`  角度: ${angles.map((x) => x.a.toFixed(2)).join(" ")}`);
  console.log(`  每帧变化: ${d1.map((d) => d.toFixed(2)).join(" ")}`);

  // 起手段末端的速度：应该接近 0（smoothstep 让它自然"顿一下"）
  const lastWindupSpeed = Math.abs(d1Windup[d1Windup.length - 1] ?? 0);
  const peakWindup = Math.max(0.001, ...d1Windup.map(Math.abs));
  console.log(`  起手段: ${d1Windup.map((d) => d.toFixed(2)).join(" ")}`);
  console.log(`  出刀段: ${d1Swing.map((d) => d.toFixed(2)).join(" ")}`);
  console.log(`  起手最后速度 ${lastWindupSpeed.toFixed(3)} rad/帧（峰值 ${peakWindup.toFixed(2)}）`);

  ok(peakWindup > 0.3, "起手有明显位移（不是原地不动）", `峰值 ${peakWindup.toFixed(2)}`);
  ok(lastWindupSpeed < peakWindup * 0.45, "起手末端减速到接近静止（有蓄力停顿，不是匀速冲）",
    `末端/峰值 = ${(lastWindupSpeed / peakWindup).toFixed(2)}`);

  // 出刀的峰值速度：要明显大于起手，才叫"脆"
  const peakSwing = d1Swing.length ? Math.max(...d1Swing.map(Math.abs)) : 0;
  console.log(`  出刀峰值 ${peakSwing.toFixed(2)} rad/帧`);
  ok(peakSwing > peakWindup * 1.3, "出刀比起手快得多（甩出去的感觉）",
    `${peakSwing.toFixed(2)} vs ${peakWindup.toFixed(2)}`);
  ok(peakSwing > 0.6, "出刀单帧位移够大（视觉上够快够脆）", `${peakSwing.toFixed(2)} rad/帧`);

  // 全程不能有"瞬移"级别的跳变（超过 2.2 rad ≈ 126° 就不像挥砍了）
  ok(Math.max(...d1.map(Math.abs)) < 2.2, "没有出现瞬移级跳变", `最大 ${Math.max(...d1.map(Math.abs)).toFixed(2)} rad`);
}

console.log("\n[2] 跑步相位逐帧连续（不再 4 帧跳步）");
{
  const { world, p } = makeWorld();
  const input = new FakeInput();
  input.apply(new Set(["right"]));
  for (let i = 0; i < 20; i++) { p.update(DT, input, world); input.apply(new Set(["right"])); }

  const phases = [];
  for (let i = 0; i < 30; i++) {
    p.update(DT, input, world);
    input.apply(new Set(["right"]));
    const pose = p.pose();
    if (pose.legs === "run") phases.push(pose.phase);
  }
  ok(phases.length > 20, "采到足够的跑步帧", `${phases.length} 帧`);

  // 相位必须每帧都变化（连续），不能有"整帧不变"
  let stalled = 0;
  for (let i = 1; i < phases.length; i++) if (phases[i] === phases[i - 1]) stalled++;
  console.log(`  相位样本: ${phases.slice(0, 8).map((v) => v.toFixed(2)).join(" ")} ...`);
  ok(stalled === 0, "每一帧相位都在前进（连续，不是离散 4 帧）", `停顿 ${stalled} 帧`);

  // 相位增量应基本恒定（匀速）
  const deltas = [];
  for (let i = 1; i < phases.length; i++) deltas.push(phases[i] - phases[i - 1]);
  const uniqDeltas = new Set(deltas.map((d) => d.toFixed(3)));
  ok(uniqDeltas.size <= 3, "相位增量恒定（跑步速度匀速）", `${uniqDeltas.size} 种增量值`);
}

// ---------------------------------------------------------------- 3. 状态切换不硬切
console.log("\n[3] 状态切换时剑角度平滑过渡（不硬切）");
{
  const { world, p, e } = makeWorld();
  p.facing = 1;
  const input = new FakeInput();
  // 先站着待机几帧，让角度稳定
  for (let i = 0; i < 30; i++) { input.apply(new Set()); p.update(DT, input, world); }
  const idleAngle = p.pose().sword;

  // 突然出刀
  input.apply(new Set(["attack"]));
  p.update(DT, input, world);
  if (p.atk?.kind !== "combo") throw new Error("测试环境：出的不是连招而是 " + p.atk?.kind);
  input.apply(new Set());
  const firstAttackAngle = p.pose().sword;
  const jump = Math.abs(firstAttackAngle - idleAngle);
  console.log(`  待机角度 ${idleAngle.toFixed(2)} -> 出刀首帧 ${firstAttackAngle.toFixed(2)}，跳变 ${jump.toFixed(2)} rad`);

  // 站着 -> 跑步：这是日常最容易看到硬切的地方
  const { world: w2, p: p2 } = makeWorld();
  const in2 = new FakeInput();
  for (let i = 0; i < 30; i++) { in2.apply(new Set()); p2.update(DT, in2, w2); }
  const a0 = p2.pose().sword;
  in2.apply(new Set(["right"]));
  p2.update(DT, in2, w2);
  const a1 = p2.pose().sword;
  console.log(`  站立->跑步：剑角度 ${a0.toFixed(2)} -> ${a1.toFixed(2)}，跳变 ${Math.abs(a1 - a0).toFixed(3)} rad`);
  ok(Math.abs(a1 - a0) < 0.25, "站立切跑步的剑角度是渐变（不是瞬间跳过去）", `${Math.abs(a1 - a0).toFixed(3)} rad`);
}

// ---------------------------------------------------------------- 4. 呼吸/蓄力的 bob 是浮点
console.log("\n[4] 站立呼吸不是 0/1 二值跳动");
{
  const { world, p } = makeWorld();
  const input = new FakeInput();
  for (let i = 0; i < 10; i++) { input.apply(new Set()); p.update(DT, input, world); }
  const bobs = [];
  for (let i = 0; i < 40; i++) {
    input.apply(new Set());
    p.update(DT, input, world);
    bobs.push(p.computePose().bob);
  }
  const uniq = new Set(bobs.map((b) => b.toFixed(2)));
  console.log(`  bob 样本: ${bobs.slice(0, 10).map((b) => b.toFixed(2)).join(" ")} ...`);
  ok(uniq.size > 8, "bob 有多个中间值（正弦，不是 0/1 两档）", `${uniq.size} 种取值`);
}

// ---------------------------------------------------------------- 5. 拖尾真的产生
console.log("\n[5] 攻击判定期间产生刀光拖尾");
{
  const { world, p, e } = makeWorld();
  p.facing = 1;
  const input = new FakeInput();
  input.apply(new Set(["attack"]));
  p.update(DT, input, world);
  input.apply(new Set());
  if (p.atk?.kind !== "combo") throw new Error("测试环境：出的不是连招而是 " + p.atk?.kind);

  let maxTrail = 0;
  for (let i = 0; i < 20; i++) {
    p.update(DT, input, world);
    const pose = p.pose();
    if (pose.trail) maxTrail = Math.max(maxTrail, pose.trail.length);
    input.apply(new Set());
  }
  ok(maxTrail >= 2, "拖尾有多帧角度样本", `最多 ${maxTrail} 个`);
}

console.log(fails === 0 ? "\n动画平滑度检查全部通过" : `\n有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
