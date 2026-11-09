// 无浏览器的逻辑自测：跑物理、跳跃、连招、掉坑重生，并渲一帧出来看看构图。
// 用法: node tools/test.mjs [--png]

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Level, TILE } from "../world/level.js";
import { Warrior } from "../entities/warrior.js";
import { Enemy } from "../entities/enemy.js";
import { FxLayer, WARRIOR_PALETTE } from "../fx/fxlayer.js";
import { placeCamera, followCamera } from "../world/camera.js";
import { Surface, blitRect } from "../core/screen.js";
import { bakeSky, bakeHills, PARALLAX_W } from "../world/background.js";
import { drawHud } from "../ui/hud.js";
import { hex } from "../core/util.js";

const W = 320, H = 180;
let fails = 0;
const ok = (cond, label, extra = "") => {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${label}${extra ? "  " + extra : ""}`);
  if (!cond) fails++;
};

// ---- 输入桩
class FakeInput {
  constructor() { this.down = new Set(); this.just = new Set(); this.rel = new Set(); }
  held(a) { return this.down.has(a); }
  pressed(a) { return this.just.has(a); }
  letGo(a) { return this.rel.has(a); }
  axis() { return (this.down.has("right") ? 1 : 0) - (this.down.has("left") ? 1 : 0); }
  endFrame() { this.just.clear(); this.rel.clear(); }
  press(a) { this.down.add(a); this.just.add(a); }
  release(a) { this.down.delete(a); this.rel.add(a); }
}

const fx = new FxLayer();
const n = await fx.preload();
console.log(`\n[特效] 载入 ${n}/${Object.keys((await import("../fx/fxlayer.js")).LOADERS ?? {}).length || n} 个`);

const level = new Level();
console.log(`[关卡] ${level.w}x${level.h} 格, 出生点 ${level.spawn.x},${level.spawn.y}, 火把 ${level.torches.length}, 金币 ${level.coins.length}, 敌人 ${level.enemySpawns.length}, 尖刺 ${level.spikes.length}`);

const world = {
  level,
  fx,
  enemies: [],
  player: null,
  shake() {},
  hitLag() {},
  onHit(n) { world.hits += n; },
  onEnemyKilled() { world.kills++; },
  respawnPlayer() { world.respawns++; },
  hits: 0,
  kills: 0,
  respawns: 0,
};
const player = new Warrior(level.spawn.x, level.spawn.y);
world.player = player;

// ---- 1. 站立不下沉
{
  const input = new FakeInput();
  for (let i = 0; i < 60; i++) player.update(1 / 60, input, world);
  ok(player.onGround, "站在地面上", `feet=${player.feet.toFixed(1)}`);
  ok(Math.abs(player.feet - level.spawn.y) < 2, "没有陷进地里", `spawn=${level.spawn.y} feet=${player.feet}`);
}

// ---- 2. 向右跑
{
  const input = new FakeInput();
  input.press("right");
  const x0 = player.x;
  for (let i = 0; i < 60; i++) { player.update(1 / 60, input, world); input.endFrame(); }
  ok(player.x > x0 + 80, "跑得动", `dx=${(player.x - x0).toFixed(1)}`);
  ok(player.state === "run" || player.state === "idle", "跑动状态正确", player.state);
}

// ---- 3. 跳跃高度
{
  const input = new FakeInput();
  const y0 = player.feet;
  input.press("jump");
  let minY = y0;
  for (let i = 0; i < 90; i++) {
    player.update(1 / 60, input, world);
    input.endFrame();
    minY = Math.min(minY, player.feet);
    if (i === 30) { input.release("jump"); input.down.delete("jump"); }
  }
  ok(y0 - minY > 42, "能跳起来（按住）", `高度=${(y0 - minY).toFixed(1)}px`);

  // 轻点一下应该跳得更矮
  const y1 = player.feet;
  input.press("jump");
  let minY2 = y1;
  for (let i = 0; i < 90; i++) {
    player.update(1 / 60, input, world);
    input.endFrame();
    minY2 = Math.min(minY2, player.feet);
    if (i === 3) { input.release("jump"); input.down.delete("jump"); }
  }
  ok(y1 - minY2 < y0 - minY - 5, "松手跳得矮（可变跳跃）", `轻点=${(y1 - minY2).toFixed(1)}px`);
  ok(player.onGround, "能落回地面");
}

// ---- 4. 蓄力斩能打中（唯一的攻击方式）
{
  const dummy = new Enemy("dummy", player.cx + 18, player.feet);
  dummy.update = () => {};
  world.enemies = [dummy];
  const hp0 = dummy.hp;
  const input = new FakeInput();
  const idle = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0 };
  // 按住 K 蓄满（会自动释放）
  input.press("heavy");
  for (let i2 = 0; i2 < 60; i2++) { player.update(1 / 60, input, world); input.endFrame(); }
  input.release("heavy");
  for (let i2 = 0; i2 < 90; i2++) { player.update(1 / 60, idle, world); }
  ok(dummy.hp < hp0, "蓄力斩能打中", `hp ${hp0} -> ${dummy.hp}`);
}

// ---- 5. 蓄力重砸（用干净的角色，避免受前面连招测试的状态影响）
{
  const ch = new Warrior(level.spawn.x, level.spawn.y);
  world.player = ch;
  const dummy = new Enemy("dummy", ch.cx + 14, ch.feet);
  world.enemies = [dummy];
  const hp0 = dummy.hp;
  const input = new FakeInput();
  input.press("heavy");
  for (let i = 0; i < 30; i++) { ch.update(1 / 60, input, world); input.endFrame(); }
  ok(ch.charging, "按住 K 在蓄力", `charge=${ch.charge.toFixed(2)}`);
  input.release("heavy");
  for (let i = 0; i < 60; i++) { ch.update(1 / 60, input, world); input.endFrame(); }
  ok(dummy.hp < hp0, "重砸有伤害", `hp ${hp0} -> ${dummy.hp}`);
  world.player = player;
}

// ---- 6. 掉进坑里会被拉回来
{
  const input = new FakeInput();
  player.hp = player.maxHp;
  player.invuln = 0;
  // 找一个真正的坑（整列都是空的）
  let pitX = -1;
  for (let tx = 0; tx < level.w; tx++) {
    let empty = true;
    for (let ty = 0; ty < level.h; ty++) if (level.at(tx, ty) === "#") empty = false;
    if (empty) { pitX = tx * TILE + 8; break; }
  }
  ok(pitX > 0, "地图里找得到坑", `x=${pitX}`);
  player.x = pitX - player.w / 2;
  player.y = level.pxH - 40;
  player.vy = 200;
  for (let i = 0; i < 40; i++) { player.update(1 / 60, input, world); input.endFrame(); }
  ok(player.hp < player.maxHp || Math.abs(player.feet - level.spawn.y) < 40, "掉出地图会被拉回安全点",
    `hp=${player.hp.toFixed(0)} feet=${player.feet.toFixed(0)}`);
}

// ---- 7. 一个"会玩"的机器人能不能从头走到尾
{
  const p2 = new Warrior(level.spawn.x, level.spawn.y);
  world.player = p2;
  const input = new FakeInput();
  input.press("right");
  let jumpHold = 0, lastX = p2.x, maxX = p2.x, stuck = 0, reachedExitAt = -1;
  for (let i = 0; i < 60 * 90; i++) {
    const aheadX = p2.cx + 12;
    const pitAhead = !level.solidAt(aheadX, p2.feet + 6) && !level.solidAt(aheadX, p2.feet + 20);
    const wallAhead = level.solidAt(p2.cx + 9, p2.feet - 6);
    if (p2.onGround && jumpHold === 0 && (pitAhead || (Math.abs(p2.vx) < 3 && i > 10) || wallAhead)) {
      input.press("jump");
      jumpHold = 14;
    }
    if (jumpHold > 0 && --jumpHold === 0) input.release("jump");
    p2.update(1 / 60, input, world);
    input.endFrame();
    if (Math.abs(p2.x - lastX) < 0.5) stuck++; else stuck = 0;
    lastX = p2.x;
    maxX = Math.max(maxX, p2.x);
    if (p2.cx >= level.exit.x - 8 && reachedExitAt < 0) reachedExitAt = (i / 60) | 0;
    if (stuck > 60 * 6) break; // 六秒没挪窝就算卡死
  }
  ok(maxX > level.pxW * 0.9, "机器人几乎走完全程", `到 x=${maxX.toFixed(0)} / ${level.pxW}`);
  console.log(`  info  用时 ${reachedExitAt < 0 ? "没到" : reachedExitAt + "s"} 到出口, 最久停滞 ${stuck} 帧, 死亡重生 ${world.respawns} 次`);
}

// ---- 8. 渲染一帧看看
{
  const buf = new Surface(W, H);
  buf.out = new Uint8ClampedArray(W * H * 4);
  const sky = bakeSky(W, H), hills = bakeHills(PARALLAX_W, H), baked = level.bake();
  const p = new Warrior(level.spawn.x, level.spawn.y);
  world.player = p;
  world.enemies = [new Enemy("dummy", level.spawn.x + 40, level.spawn.y)];
  fx.spawn("fire/torch", level.spawn.x + 4, level.spawn.y, { sticky: true });
  for (let i = 0; i < 20; i++) fx.update(1 / 60, { x: 0, y: 0 });

  const cam = { x: Math.max(0, Math.min(level.pxW - W, p.cx - W / 2)), y: level.spawn.y - 118 };
  buf.clearLight();
  blitRect(sky, buf, 0, 0, W, H, 0, 0);
  const off = Math.round((cam.x * 0.28) % PARALLAX_W);
  for (let i = -1; i <= 1; i++) blitRect(hills, buf, 0, 0, PARALLAX_W, H, i * PARALLAX_W - off, 0);
  blitRect(baked, buf, Math.round(cam.x), Math.round(cam.y), W, H, 0, 0);
  fx.drawBack(buf, { x: Math.round(cam.x), y: Math.round(cam.y) });
  for (const e of world.enemies) e.draw(buf, cam);
  p.draw(buf, cam);
  fx.drawFront(buf, { x: Math.round(cam.x), y: Math.round(cam.y) });
  drawHud(buf, { player: p, coins: 3, coinTotal: level.coins.length, enemiesKilled: 1, combo: 3, comboTimer: 1, showHint: true, debug: false, won: false, fps: 60, fx });

  // 亮度和颜色统计，确认不是全黑/全白
  let sum = 0, uniq = new Set();
  for (let i = 0; i < W * H; i++) {
    const c = buf.color[i];
    sum += ((c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255)) / 3;
    if (uniq.size < 4000) uniq.add(c);
  }
  const avg = sum / (W * H);
  ok(avg > 12 && avg < 200, "画面亮度正常", `平均亮度=${avg.toFixed(1)}`);
  ok(uniq.size > 60, "颜色丰富（不是一片纯色）", `${uniq.size} 种`);

  // ASCII 预览：把画面按 4x8 像素块压成字符画，肉眼可看的构图检查
  const chars = " .:-=+*#%@";
  let art = "";
  for (let y = 0; y < H; y += 4) {
    let line = "";
    for (let x = 0; x < W; x += 4) {
      let lum = 0;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const c = buf.color[(y + j) * W + (x + i)];
        lum += ((c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255)) / 3;
      }
      lum /= 16;
      line += chars[Math.min(chars.length - 1, Math.floor((lum / 255) * chars.length))];
    }
    art += line + "\n";
  }
  writeFileSync(new URL("./frame.txt", import.meta.url), art);
  console.log("\n---- 画面 ASCII 预览（4x4 块，亮度映射）----");
  console.log(art);

  if (process.argv.includes("--png")) {
    const png = await import("../../pixelfx/tools/lib/png.mjs");
    buf.composite(buf.out);
    mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
    const file = new URL("./out/frame.png", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    png.writePng?.(file, W, H, Buffer.from(buf.out));
    console.log("PNG ->", file, typeof png.writePng);
  }
}

// ---- 9. 角色确实画在屏幕上（相机偏移正确）
{
  const buf = new Surface(200, 120);
  buf.clear(0);
  const cam = { x: 100, y: 50 };
  const p3 = new Warrior(140, 130);      // 世界里脚在 (140,130)，屏幕上应是 (40, 80)
  p3.x = 140 - p3.w / 2;
  p3.draw(buf, cam);
  let drawn = 0, minX = 1e9, maxX = -1e9, maxY = -1e9;
  for (let y = 0; y < buf.h; y++)
    for (let x = 0; x < buf.w; x++) {
      if (buf.color[y * buf.w + x]) {
        drawn++;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  ok(drawn > 200, "角色画出来了两百多像素", `${drawn} px`);
  ok(Math.abs(maxY - 80) <= 3, "角色脚落在屏幕正确高度", `maxY=${maxY} 期望 80±3`);
  ok(Math.abs((minX + maxX) / 2 - 40) <= 8, "角色水平居中于屏幕坐标", `中心 ${((minX + maxX) / 2).toFixed(1)} 期望 40±8`);
}

// ---- 10. 跑动时精灵不抖（曾经相机 lerp 取整导致每秒都在 ±1 抖）
{
  const lv = new Level();
  const w2 = { level: lv, fx: new FxLayer(), enemies: [], player: null, shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() {}, respawnPlayer() {} };
  const pw = new Warrior(lv.spawn.x, lv.spawn.y);
  w2.player = pw;
  const cam2 = placeCamera({ x: 0, y: 0 }, pw, lv);
  const probe = new Surface(80, 60);
  const tops = [], heights = [], centres = [], topByFrame = [];
  const inp = {
    down: new Set(["right"]), just: new Set(),
    held(a) { return this.down.has(a); },
    pressed(a) { return this.just.has(a); },
    letGo() { return false; },
    axis() { return 1; },
    endFrame() { this.just.clear(); },
  };
  for (let i = 0; i < 240; i++) {
    pw.update(1 / 60, inp, w2);
    inp.endFrame();
    followCamera(cam2, pw, lv);
    const centre = Math.round(pw.cx) - cam2.x;
    const wasRun = pw.state === "run";
    if (!wasRun) { centres.push({ c: centre, run: false }); continue; }
    probe.clear(0);
    pw.draw(probe, { x: Math.round(pw.cx) - 40, y: Math.round(pw.feet) - 40 });
    let minY = 1e9, maxY = -1e9, count = 0;
    for (let y = 0; y < probe.h; y++)
      for (let x = 0; x < probe.w; x++)
        if (probe.color[y * probe.w + x]) { count++; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    if (!count) continue;
    tops.push(minY);
    heights.push(maxY - minY + 1);
    centres.push({ c: centre, run: true });
    // 和 warrior.draw() 里选帧的公式保持一致：Math.floor(animT * 10) % 4
    topByFrame.push({ frame: Math.floor(pw.animT * 10) % 4, top: minY });
  }
  const uniqTops = [...new Set(tops)], uniqH = [...new Set(heights)];
  ok(tops.length > 60, "采到了足够的跑动帧", `${tops.length} 帧`);
  // 有真走路循环后，上沿会随帧在小范围内变化，这是「走路弹跳」（正确）。
  // 最可靠的判据：同一个走路帧号必须永远对应同一个上沿 —— 随机抖动会破坏这一点。
  const topRange = Math.max(...tops) - Math.min(...tops);
  ok(topRange <= 2, "跑动时竖直抖动不超过 2px", `幅度 ${topRange}px，取值 ${JSON.stringify(uniqTops)}`);

  const byFrame = new Map();   // 走路帧号 -> 上沿集合
  for (const s of topByFrame) {
    if (!byFrame.has(s.frame)) byFrame.set(s.frame, new Set());
    byFrame.get(s.frame).add(s.top);
  }
  let inconsistent = 0;
  for (const [, set] of byFrame) if (set.size > 1) inconsistent++;
  const frameList = [...byFrame.entries()].map(([f, set]) => `f${f}:${[...set].join("/")}`).join(" ");
  ok(inconsistent === 0,
    "同一走路帧号对应固定的竖直位置（变化来自动画，不是抖动）",
    frameList);

  ok(uniqH.length <= 3, "跑动时精灵高度稳定", `高度取值 ${JSON.stringify(uniqH)}`);
  let back = 0;
  for (let i = 1; i < centres.length; i++) {
    // 只在连续两个跑动帧之间比较（中间夹着跳跃/落地时相机仍在跟进，不算抖）
    if (!centres[i].run || !centres[i - 1].run) continue;
    if (centres[i].c < centres[i - 1].c) back++;
  }
  ok(back === 0, "跑动时屏幕位置单调（无左右回退）", `回退 ${back} 次`);
}



// ---- 13. 无尽模式（刷怪 / 难度递增 / 上限 / 长跑稳定性）
{
  const { execFileSync } = await import("node:child_process");
  const endlessPath = fileURLToPath(new URL("./endless.mjs", import.meta.url));
  try {
    const out = execFileSync(process.execPath, [endlessPath], { encoding: "utf8" });
    const line = out.split("\n").find((l) => l.includes("结束时：")) ?? "";
    ok(out.includes("全部通过"), "无尽模式检查（endless.mjs）", line.trim());
  } catch (e) {
    const bad = ((e.stdout ?? "") + (e.stderr ?? "")).split("\n").filter((l) => l.includes("FAIL"));
    ok(false, "无尽模式检查（endless.mjs）", bad.join(" | ").slice(0, 200));
  }
}

// ---- 14. 小地图（位置 / 剖面完整 / 断口对应 / 标记 / 主题）
{
  const { execFileSync } = await import("node:child_process");
  const mmPath = fileURLToPath(new URL("./minimap.mjs", import.meta.url));
  try {
    const out = execFileSync(process.execPath, [mmPath], { encoding: "utf8" });
    const line = out.split("\n").find((l) => l.includes("内部") && l.includes("列")) ?? "";
    ok(out.includes("全部通过"), "小地图检查（minimap.mjs）", line.trim());
  } catch (e) {
    const bad = ((e.stdout ?? "") + (e.stderr ?? "")).split("\n").filter((l) => l.includes("FAIL"));
    ok(false, "小地图检查（minimap.mjs）", bad.join(" | ").slice(0, 200));
  }
}

// ---- 15. 角色素材（黑衣人帧数据 / 行走循环 / 配色 / 镜像）
{
  const { execFileSync } = await import("node:child_process");
  const ninjaPath = fileURLToPath(new URL("./ninja.mjs", import.meta.url));
  try {
    const out = execFileSync(process.execPath, [ninjaPath], { encoding: "utf8" });
    const line = out.split("\n").find((l) => l.includes("至少") && l.includes("姿势")) ?? "";
    ok(out.includes("全部通过"), "角色素材检查（ninja.mjs）", line.trim());
  } catch (e) {
    const bad = ((e.stdout ?? "") + (e.stderr ?? "")).split("\n").filter((l) => l.includes("FAIL"));
    ok(false, "角色素材检查（ninja.mjs）", bad.join(" | ").slice(0, 200));
  }
}

// ---- 16. 蓄力机制与蓄力条（K 键）
{
  const { execFileSync } = await import("node:child_process");
  const chargePath = fileURLToPath(new URL("./charge.mjs", import.meta.url));
  try {
    const out = execFileSync(process.execPath, [chargePath], { encoding: "utf8" });
    const line = out.split("\n").find((l) => l.includes("充满耗时")) ?? "";
    ok(out.includes("全部通过"), "蓄力机制与蓄力条（charge.mjs）", line.trim());
  } catch (e) {
    const bad = ((e.stdout ?? "") + (e.stderr ?? "")).split("\n").filter((l) => l.includes("FAIL"));
    ok(false, "蓄力机制与蓄力条（charge.mjs）", bad.join(" | ").slice(0, 200));
  }
}

// ---- 17. 攻击系统（只有 K 蓄力斩）
{
  const { execFileSync } = await import("node:child_process");
  const atkPath = fileURLToPath(new URL("./attack.mjs", import.meta.url));
  try {
    const out = execFileSync(process.execPath, [atkPath], { encoding: "utf8" });
    const line = out.split("\n").find((l) => l.includes("敌人被打中")) ?? "";
    ok(out.includes("全部通过"), "攻击系统（attack.mjs）", line.trim());
  } catch (e) {
    const bad = ((e.stdout ?? "") + (e.stderr ?? "")).split("\n").filter((l) => l.includes("FAIL"));
    ok(false, "攻击系统（attack.mjs）", bad.join(" | ").slice(0, 200));
  }
}

// ---- 18. 启动菜单（进入游戏前选模式）
{
  const { execFileSync } = await import("node:child_process");
  const menuPath = fileURLToPath(new URL("./menu.mjs", import.meta.url));
  try {
    const out = execFileSync(process.execPath, [menuPath], { encoding: "utf8" });
    const line = out.split("\n").find((l) => l.includes("默认选中")) ?? "";
    ok(out.includes("全部通过"), "启动菜单（menu.mjs）", line.trim());
  } catch (e) {
    const bad = ((e.stdout ?? "") + (e.stderr ?? "")).split("\n").filter((l) => l.includes("FAIL"));
    ok(false, "启动菜单（menu.mjs）", bad.join(" | ").slice(0, 200));
  }
}

// ---- 19. 移动能力：自动跨 1 格台阶（曾经卡死在 x≈412）
{
  const lv19 = new Level();
  const w19 = { level: lv19, fx: new FxLayer(), enemies: [], player: null, shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() {}, respawnPlayer() {} };
  const pp = new Warrior(lv19.spawn.x, lv19.spawn.y);
  w19.player = pp;
  const inp = {
    down: new Set(["right"]), just: new Set(),
    held(a) { return this.down.has(a); },
    pressed(a) { return this.just.has(a); },
    letGo: () => false,
    axis() { return 1; },
    endFrame() { this.just.clear(); },
  };
  for (let i = 0; i < 20; i++) pp.update(1 / 60, inp, w19);

  // 一路向右跑 30 秒，记录最久连续不动
  let lastX = pp.x, stuck = 0, worstStuck = 0, worstX = 0;
  const startX = pp.x;
  let jumpHold = 0;
  for (let i = 0; i < 60 * 30; i++) {
    // 正常玩家行为：前方没地面、或被挡住，就跳
    const aheadX = pp.cx + 14;
    const pitAhead = !lv19.solidAt(aheadX, pp.feet + 6) && !lv19.solidAt(aheadX, pp.feet + 22);
    const wallAhead = lv19.solidAt(pp.cx + pp.w / 2 + 4, pp.feet - 8);
    if (pp.onGround && jumpHold <= 0 && (pitAhead || wallAhead || (Math.abs(pp.vx) < 3 && i > 10))) {
      inp.just.add("jump");
      jumpHold = 14;
    }
    if (jumpHold > 0 && --jumpHold === 0) inp.down.delete("jump");
    else if (jumpHold > 0) inp.down.add("jump");
    pp.update(1 / 60, inp, w19);
    inp.endFrame();
    if (Math.abs(pp.x - lastX) < 0.05) {
      stuck++;
      if (stuck > worstStuck) { worstStuck = stuck; worstX = pp.x; }
    } else stuck = 0;
    lastX = pp.x;
  }
  const dist = pp.x - startX;
  ok(dist > 1200, "30 秒内能推进足够远（没被台阶卡死）", `推进 ${dist.toFixed(0)}px，终点 x=${pp.x.toFixed(0)}`);
  ok(worstStuck < 90, "没有长时间原地不动", `最久停滞 ${worstStuck} 帧 @x=${worstX.toFixed(0)}`);
}

// ---- 20. 蓄力/攻击状态下掉进坑，也会被拉回来（曾经无限下坠）
{
  const lv20 = new Level();
  const w20 = { level: lv20, fx: new FxLayer(), enemies: [], player: null, shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() {}, respawnPlayer() {} };
  const q = new Warrior(lv20.spawn.x, lv20.spawn.y);
  w20.player = q;
  q.safe = { x: lv20.spawn.x, y: lv20.spawn.y };
  const inp20 = {
    down: new Set(["heavy"]), just: new Set(["heavy"]),
    held: (a) => a === "heavy",
    pressed: (a) => a === "heavy",
    letGo: () => false,
    axis: () => 0,
    endFrame() { this.just.clear(); },
  };
  q.update(1 / 60, inp20, w20);
  inp20.just.clear();
  // 强行扔到地图下方（模拟蓄力时掉进坑）
  q.y = lv20.pxH + 200;
  let maxY = q.y;
  for (let i = 0; i < 120; i++) {
    q.update(1 / 60, inp20, w20);
    maxY = Math.max(maxY, q.y);
    inp20.endFrame();
  }
  ok(maxY < lv20.pxH + 400, "没有无限下坠", `最深处 y=${maxY.toFixed(0)}，地图高 ${lv20.pxH}`);
  ok(Math.abs(q.y - (q.safe.y - q.h)) < 60, "被拉回安全点", `y=${q.y.toFixed(0)} 安全点=${(q.safe.y - q.h).toFixed(0)}`);
  ok(!q.charging || q.charge < 0.9, "掉落时清掉了蓄力状态", `charging=${q.charging}`);
}

console.log(fails ? `\n${fails} 项失败` : "\n全部通过");
process.exit(fails ? 1 : 0);
