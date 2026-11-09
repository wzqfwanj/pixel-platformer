// 横板像素闯关 demo —— 战士职业
// 渲染全软件：一块 320x180 的 Uint32 缓冲，最后 putImageData 一次。
// 特效来自 pixelfx（同目录上级的 ../pixelfx），光照会叠到场景上。

import { Surface, blitRect } from "./core/screen.js";
import { hex, aabb } from "./core/util.js";
import { Input } from "./core/input.js";
import { drawText } from "./core/text.js";
import { Level } from "./world/level.js";
import { bakeSky, bakeHills, PARALLAX_W } from "./world/background.js";
import { placeCamera, followCamera, renderCamera } from "./world/camera.js";
import { coinRows, COIN_COLORS } from "./world/tiles.js";
import { Warrior } from "./entities/warrior.js";
import { Enemy } from "./entities/enemy.js";
import { FxLayer, WARRIOR_PALETTE } from "./fx/fxlayer.js";
import { StartMenu } from "./ui/startmenu.js";
import { ScorchLayer } from "./fx/scorch.js";
import { drawHud } from "./ui/hud.js";
import { collectCoins } from "./world/pickups.js";
import { Spawner } from "./world/spawner.js";
import { buildArena } from "./world/arena.js";
import { getTheme, setTheme, toggleTheme, applyThemeToPage, themeNames } from "./core/theme.js";

const W = 320, H = 180;
const STEP = 1 / 60;

// 主题：明暗切换 + 黑白色调，具体色值定义在 core/theme.js。
// 这里只负责"当前主题下画布底色和传送门该用什么颜色"。
function getThemeColors() {
  const t = getTheme();
  const dark = t.name === "dark";
  return {
    bg: hex(t.canvasBg),
    exitLight: dark ? hex("#ffd08a") : hex("#b08850"),
    exitText: dark ? hex("#ffd94a") : hex("#7a6030"),
    exitShadow: dark ? hex("#141021") : undefined,
    exitArchA: dark ? hex("#6a7a9a") : hex("#7a7a7a"),
    exitArchB: dark ? hex("#2b3348") : hex("#b0b0b0"),
  };
}

const game = {
  W, H,
  level: null,
  baked: null,
  sky: null,
  hills: null,
  player: null,
  enemies: [],
  fx: new FxLayer(),
  scorch: new ScorchLayer(),
  input: new Input(),
  cam: { x: 0, y: 0 },
  shakeAmt: 0,
  hitLagT: 0,
  releaseCount: 0,   // 蓄力释放次数（调试用，确认"每次都释放"）
  time: 0,
  fps: 60,
  coins: 0,
  coinTotal: 0,
  enemiesKilled: 0,
  combo: 0,
  comboBest: 0,
  comboTimer: 0,
  won: false,
  mode: "level",     // "level" 关卡模式 | "endless" 无尽模式
  menu: null,        // 启动菜单（非 null 时游戏暂停）
  scene: "menu",     // "menu" 选模式 | "playing" 游戏中
  spawner: null,
  surviveTime: 0,
  waveText: "",
  waveT: 0,
  debug: false,
  showHint: true,
};

// ---------------- world 接口（实体里回调这些）
game.shake = (a) => { game.shakeAmt = Math.max(game.shakeAmt, a); };
game.hitLag = (t) => { game.hitLagT = Math.max(game.hitLagT, t); };
game.onHit = (n, move) => {
  game.combo += n;
  game.comboTimer = 1.8;
  game.comboBest = Math.max(game.comboBest ?? 0, game.combo);

  // 连段越多，画面反馈越强
  const c = game.combo;
  const p = game.player;
  if (c >= 2) {
    // 每一段都来一点"顿挫"：小抖
    game.shake(0.8 + Math.min(2.5, c * 0.25));
  }
  if (c % 3 === 0) {
    game.fx.spawn("ui/combo-counter", p.cx, p.y - 16, {
      count: c, palette: WARRIOR_PALETTE, seed: Math.random() * 100,
    });
  }
  // 重击（第 3 段）额外加特写式特效
  if (move && move.crit) {
    game.fx.spawn("impacts/crit-hit", p.cx + p.facing * 20, p.cy, {
      flip: p.facing < 0, seed: Math.random() * 100,
    });
  }
};
game.onEnemyKilled = () => {
  game.enemiesKilled++;
  game.shake(2.5);
};
game.respawnPlayer = () => {
  // 无尽模式没有复活：死了就是结束，等玩家按 R
  if (game.mode === "endless") return;
  const p = game.player;
  p.hp = p.maxHp;
  p.state = "idle";
  p.deadT = 0;
  p.x = p.safe.x - p.w / 2;
  p.y = p.safe.y - p.h;
  p.vx = 0; p.vy = 0;
  p.invuln = 1.2;
  game.shake(4);
};

