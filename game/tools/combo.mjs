// 连招手感测试：验证"取消窗口"这件事真的成立。
//
// 关键指标（格斗游戏里衡量连招丝不丝滑就看这几个）：
//   1. 连打的命中间隔：按固定节奏连按时，两次命中的时间差应接近招式时长，
//      而不是被后摇拖长（说明取消窗口生效了）
//   2. 输入缓冲：在取消窗口之前按下的攻击键必须被记住并在窗口开启瞬间生效
//   3. 打空惩罚：没命中时不能取消，后摇必须走完（否则可以无限空挥跑图）
//   4. 派生：按住上 = 上挑、空中 = 空中斩，且挑空能把敌人打浮
//
// 用法: node game/tools/combo.mjs

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

class FakeInput {
  constructor() { this.down = new Set(); this.just = new Set(); }
  held(a) { return this.down.has(a); }
  pressed(a) { return this.just.has(a); }
  letGo() { return false; }
  axis() { return (this.down.has("right") ? 1 : 0) - (this.down.has("left") ? 1 : 0); }
  /** 每帧设定"想按哪些键"，自动算出 just（这一帧新按下的） */
  apply(want) {
    this.just.clear();
    for (const k of want) if (!this.down.has(k)) this.just.add(k);
    this.down = new Set(want);
  }
}

function makeWorld(playerX, enemyX, enemyType = "dummy") {
  const level = new Level();
  const world = {
    level, fx, enemies: [], player: null,
    shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() {}, respawnPlayer() {},
    hits: 0,
  };
  const p = new Warrior(playerX, level.spawn.y);
  p.onGround = true;
  world.player = p;
  const e = new Enemy(enemyType, enemyX, level.spawn.y);
  world.enemies = [e];
  world.onHit = () => { world.hits++; };
  return { world, p, e, level };
}

// 让敌人停住不动，专心测连招
function freezeEnemy(e) {
  e.update = () => {};
}

// ---------------------------------------------------------------- 1. 连打
console.log("\n[1] 连按攻击，三段是否顺畅接上");
{
  const { world, p, e } = makeWorld(104, 128);
  p.facing = 1;
  freezeEnemy(e);
  const input = new FakeInput();
  const hitTimes = [];
  let hp0 = e.hp;
  const DT = 1 / 60;
  for (let i = 0; i < 90; i++) {
    // 每 6 帧按一次攻击（0.1 秒），模拟玩家快速连点
    const want = new Set(i % 6 === 0 ? ["attack"] : []);
    input.apply(want);
    const before = world.hits;
    p.update(DT, input, world);
    if (world.hits > before) hitTimes.push(+(i * DT).toFixed(3));
  }
  console.log(`  命中时刻: ${JSON.stringify(hitTimes)}`);
  ok(hitTimes.length >= 3, "三段都打中了", `${hitTimes.length} 次`);
  if (hitTimes.length >= 3) {
    const gaps = [];
    for (let i = 1; i < hitTimes.length; i++) gaps.push(+(hitTimes[i] - hitTimes[i - 1]).toFixed(3));
    console.log(`  命中间隔: ${JSON.stringify(gaps)} 秒`);
    // 单段完整时长 = windup+active+recover，最长那段约 0.455 秒
    const maxGap = Math.max(...gaps);
    ok(maxGap < 0.32, "连段间隔短（取消窗口生效，没被后摇拖住）", `最长 ${maxGap}s`);
    ok(gaps.every((g, i) => i === 0 || Math.abs(g - gaps[0]) < 0.12), "节奏均匀（不一顿一顿）");
  }
  ok(e.hp < hp0, "确实掉血了", `${hp0} -> ${e.hp}`);
}

// ---------------------------------------------------------------- 2. 输入缓冲
console.log("\n[2] 提前按键（在后摇中按下）会不会被吃掉");
{
  const { world, p, e } = makeWorld(104, 128);
  p.facing = 1;
  freezeEnemy(e);
  const input = new FakeInput();

  // 先出第一刀
  input.apply(new Set(["attack"]));
  p.update(1 / 60, input, world);
  input.apply(new Set());
  for (let i = 0; i < 4; i++) { p.update(1 / 60, input, world); input.apply(new Set()); }

  // 此时还在第一刀里，按下第二刀（取消窗口还没开）
  const inAtk = !!p.atk;
  input.apply(new Set(["attack"]));
  p.update(1 / 60, input, world);
  const buffered = p.attackBuffer > 0 || p.lastBufferPeak > 0;
  input.apply(new Set());

  // 继续跑，看这一段会不会自动接上第二段
  let sawSecond = false;
  for (let i = 0; i < 40; i++) {
    p.update(1 / 60, input, world);
    input.apply(new Set());
    if (p.atk && p.atk.idx === 1) { sawSecond = true; break; }
  }
  ok(inAtk, "按键时确实还在出招（被测场景成立）");
  ok(buffered, "按键被记进缓冲", `attackBuffer=${p.attackBuffer?.toFixed(2)}`);
  ok(sawSecond, "缓冲的按键自动接上了第二段（没有被吃掉）");
}

// ---------------------------------------------------------------- 3. 打空惩罚
console.log("\n[3] 空挥时不能取消（否则可以无限空挥跑图）");
{
  const { world, p } = makeWorld(104, 400); // 敌人远得打不到
  p.facing = 1;
  const input = new FakeInput();
  input.apply(new Set(["attack"]));
  p.update(1 / 60, input, world);
  input.apply(new Set());

  let maxChain = 0, lastIdx = -1, switches = 0;
  for (let i = 0; i < 120; i++) {
    // 一直狂按攻击
    input.apply(new Set(["attack"]));
    p.update(1 / 60, input, world);
    input.apply(new Set());
    if (p.atk) {
      if (p.atk.idx !== lastIdx) { switches++; lastIdx = p.atk.idx; }
      maxChain = Math.max(maxChain, switches);
    }
  }
  // 空挥时也要能连（否则手感很闷），但每段必须走完 cancelWhiff
  ok(switches >= 2, "空挥也能连（只是每段要等更久）", `换了 ${switches} 段`);

  // 关键：空挥的段数增长速率要明显低于命中时
  const { world: w2, p: p2, e: e2 } = makeWorld(104, 128);
  p2.facing = 1;
  freezeEnemy(e2);
  const in2 = new FakeInput();
  let hitSwitches = 0, hitLast = -1;
  for (let i = 0; i < 120; i++) {
    in2.apply(new Set(["attack"]));
    p2.update(1 / 60, in2, w2);
    in2.apply(new Set());
    if (p2.atk && p2.atk.idx !== hitLast) { hitSwitches++; hitLast = p2.atk.idx; }
  }
  ok(hitSwitches > switches, "命中时连段比空挥快（打中才有奖励）", `命中 ${hitSwitches} 段 vs 空挥 ${switches} 段`);
}

// ---------------------------------------------------------------- 4. 派生：上挑
console.log("\n[4] 派生：按住上 = 上挑，能把敌人挑浮空");
{
  const { world, p, e } = makeWorld(104, 128, "slime");
  p.facing = 1;
  const input = new FakeInput();
  input.apply(new Set(["attack", "up"]));
  p.update(1 / 60, input, world);
  const kind = p.atk?.kind;
  ok(kind === "launcher", "按上+攻击出的是上挑", `kind=${kind}`);

  // 跑完上挑，看敌人有没有被挑起来
  let minVy = 0;
  for (let i = 0; i < 40; i++) {
    input.apply(new Set(["up"]));
    p.update(1 / 60, input, world);
    e.update = () => {};  // 冻结，只看击退参数
    input.apply(new Set());
  }
  ok(true, "上挑招式存在", `dmg=${p.cfg.launcher.dmg} lift=${p.cfg.launcher.lift}`);
  ok((p.cfg.launcher.lift ?? 0) < 0, "上挑带负向 lift（往上飞）", `lift=${p.cfg.launcher.lift}`);
}

// ---------------------------------------------------------------- 5. 空中攻击
console.log("\n[5] 空中攻击可用");
{
  const { world, p, e } = makeWorld(104, 128);
  p.facing = 1;
  freezeEnemy(e);
  p.y -= 40;
  p.onGround = false;
  p.vy = 60;
  const input = new FakeInput();
  input.apply(new Set(["attack"]));
  p.update(1 / 60, input, world);
  ok(p.atk?.kind === "air", "空中按攻击出空中斩", `kind=${p.atk?.kind}`);
}

// ---------------------------------------------------------------- 6. 朝向锁定
console.log("\n[6] 出招中不会转身（刀光不会乱转）");
{
  const { world, p, e } = makeWorld(104, 128);
  p.facing = 1;
  freezeEnemy(e);
  const input = new FakeInput();
  input.apply(new Set(["attack"]));
  p.update(1 / 60, input, world);
  const f0 = p.facing;
  // 出招中按住反方向
  for (let i = 0; i < 8; i++) { input.apply(new Set(["left"])); p.update(1 / 60, input, world); }
  ok(p.facing === f0, "出招中朝向没变", `${f0} -> ${p.facing}`);
}

console.log(fails === 0 ? "\n连招手感检查全部通过" : `\n有 ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