/** 清掉玩家身上的攻击态（通关 / 死亡 / 回菜单时调用） */
function clearPlayerAttack(pl) {
  if (!pl) return;
  pl.charging = false;
  pl.charge = 0;
  pl._fullFrames = 0;
  if (pl.chargeFx) { pl.chargeFx.fx.stop(); pl.chargeFx = null; }
  // slash 不强制清：让它自己走完，否则特效会被截断
}

// ---------------- 主题
function cycleTheme() {
  const t = toggleTheme();
  applyThemeToPage(t);
  try { localStorage.setItem("theme", t.name); } catch { /* 隐私模式下忽略 */ }
  return t;
}

/** 启动时决定用哪套主题：URL 参数 > 上次选择 > 跟随系统 */
function initTheme() {
  const q = new URLSearchParams(location.search).get("theme");
  let name = q && themeNames.includes(q) ? q : null;
  if (!name) {
    try { name = localStorage.getItem("theme"); } catch { name = null; }
  }
  if (!name || !themeNames.includes(name)) {
    name = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  applyThemeToPage(setTheme(name));

  const btn = document.getElementById("theme");
  if (btn) btn.addEventListener("click", () => { cycleTheme(); btn.blur(); });
}

// ---------------- 初始化
function reset(mode = game.mode) {
  game.mode = mode;
  game.spawner = null;
  game.surviveTime = 0;
  game.waveText = "";
  game.waveT = 0;

  if (mode === "endless") {
    const arena = buildArena();
    game.level = new Level(arena.rows);
    game.baked = game.level.bake();
    game.player = new Warrior(arena.spawn.x, arena.spawn.y);
    game.player.safe = { x: arena.spawn.x, y: arena.spawn.y };
    game.enemies = [];
    game.coins = 0;
    game.coinTotal = 0;
    game.spawner = new Spawner(Math.random);
    game.showHint = false;
  } else {
    game.level = new Level();
    game.baked = game.level.bake();
    game.player = new Warrior(game.level.spawn.x, game.level.spawn.y);
    game.player.safe = { x: game.level.spawn.x, y: game.level.spawn.y };
    game.enemies = game.level.enemySpawns.map((e) => new Enemy(e.type, e.x, e.y));
    game.coins = 0;
    game.coinTotal = game.level.coins.length;
  }
  game.enemiesKilled = 0;
  game.combo = 0;
  game.comboBest = 0;
  game.comboTimer = 0;
  game.won = false;
  game.shakeAmt = 0;
  game.hitLagT = 0;
  game.scorch.clear();
  for (const c of game.level.coins) { c.taken = false; c.played = false; }
  // 火把是常驻的循环特效
  for (const t of game.level.torches) game.fx.spawn("fire/torch", t.x, t.y + 2, { sticky: true, lift: 1.25 });
  placeCamera(game.cam, game.player, game.level);
}

// ---------------- 每帧逻辑
function update(dt) {
  const input = game.input;

  // ---- 启动菜单：选模式期间不推进游戏
  if (game.scene === "menu") {
    game.time += dt;
    if (input.pressed("debug")) game.debug = !game.debug;
    if (input.pressed("theme")) cycleTheme();
    const picked = game.menu.update(dt, input);
    if (picked) {
      game.scene = "playing";
      game.menu = null;
      reset(picked);
    }
    return;
  }

  game.time += dt;
  game.comboTimer = Math.max(0, game.comboTimer - dt);
  if (game.comboTimer <= 0) game.combo = 0;
  game.shakeAmt = Math.max(0, game.shakeAmt - dt * 22);

  if (input.pressed("restart")) { reset(); return; }
  if (input.pressed("debug")) game.debug = !game.debug;
  if (input.pressed("theme")) cycleTheme();
  // M：回菜单重新选模式
  if (input.pressed("mode")) {
    game.scene = "menu";
    game.menu = new StartMenu();
    return;
  }

  // ---- 兜底：蓄力已满却迟迟没释放，强制放出来
  // 正常情况下 warrior.update 里 charge 到顶就 releaseCharge。
  // 但如果这一帧被 hitLag 跳过、或者处于受伤/死亡等提前 return 的分支，
  // 蓄力条会停在满格而什么都不发生 —— 这里兜住。
  {
    const pl = game.player;
    if (pl) {
      const maxCharge = pl.cfg.heavy.chargeMax;
      if (pl.charging && pl.charge >= maxCharge - 1e-6) {
        pl._fullFrames = (pl._fullFrames || 0) + 1;
        if (pl._fullFrames > 4) {
          // console.warn("[兜底] 蓄力已满 " + pl._fullFrames + " 帧仍未释放，强制放");
          pl._fullFrames = 0;
          pl.releaseCharge(game);
        }
      } else if (pl._fullFrames) {
        pl._fullFrames = 0;
      }
    }
  }

  if (game.hitLagT > 0) {
    // 命中定帧：世界几乎停住，只让特效慢慢走，打击感来源
    game.hitLagT -= dt;
    game.fx.update(dt * 0.12, game.cam);
    game.scorch.update(dt * 0.12);
    return;
  }

  const p = game.player;
  if (!game.won) p.update(dt, input, game);

  // ---- 无尽模式：计生存时间 + 从两侧刷怪
  if (game.mode === "endless" && game.spawner) {
    if (p.state !== "dead") game.surviveTime += dt;
    game.waveT = Math.max(0, game.waveT - dt);
    const wave = game.spawner.update(dt, game, W);
    for (const e of wave) {
      game.enemies.push(e);
      // 刷怪点的提示特效，让玩家能预判
      game.fx.spawn("spawn/spawn-portal", e.cx, e.y + e.h, { seed: e.cx });
    }
  }

  for (const e of game.enemies) e.update(dt, game);

  // 清掉死透的和跑太远的（无尽模式会一直刷，必须回收）
  if (game.mode === "endless") {
    const cullBefore = game.enemies.length;
    game.enemies = game.enemies.filter((e) => {
      if (e.dead && e.deadT > 0.6) return false;
      if (Math.abs(e.cx - p.cx) > W * 2.2) return false;   // 跑出视野两倍屏宽就回收
      return true;
    });
    game.culled = (game.culled ?? 0) + (cullBefore - game.enemies.length);
  }

  // 敌人接触伤害
  if (p.state !== "dead") {
    for (const e of game.enemies) {
      if (e.dead || e.def.contact <= 0 || e.contactCd > 0) continue;
      if (aabb(p.box, e.box) && p.invuln <= 0) {
        if (p.takeDamage(e.def.contact, e.cx, game)) e.contactCd = 0.8;
      }
    }
  }

  // 金币
  if (collectCoins(p.box, game.level.coins) > 0) {
    for (const c of game.level.coins) {
      if (!c.taken || c.played) continue;
      c.played = true;
      game.coins++;
      game.fx.spawn("ui/coin-collect", c.x + 2, c.y + 6, { count: 1, seed: Math.random() * 100 });
    }
  }

  // 无尽模式：死亡即结束（不自动复活，按 R 重开）
  if (game.mode === "endless") {
    if (p.state === "dead" && !game.won) {
      game.won = true;
      game.showHint = false;
      // 清掉残留的蓄力/爆炸状态，避免通关或死亡后蓄力条卡住
      clearPlayerAttack(p);
      game.fx.spawn("ui/level-up", p.cx, p.cy - 10, { seed: 5 });
      game.shake(6);
    }
    followCamera(game.cam, p, game.level);
    game.fx.update(dt, game.cam);
    game.scorch.update(dt);
    return;
  }

  // 终点
  const ex = game.level.exit;
  if (!game.won && Math.abs(p.cx - ex.x) < 14 && Math.abs(p.feet - ex.y) < 40) {
    game.won = true;
    game.showHint = false;
    // 清掉残留的蓄力/爆炸状态，避免通关或死亡后蓄力条卡住
    clearPlayerAttack(p);
    game.fx.spawn("ui/level-up", ex.x, ex.y - 24, { seed: 12 });
    game.fx.spawn("fire/flame-pillar", ex.x, ex.y, { seed: 7 });
    game.shake(5);
  }

  // 统计蓄力释放次数（slash 从无到有算一次）
  if (p.slash && !game.lastSlashSeen) game.releaseCount++;
  game.lastSlashSeen = p.slash;

  followCamera(game.cam, p, game.level);
  game.fx.update(dt, game.cam);
  game.scorch.update(dt);
}

/** 固定步长推进。每次 update 之后都要清掉"刚按下"标记，否则一帧内跑两次会重复触发。 */
function advance(realDt) {
  let acc = realDt;
  let guard = 0;
  while (acc >= STEP && guard++ < 5) {
    update(STEP);
    game.input.endFrame();
    acc -= STEP;
  }
}

// ---------------- 渲染
function render(scratch) {
  const s = scratch;
  const colors = getThemeColors();

  s.clearLight();
  s.clear(colors.bg);

  // ---- 启动菜单：只画菜单，不画游戏世界
  if (game.scene === "menu") {
    // 背后垫一层静态的场景，别让菜单浮在纯色上
    if (game.level) {
      const cam0 = { x: 0, y: Math.max(0, game.level.pxH - H) };
      blitRect(game.sky, s, 0, 0, W, H, 0, 0);
      const off0 = Math.round((cam0.x * 0.28) % PARALLAX_W);
      for (let i = -1; i <= 1; i++) blitRect(game.hills, s, 0, 0, PARALLAX_W, H, i * PARALLAX_W - off0, 0);
      blitRect(game.baked, s, cam0.x, cam0.y, W, H, 0, 0);
    }
    game.menu.draw(s);
    s.composite(scratch.out);
    return;
  }

  const cam = renderCamera(game.cam, game.shakeAmt);

  // 天空
  blitRect(game.sky, s, 0, 0, W, H, 0, 0);
  // 视差山脊（横向循环）
  const off = Math.round((cam.x * 0.28) % PARALLAX_W);
  for (let i = -1; i <= 1; i++) blitRect(game.hills, s, 0, 0, PARALLAX_W, H, i * PARALLAX_W - off, 0);
  // 关卡
  blitRect(game.baked, s, cam.x, cam.y, W, H, 0, 0);

  drawExit(s, cam, colors);

  // 金币
  const phase = Math.floor(game.time * 8);
  for (const c of game.level.coins) {
    if (c.taken) continue;
    const bob = Math.round(Math.sin(game.time * 3 + c.x * 0.2) * 1.5);
    const sx = c.x - cam.x, sy = c.y - cam.y + bob;
    if (sx < -8 || sx > W + 8) continue;
    s.sprite(coinRows(phase + c.phase), COIN_COLORS, Math.round(sx), Math.round(sy));
    s.addGlow(sx + 2, sy + 4, 7, 30, 20, 0);
  }

  // 特效：角色后面那层
  // 烧痕属于地面，画在关卡之后、特效之前
  game.scorch.draw(s, cam);
  game.fx.drawBack(s, cam);

  for (const e of game.enemies) e.draw(s, cam);
  game.player.draw(s, cam);

  // 特效：角色前面那层（光照在 blit 时叠上去）
  game.fx.drawFront(s, cam);

  drawHud(s, game);
  s.composite(scratch.out);
}

function drawExit(s, cam, colors) {
  const ex = game.level.exit;
  const x = ex.x - cam.x, y = ex.y - cam.y;
  if (x < -40 || x > W + 40) return;
  const archTop = Math.round(y - 34);
  for (let k = 0; k < 3; k++) {
    const a = colors.exitArchA, b = colors.exitArchB;
    s.rect(x - 9 + k, archTop + 6 + k, 2, 28, k === 0 ? a : b);
    s.rect(x + 7 - k, archTop + 6 + k, 2, 28, k === 0 ? a : b);
    s.rect(x - 9 + k, archTop + 4 + k, 18 - k * 2, 2, k === 0 ? a : b);
  }
  for (let j = 0; j < 26; j++) {
    const k = 1 - j / 26;
    const wj = Math.max(2, Math.round(13 * k));
    for (let i = -wj; i <= wj; i++) s.blendPx(x + i, archTop + 30 - j, colors.exitLight, 0.09 + 0.12 * k);
  }
  s.addGlow(x, y - 18, 26, 70, 45, 12);
  drawText(s, "EXIT", x, archTop - 9, colors.exitText, { align: "center", shadow: colors.exitShadow });
}

// ---------------- 无人看管的快速验证：?frames=N&script=名称
// 同步推进 N 帧再画一张，把画面和状态通过 HTTP 交给服务器。
// 无头浏览器的 rAF 会被节流，所以不能靠普通截图。
const SCRIPTS = {
  idle: [],
  endless: [
    [0, 40, "right"], [40, 70, "heavy"], [60, 90, "heavy"],
    [90, 130, "left"], [130, 160, "heavy"], [150, 180, "heavy"],
    [180, 240, "right"], [240, 280, "heavy"], [270, 300, "heavy"],
    [300, 360, "left"],
  ],
  // 反复蓄满：按住 40 帧（0.67s，超过 chargeMax 0.55s 会触发自动释放），松开 40 帧
  spamheavy: Array.from({ length: 12 }, (_, i) => [
    [i * 80, i * 80 + 40, "heavy"],
  ]).flat(),
  // 一直按住 K + 向右跑
  holdheavy: [[0, 3600, "heavy"], [0, 3600, "right"]],
  run: [[0, 400, "right"]],
  combat: [
    [0, 70, "right"], [70, 90, "heavy"], [80, 100, "heavy"], [95, 120, "heavy"],
    [130, 190, "right"], [190, 215, "jump"], [200, 260, "right"],
    [262, 292, "heavy"], [300, 340, "right"], [345, 375, "heavy"],
  ],
  showcase: [
    [0, 62, "right"], [62, 86, "heavy"], [78, 104, "heavy"], [96, 128, "heavy"],
    [140, 200, "heavy"], [206, 250, "right"],
  ],
  explore: [[0, 240, "right"], [60, 74, "jump"], [120, 134, "jump"], [180, 194, "jump"]],
};

function makeScriptedInput(scriptName) {
  const script = SCRIPTS[scriptName] ?? SCRIPTS.combat;
  const down = new Set(), just = new Set(), rel = new Set();
  const ai = { jumpHold: 0, cooldown: 0 };
  const auto = scriptName === "auto";

  const input = {
    held: (a) => down.has(a),
    pressed: (a) => just.has(a),
    letGo: (a) => rel.has(a),
    axis: () => (down.has("right") ? 1 : 0) - (down.has("left") ? 1 : 0),
    endFrame: () => { just.clear(); rel.clear(); },
  };

  // 自动闯关：一路向右，前面是坑/被挡住就跳，敌人近了就砍。
  // 跳跃键要"松开"，因为 pressed() 是边沿触发，按住不放不会重复起跳。
  function autoPilot(i) {
    const p = game.player, L = game.level;
    const want = new Set(["right"]);
    if (p.state !== "dead") {
      const aheadX = p.cx + 13;
      const pitAhead = !L.solidAt(aheadX, p.feet + 6) && !L.solidAt(aheadX, p.feet + 22);
      const wallAhead = L.solidAt(p.cx + p.w / 2 + 5, p.feet - 8) || L.solidAt(p.cx + p.w / 2 + 5, p.feet - 16);
      if (ai.cooldown > 0) ai.cooldown--;
      else if (ai.jumpHold > 0) {
        want.add("jump");
        if (--ai.jumpHold === 0) ai.cooldown = 10;
      } else if (p.onGround && (pitAhead || wallAhead || Math.abs(p.vx) < 6)) {
        ai.jumpHold = 13;
        want.add("jump");
      }
      if (game.enemies.find((e) => !e.dead && Math.abs(e.cx - p.cx) < 34 && Math.abs(e.cy - p.cy) < 30)) want.add("heavy");
    }
    return want;
  }

  // 无尽模式的自动操作：靠近最近的怪去打，被贴脸就退，蝙蝠在高处就跳起来砍
  function autoPilotEndless() {
    const p = game.player, L = game.level;
    const want = new Set();
    const alive = game.enemies.filter((e) => !e.dead);
    if (p.state === "dead" || !alive.length) return want;

    const near = alive.reduce((a, b) => (Math.abs(a.cx - p.cx) < Math.abs(b.cx - p.cx) ? a : b));
    const dx = near.cx - p.cx, adx = Math.abs(dx);

    if (adx > 26) want.add(dx > 0 ? "right" : "left");
    else if (adx < 12 && p.hp < p.maxHp * 0.45) want.add(dx > 0 ? "left" : "right");

    if (adx < 36 && Math.abs(near.cy - p.cy) < 34) want.add("heavy");
    if (near.type === "bat" && near.cy < p.cy - 14) want.add("jump");

    // 被两只以上贴身，或血少且有敌人靠近时，用冲刺脱身（无敌帧）
    const closeCount = alive.filter((e) => Math.abs(e.cx - p.cx) < 20 && Math.abs(e.cy - p.cy) < 26).length;
    const inDanger = closeCount >= 2 || (p.hp < p.maxHp * 0.5 && adx < 22);
    if (inDanger && p.dashCd <= 0) {
      want.add("dash");
      want.add(dx > 0 ? "left" : "right");   // 往反方向冲
    }

    // 别走到场地边缘被围死
    if (p.cx < 140) want.add("right");
    if (p.cx > L.pxW - 140) want.add("left");
    return want;
  }

  input.step = (i) => {
    const active = scriptName === "autoendless"
      ? autoPilotEndless()
      : auto ? autoPilot(i) : new Set(script.filter(([a, b]) => i >= a && i < b).map(([,, k]) => k));
    for (const k of active) if (!down.has(k)) just.add(k);
    for (const k of [...down]) if (!active.has(k)) { down.delete(k); rel.add(k); }
    for (const k of active) down.add(k);
  };
  return input;
}

function runHeadless(frames, scriptName) {
  const realInput = game.input;
  game.input = makeScriptedInput(scriptName);
  for (let i = 0; i < frames; i++) {
    game.input.step(i);
    update(STEP);
    game.input.endFrame();
  }
  game.input = realInput;
  return frames;
}

// ---------------- 启动
async function boot() {
  initTheme();

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const info = document.getElementById("info");

  const buf = new Surface(W, H);
  buf.out = new Uint8ClampedArray(W * H * 4);
  const img = new ImageData(buf.out, W, H);

  function resize() {
    const k = Math.max(1, Math.floor(Math.min(window.innerWidth / W, (window.innerHeight - 4) / H)));
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = W * k + "px";
    canvas.style.height = H * k + "px";
  }
  window.addEventListener("resize", resize);
  resize();

  info.textContent = "载入 pixelfx 特效…";
  const n = await game.fx.preload();
  info.textContent = `已载入 ${n} 个特效`;

  game.sky = bakeSky(W, H);
  game.hills = bakeHills(PARALLAX_W, H);

  // URL 参数：
  //   ?mode=level|endless  指定模式
  //   ?menu=1              强制显示启动菜单（默认就显示）
  //   ?frames=N            无头验证，直接进游戏跑帧
  const bootParams = new URLSearchParams(location.search);
  const bootMode = bootParams.get("mode") === "endless" ? "endless" : "level";
  const headless = Number(bootParams.get("frames") || 0) > 0;

  // 先把关卡数据准备好（菜单背景要用）
  reset(bootMode);

  // 菜单显示规则（优先级从高到低）：
  //   ?menu=1  一定显示菜单（截图/调试用）
  //   ?menu=0  一定跳过
  //   ?frames= 无头验证，默认跳过
  //   其他     正常启动，显示菜单
  const menuParam = bootParams.get("menu");
  const skipMenu = menuParam === "1" ? false : (menuParam === "0" || headless);
  if (skipMenu) {
    game.scene = "playing";
    game.menu = null;
  } else {
    game.scene = "menu";
    game.menu = new StartMenu();
  }

  // 无人看管的验证模式：跑 N 帧，把画布和状态交给本地服务器落盘
  const params = new URLSearchParams(location.search);
  const hf = Number(params.get("frames") || 0);
  if (hf > 0 && game.scene === "menu") {
    // 只是要看菜单：渲染一帧就够
    render(buf);
    ctx.putImageData(img, 0, 0);
    info.textContent = "菜单";
    // 同时写进 DOM 属性，无头 --dump-dom 能直接取到
    document.documentElement.dataset.shot = canvas.toDataURL("image/png");
    const postBase = new URL("../", location.href);
    fetch(new URL("__shot", postBase), { method: "POST", body: canvas.toDataURL("image/png") })
      .then((r) => r.text())
      .then((t) => console.log("shot: " + t))
      .catch(() => {});
    const menuMeta = { scene: "menu", menuIndex: game.menu?.index, menuSelected: game.menu?.selected };
    document.documentElement.dataset.meta = JSON.stringify(menuMeta);
    fetch(new URL("__meta", postBase), { method: "POST", body: JSON.stringify(menuMeta) }).catch(() => {});
    return;
  }

  // ---- 页面内自测：用真实键盘事件跑多种场景，检查蓄满是否每次都能释放
  if (params.get("selftest") === "1") {
    const scenario = params.get("scenario") || "hold";
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const chargeMax = game.player.cfg.heavy.chargeMax;
    const trace = [];
    let releases = 0, lastSlash = null;
    let stuckFrames = 0, worstStuck = 0;

    // 按场景决定每帧要发哪些键
    const step = (i) => {
      switch (scenario) {
        case "hold":
          // 按住不放，且模拟浏览器 auto-repeat（每 2 帧重复 keydown）
          if (i === 0 || i % 2 === 0) key("keydown", "KeyK");
          break;
        case "holdmove":
          // 按住 K + 一直按右（真实玩家会边走边蓄）
          if (i === 0 || i % 2 === 0) key("keydown", "KeyK");
          if (i === 0) key("keydown", "KeyD");
          break;
        case "holdjump":
          // 按住 K + 每 40 帧跳一次
          if (i === 0 || i % 2 === 0) key("keydown", "KeyK");
          if (i % 40 === 0) { key("keydown", "Space"); }
          if (i % 40 === 10) { key("keyup", "Space"); }
          break;
        case "tap":
          // 点按：按 40 帧、松 20 帧（不会蓄满，主要看会不会卡死）
          if (i % 60 === 0) key("keydown", "KeyK");
          if (i % 60 === 40) key("keyup", "KeyK");
          break;
      }
    };

    const total = 900;
    for (let i = 0; i < total; i++) {
      step(i);

      if (game.hitLagT > 0) {
        game.hitLagT -= 1 / 60;
        game.fx.update((1 / 60) * 0.12, game.cam);
        game.input.endFrame();
        continue;
      }
      game.player.update(1 / 60, game.input, game);
      game.input.endFrame();
      game.fx.update(1 / 60, game.cam);

      if (game.player.slash && !lastSlash) {
        releases++;
        trace.push("释放#" + releases + " @帧" + i + " k=" + game.player.slash.k.toFixed(2));
      }
      lastSlash = game.player.slash;

      const isFull = game.player.charging && game.player.charge >= chargeMax - 1e-6;
      if (isFull) {
        stuckFrames++;
        worstStuck = Math.max(worstStuck, stuckFrames);
        if (stuckFrames === 30) {
          trace.push("!!! 帧" + i + "：蓄力满 30 帧仍未释放 charging=" + game.player.charging +
            " charge=" + game.player.charge.toFixed(3) + " state=" + game.player.state +
            " hitLagT=" + game.hitLagT.toFixed(2));
        }
      } else stuckFrames = 0;
    }
    // 松手，避免残留
    key("keyup", "KeyK");

    const report = {
      selftest: true, scenario, releases, worstStuck,
      finalCharging: game.player.charging,
      finalCharge: +game.player.charge.toFixed(3),
      finalState: game.player.state,
      finalHitLag: +game.hitLagT.toFixed(3),
      trace: trace.slice(0, 30),
    };
    document.documentElement.dataset.meta = JSON.stringify(report);
    info.textContent = "自测[" + scenario + "]：释放 " + releases + " 次，最久卡 " + worstStuck + " 帧";
    console.log("SELFTEST " + JSON.stringify(report));
    return;
  }

  if (hf > 0) {
    const script = params.get("script") || "combat";
    runHeadless(hf, script);
    render(buf);
    ctx.putImageData(img, 0, 0);
    const p = game.player;
    const meta = {
      n: hf, script,
      px: Math.round(p.cx), py: Math.round(p.feet), state: p.state, hp: Math.round(p.hp),
      cam: { x: game.cam.x, y: game.cam.y },
      enemies: game.enemies.map((e) => ({ t: e.type, x: Math.round(e.cx), y: Math.round(e.feet), dead: e.dead, hp: Math.round(e.hp) })),
      torches: game.level.torches.map((t) => ({ x: t.x, y: t.y })),
      coins: game.level.coins.filter((c) => !c.taken).map((c) => ({ x: c.x, y: c.y })),
      gotCoins: game.coins, totalCoins: game.coinTotal, fxCount: game.fx.count, exit: game.level.exit,
      spawnCount: (typeof window !== "undefined" ? window.__spawnCount : null) ?? null,
      liveIds: game.fx.live.reduce((acc, e) => { acc[e.id] = (acc[e.id] || 0) + 1; return acc; }, {}),
    };
    info.textContent = `headless: ${hf} 帧，特效 ${game.fx.count}, 玩家 ${p.state}`;
    document.title = "S " + JSON.stringify({ script, px: meta.px, py: meta.py, state: p.state, coins: game.coins });
    // 上传路径按页面位置算，兼容"挂在子路径下"的部署（/pixel/...）
    const postBase = new URL("../", location.href);
    fetch(new URL("__shot", postBase), { method: "POST", body: canvas.toDataURL("image/png") })
      .then((r) => r.text()).then((t) => console.log("shot: " + t)).catch((e) => console.log("shot 失败：" + e.message));
    document.documentElement.dataset.shot = canvas.toDataURL("image/png");
    document.documentElement.dataset.meta = JSON.stringify(meta);
    fetch(new URL("__meta", postBase), { method: "POST", body: JSON.stringify(meta) })
      .then((r) => r.text()).then((t) => console.log("meta: " + t)).catch((e) => console.log("meta 失败：" + e.message));
    return;
  }

  let last = performance.now();
  let frames = 0, fpsT = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frames++; fpsT += dt;
    if (fpsT > 0.5) { game.fps = frames / fpsT; frames = 0; fpsT = 0; }

    advance(dt);
    render(buf);
    ctx.putImageData(img, 0, 0);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

window.addEventListener("error", (e) => {
  const el = document.getElementById("info");
  if (el) el.textContent = `${e.message} @ ${e.filename}:${e.lineno}`;
});

boot().catch((e) => {
  document.getElementById("info").textContent = "启动失败：" + e.message;
  console.error(e);
});
