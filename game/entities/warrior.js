// 战士职业：移动、跳跃、三段连招、蓄力重砸、冲刺。
// 数值都放在 CFG 里，加别的职业时照这份改就行（动作逻辑是通用的）。

import { clamp, approach, aabb, easeInQuad, easeOutQuad, easeOutCubic, smoothstep, dampAngle } from "../core/util.js";
import { drawWarrior, WARRIOR_W, WARRIOR_H, WARRIOR_CX } from "./warriorArt.js";
import { drawNinja, NINJA_DW, NINJA_DH } from "./warriorNinjaArt.js";
import { drawChargeBar } from "../ui/chargebar.js";
import { WARRIOR_PALETTE } from "../fx/fxlayer.js";
import { SpritePlate } from "../core/spriteplate.js";

// 26x26 的精灵 + 1 像素描边空间
const plate = new SpritePlate(28, 28);

// 精灵躯干中心在本地第 WARRIOR_CX 像素；镜像绘制后它跑到 WARRIOR_W-1-WARRIOR_CX。
// 两个值不相等（10 和 15），所以按朝向取不同偏移，否则转身时整个人会横跳 5 像素。
const BODY_OFFSET = [WARRIOR_W - 1 - WARRIOR_CX, WARRIOR_CX]; // [朝左, 朝右]

export const CFG = {
  name: "战士",
  maxHp: 120,
  // 碰撞盒照着 16x16 素材里人物的实际占地：宽 8、高 15。
  // 之前是 10x22，配合 32px 的绘制尺寸，视觉比碰撞范围大一圈，看起来"浮"在地上。
  w: 8,
  h: 15,
  runSpeed: 118,
  accel: 1500,
  airAccel: 950,
  friction: 1900,
  gravity: 1020,
  maxFall: 430,
  jumpV: 340,
  coyote: 0.09,
  jumpBuffer: 0.12,
  dashSpeed: 265,
  dashTime: 0.13,
  dashCd: 0.42,
  // 蓄力爆炸（K）：唯一的攻击方式。
  // 松手在脚下炸开一圈范围伤害，蓄得越满半径越大、伤害越高，
  // 蓄满时还会从地里掀起碎石（碎石有独立物理，会在世界里飞、落地、弹动）。
  heavy: {
    id: "chargeBlast",
    chargeMax: 0.55,
    dmg: 12,
    dmgPerCharge: 18,       // 蓄满总伤害 = 12 + 18 = 30
    radiusBase: 26,         // 基础爆炸半径
    radiusPerCharge: 26,    // 蓄满再多 26（总 52）
    windup: 0.09,           // 松手到爆炸
    active: 0.12,           // 判定窗口
    recover: 0.28,          // 收招
    shake: 6,
    hitstop: 0.08,
    // 特效：
    //   轻蓄 = 土爆（范围小，不改变地形）
    //   蓄满 = ground-slam（地面闪红开裂 + 石头喷出弹跳落定 + 两道冲击波）
    fx: "explosions/dirt-explosion",
    fxFull: "impacts/ground-slam",
    fxFullMin: 0.85,        // 到这个蓄力比例才用 ground-slam
  },
};

export class Warrior {
  constructor(x, y) {
    this.cfg = CFG;
    this.w = CFG.w;
    this.h = CFG.h;
    this.x = x - this.w / 2;
    this.y = y - this.h;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.onGround = false;
    this.state = "idle";
    this.hp = CFG.maxHp;
    this.maxHp = CFG.maxHp;
    this.t = 0;
    this.animT = 0;
    this.coyote = 0;
    this.buffer = 0;
    this.dashT = 0;
    this.dashCd = 0;
    this.invuln = 0;
    this.flash = 0;
    this.hurtT = 0;
    this.deadT = 0;
    this.queued = false;
    this.charging = false;
    this.charge = 0;
    this.chargeFx = null;
    this.slash = null;    // 蓄力斩动作 { t, phase, k, hits }
    this.charge = 0;
    this.safe = { x, y };
    this.safeT = 0;
  }

  get box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get feet() { return this.y + this.h; }

  // ---------- 受伤 / 死亡 ----------
  takeDamage(dmg, fromX, world) {
    if (this.invuln > 0 || this.state === "dead") return false;
    this.hp -= dmg;
    this.invuln = 0.85;
    this.flash = 0.12;
    this.hurtT = 0.22;
    this.state = "hurt";
    this.charging = false;
    if (this.chargeFx) { this.chargeFx.fx.stop(); this.chargeFx = null; }
    const dir = Math.sign(this.cx - fromX) || 1;
    this.vx = dir * 90;
    this.vy = -150;
    world.shake(3);
    world.fx.spawn("impacts/hit-spark", this.cx, this.cy, { flip: dir < 0, palette: WARRIOR_PALETTE });
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = "dead";
      this.deadT = 0;
      this.vx = dir * 60;
      this.vy = -180;
      world.fx.spawn("spawn/poof", this.cx, this.cy + 10, { palette: WARRIOR_PALETTE });
    }
    return true;
  }

  // ---------- 攻击 ----------

  startCharge(world) {
    if (this.state === "dead" || this.charging) return;
    this.charging = true;
    this.charge = 0;
    this.state = "attack";
    this.chargeFx = world.fx.spawn("lightning/charge-up", this.cx, this.feet - 4, {
      palette: ["#2a1024", "#5a1a2a", "#a83a2a", "#e87a2a", "#ffc04a", "#fff0b0", "#ffffff"],
      seed: Math.random() * 100,
    });
  }

  releaseCharge(world) {
    if (!this.charging) return;
    this.charging = false;
    const k = Math.min(1, this.charge / this.cfg.heavy.chargeMax);
    if (this.chargeFx) { this.chargeFx.fx.stop(); this.chargeFx = null; }
    // 松手进入蓄力爆炸的动作（前摇 -> 爆炸 -> 后摇），地面空中都能放
    this.slash = { t: 0, phase: "windup", k, hits: new Set() };
    this.state = "attack";
    this.charge = 0;
    if (this.onGround) this.vx *= 0.3;
  }

  /**
   * 蓄力爆炸：以角色脚下为圆心的范围伤害。
   * k = 蓄力比例（0..1）。蓄满时半径最大、伤害最高，并掀起大量碎石。
   */
  doChargeBlast(world, k) {
    const H = this.cfg.heavy;
    const dmg = H.dmg + Math.round(H.dmgPerCharge * k);
    const radius = H.radiusBase + H.radiusPerCharge * k;
    const cx = this.cx, cy = this.feet;      // 爆心在脚下
    const full = k >= 0.85;

    // ---- 视觉：地面炸开 + 尘土 + 震屏 + 顿帧
    world.fx.spawn(H.fx, cx, cy, {
      palette: WARRIOR_PALETTE,
      seed: Math.random() * 100,
      maxSame: 1,
    });
    // 蓄满：换成 ground-slam —— 地面闪红开裂、石头喷出弹跳、两道冲击波沿地面推开。
    // 这个特效本身就包含"地形变红 + 碎石飞溅"，不需要另做一套。
    if (full) {
      world.fx.spawn(H.fxFull, cx, cy, { seed: Math.random() * 100, maxSame: 1 });
    }
    world.shake(H.shake + k * 5);
    world.hitLag(H.hitstop + k * 0.04);

    // ---- 范围伤害：圆内所有敌人
    let hitCount = 0;
    for (const e of world.enemies) {
      if (e.dead) continue;
      // 用敌人碰撞盒的最近点算距离，比用中心点公平
      const nx = Math.max(e.x, Math.min(cx, e.x + e.w));
      const ny = Math.max(e.y, Math.min(cy, e.y + e.h));
      const dx = nx - cx, dy = ny - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;

      // 越靠近爆心伤害越高（边缘 70%，圆心 100%）
      const falloff = 1 - 0.3 * (dist / radius);
      const finalDmg = Math.max(1, Math.round(dmg * falloff));
      // 击退方向：从爆心往外推
      const sign = Math.sign(e.cx - cx);
      const dir = Number.isFinite(sign) && sign !== 0 ? sign : this.facing;
      const kb = (70 + 110 * k) * (1 - 0.4 * (dist / radius));

      // 防御：任何一项非有限就跳过，避免把 NaN 传进敌人的血量和速度
      if (!Number.isFinite(finalDmg) || !Number.isFinite(kb)) {
        console.warn("[blast] 伤害计算异常", { finalDmg, kb, dist, radius, k, ecx: e.cx, cx });
        continue;
      }
      e.takeDamage(finalDmg, cx, world, full, {
        kb: kb * dir,
        lift: full ? -120 * (1 - dist / radius) : 0,   // 蓄满会把敌人掀起来
        stun: 0.25 + 0.15 * k,
      });
      hitCount++;
      world.onHit?.(1, { crit: full });
    }

    // ---- 自己也被震退一点（反作用力，手感更实）
    if (this.onGround) this.vy = Math.min(this.vy, -60 - 40 * k);

    return hitCount;
  }

  update(dt, input, world) {
    this._dt = dt;   // pose() 的平滑要用
    this.t += dt;
    this.animT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    if (this.dashInvuln > 0) {
      this.dashInvuln = Math.max(0, this.dashInvuln - dt);
      // 冲刺无敌独立于受击无敌，用较长的那个
      if (this.invuln < this.dashInvuln) this.invuln = this.dashInvuln;
    }

    if (this.state === "dead") {
      this.deadT += dt;
      this.vy = Math.min(this.cfg.maxFall, this.vy + this.cfg.gravity * dt);
      this.moveWithCollision(dt, world.level);
      if (this.deadT > 1.1) world.respawnPlayer();
      return;
    }

    const L = world.level;
    const dir = input.axis();
    // 攻击中不转身（挥砍朝向锁定到这一段结束），只允许在起手前/后摇末尾调整
    const canTurn = this.state !== "hurt" && !this.slash;
    if (dir !== 0 && canTurn) this.facing = dir;

    // ---- 计时器
    this.coyote = this.onGround ? this.cfg.coyote : Math.max(0, this.coyote - dt);
    if (input.pressed("jump")) this.buffer = this.cfg.jumpBuffer;
    this.buffer = Math.max(0, this.buffer - dt);

    // ---- 受伤硬直
    if (this.state === "hurt") {
      this.hurtT -= dt;
      this.vx = approach(this.vx, 0, 600 * dt);
      if (this.hurtT <= 0) this.state = "idle";
      this.physics(dt, L);
      return;
    }

    // ---- 蓄力中
    if (this.charging) {
      this.charge = Math.min(this.cfg.heavy.chargeMax, this.charge + dt);
      // 蓄力时保留 70% 移速：唯一的攻击手段是蓄力斩，必须能边退边蓄
      this.vx = approach(this.vx, dir * this.cfg.runSpeed * 0.7, this.cfg.accel * dt);

      // 松手放，或者蓄满自动放。
      // 自动释放很重要：不然玩家按住不放会一直卡在蓄满状态，什么都不发生。
      const full = this.charge >= this.cfg.heavy.chargeMax - 1e-6;
      if (input.letGo("heavy") || !input.held("heavy") || full) this.releaseCharge(world);
      this.physics(dt, L);
      this.checkHazards(world);
      return;
    }

    // ---- 蓄力爆炸动作中
    if (this.slash) {
      this.slash.t += dt;
      const H = this.cfg.heavy;
      const t1 = H.windup, t2 = H.windup + H.active;

      if (this.slash.phase === "windup" && this.slash.t >= t1) {
        this.slash.phase = "active";
        // 爆炸是原地技能，不需要前冲
        this.vx *= 0.2;
        this.doChargeBlast(world, this.slash.k);
      }

      // 出刀后速度快速衰减（保留一点前冲惯性）
      const dragging = this.slash.t < t2 ? 1.2 : 4.0;
      const finished = this.slash.t >= t2 + H.recover;
      if (finished) {
        this.slash = null;
        this.state = this.onGround ? "idle" : "fall";
      }

      this.vx = approach(this.vx, 0, this.cfg.accel * dragging * dt);
      this.physics(dt, L);
      this.checkHazards(world);
      return;
    }


  // ---- 冲刺
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.facing * this.cfg.dashSpeed;
      this.vy = 0;
      this.state = "dash";
      this.physics(dt, L, true);
      if (this.dashT <= 0) { this.state = "idle"; this.vx *= 0.45; }
      return;
    }

    // ---- 普通操作
    if (input.pressed("dash") && this.dashCd <= 0) {
      this.dashT = this.cfg.dashTime;
      this.dashCd = this.cfg.dashCd;
      // 冲刺前半段无敌：被围住时这是唯一的脱身手段
      this.dashInvuln = this.cfg.dashTime * 0.8;
      world.fx.spawn("impacts/hit-spark", this.cx - this.facing * 6, this.cy, { flip: this.facing < 0, palette: WARRIOR_PALETTE, seed: Math.random() * 100 });
      return;
    }
    // 按下或【持续按住】都能起蓄力：
    // 受击会打断蓄力，如果只认按下，玩家按住 K 时会永远卡在"没在蓄力"的状态。
    if ((input.pressed("heavy") || input.held("heavy")) && !this.charging && !this.slash) {
      this.startCharge(world);
      return;
    }

    const target = dir * this.cfg.runSpeed;
    const acc = this.onGround ? this.cfg.accel : this.cfg.airAccel;
    if (dir !== 0) this.vx = approach(this.vx, target, acc * dt);
    else this.vx = approach(this.vx, 0, (this.onGround ? this.cfg.friction : this.cfg.airAccel * 0.4) * dt);

    // 跳跃（含土狼时间和输入缓冲）
    if (this.buffer > 0 && this.coyote > 0) {
      this.vy = -this.cfg.jumpV;
      this.buffer = 0;
      this.coyote = 0;
      this.onGround = false;
      world.fx.spawn("impacts/hit-spark", this.cx, this.feet - 2, { palette: WARRIOR_PALETTE, seed: Math.random() * 100 });
    }
    // 松手跳得矮
    if (this.vy < 0 && !input.held("jump")) this.vy = Math.max(this.vy, -140);

    this.physics(dt, L);

    // 落地
    if (this.onGround) {
      this.state = Math.abs(this.vx) > 12 ? "run" : "idle";
    } else {
      this.state = this.vy < 0 ? "jump" : "fall";
    }

    // 记录安全点，掉坑后回到这里
    this.safeT -= dt;
    if (this.onGround && this.safeT <= 0 && !L.hazardRect(this.x, this.y, this.w, this.h)) {
      this.safe = { x: this.cx, y: this.feet };
      this.safeT = 0.25;
    }

    this.checkHazards(world);

    // 掉出地图
    if (this.y > L.pxH + 40) {
      this.takeDamage(15, this.cx, world);
      this.x = this.safe.x - this.w / 2;
      this.y = this.safe.y - this.h;
      this.vx = 0; this.vy = 0;
      this.invuln = 0.9;
      world.shake(3);
    }
  }

  physics(dt, L, ignoreGravity = false) {
    if (!ignoreGravity) this.vy = Math.min(this.cfg.maxFall, this.vy + this.cfg.gravity * dt);
    this.moveWithCollision(dt, L);
  }

  /**
   * 移动 + 碰撞。两个关键点：
   * 1) 撞墙/落地都吸附到格边，位置不留小数；
   * 2) 站在地上时把脚压到格线上 —— 因为 solidRect 判断的是"最后一格像素"，
   *    脚离地面不到 1 像素时检测不到碰撞，重力每帧把角色往下推 0.28px，
   *    要攒够整 1px 才被抓回来，于是每 3 帧上下跳一次，这就是抖动。
   */
  moveWithCollision(dt, L) {
    // 万一被塞进实心块里（重生点算错之类），先往上顶出来
    let guard0 = 0;
    while (L.solidRect(this.x, this.y, this.w, this.h) && guard0++ < 40) this.y -= 1;

    // ---- 横向
    const nx = this.x + this.vx * dt;
    if (!L.solidRect(nx, this.y, this.w, this.h)) this.x = nx;
    else {
      const T = L.T;
      if (this.vx > 0) this.x = Math.floor((this.x + this.w) / T) * T - this.w;
      else if (this.vx < 0) this.x = (Math.floor(this.x / T) + 1) * T;
      this.vx = 0;
    }

    // ---- 纵向
    const ny = this.y + this.vy * dt;
    if (this.vy !== 0 && L.solidRect(this.x, ny, this.w, this.h)) {
      const T = L.T;
      if (this.vy > 0) this.y = Math.floor((ny + this.h) / T) * T - this.h;
      else this.y = (Math.floor(ny / T) + 1) * T;
      let guard = 0;
      while (L.solidRect(this.x, this.y, this.w, this.h) && guard++ < 24) this.y += this.vy > 0 ? -1 : 1;
      this.vy = 0;
    } else {
      this.y = ny;
    }

    // ---- 站立判定（脚下一像素探针）并把脚压到格线
    const grounded = this.vy >= 0 && L.solidRect(this.x, this.y + 1, this.w, this.h);
    if (grounded) {
      const T = L.T, feet = this.y + this.h;
      const line = Math.round(feet / T) * T;
      if (Math.abs(line - feet) <= 1.5) this.y = line - this.h;
      this.vy = 0;
    }
    this.onGround = grounded;
  }

  checkHazards(world) {
    if (this.invuln > 0) return;
    if (world.level.hazardRect(this.x, this.y, this.w, this.h)) {
      this.takeDamage(10, this.cx + (this.facing > 0 ? 8 : -8), world);
      this.vy = -260;
    }
  }

  // ---------- 画 ----------
  // cam 是相机左上角的世界坐标；精灵画到屏幕上要减掉它。
  draw(s, cam = { x: 0, y: 0 }) {
    if (this.state === "dead" && this.deadT > 0.9) return;
    const camX = cam.x | 0, camY = cam.y | 0;

    // 脚下的影子
    const sw = 10, shx = Math.round(this.cx - sw / 2) - camX, shy = Math.round(this.feet - 1) - camY;
    for (let i = 0; i < sw; i++) s.blendPx(shx + i, shy, 0xff000000, 0.35);
    for (let i = 1; i < sw - 1; i++) s.blendPx(shx + i, shy - 1, 0xff000000, 0.18);

    // ---- 选素材里的动作和帧
    // 素材只有：行走 4 帧 + 攻击/跳跃/死亡各 1 帧，
    // 所以行走用真循环，其他动作靠姿态变换补动感。
    let anim = "walk";
    let frame = 0;
    let tilt = 0, stretch = 1, lift = 0;

    if (this.state === "dead") {
      anim = "dead";
    } else if (this.state === "hurt") {
      anim = "jump";
      tilt = -this.facing * 0.8;
    } else if (this.slash) {
      // 蓄力斩：前摇后仰，出刀前冲压低
      const H = this.cfg.heavy;
      if (this.slash.t < H.windup) {
        anim = "jump";
        stretch = 1.06;
        tilt = -this.facing * 0.5;
      } else {
        anim = "attack";
        stretch = 0.93;
        tilt = this.facing * 0.8;
      }
    } else if (this.charging) {
      // 蓄力：压低身体
      anim = "walk";
      frame = 0;
      stretch = 0.94;
      tilt = -this.facing * 0.25;
    } else if (this.dashT > 0) {
      anim = "walk";
      frame = 3;
      tilt = this.facing * 1.1;
      stretch = 1.04;
    } else if (!this.onGround) {
      anim = "jump";
      stretch = this.vy < 0 ? 1.08 : 0.96;
      lift = 1;
    } else if (Math.abs(this.vx) > 12) {
      // 跑步：用素材的 4 帧行走循环，速度跟着实际移速
      anim = "walk";
      frame = Math.floor(this.animT * 10) % 4;
      tilt = this.facing * 0.4;
    } else {
      // 待机：停在行走第 0 帧，轻微呼吸
      anim = "walk";
      frame = 0;
      stretch = 1 + Math.sin(this.t * 3.2) * 0.012;
    }

    // 精灵位置：素材是 16x16，脚底对齐碰撞盒底部，水平按中心对齐
    const px = Math.round(this.cx) - Math.floor(NINJA_DW / 2) - camX;
    const py = Math.round(this.feet) - NINJA_DH - camY;

    drawNinja(s, px, py, this.facing, anim, frame, {
      tilt, stretch, lift,
      flash: this.flash > 0,
    });

    // 蓄力光 + 头顶蓄力条
    if (this.charging) {
      const k = Math.min(1, this.charge / this.cfg.heavy.chargeMax);
      // 光晕随蓄力变强、变大
      s.addGlow(this.cx - camX, this.cy - camY, 14 + k * 14, 60 * k + 10, 30 * k + 4, 0);
      // 满蓄力时再加一圈外光
      if (k >= 0.995) s.addGlow(this.cx - camX, this.cy - camY, 26, 40, 18, 6);
      drawChargeBar(s, this.cx - camX, this.feet - NINJA_DH - camY, k, this.t);
    }
    // 冲刺残影
    if (this.dashT > 0) {
      for (let i = 1; i <= 2; i++) {
        const tx = this.cx - this.facing * i * 7 - camX;
        s.addGlow(tx, this.cy - camY, 7, 90, 60, 40);
      }
    }
  }

  computePose() {
    const p = {
      legs: "stand", phase: 0, bob: 0, lean: 0, stretch: 1,
      sword: Math.PI / 2.2, trail: null, flutter: this.t,
    };

    if (this.state === "dead") {
      p.legs = "dead";
      p.sword = Math.PI / 2;
      return p;
    }
    if (this.flash > 0) p.flash = true;

    if (this.charging) {
      const k = this.charge / this.cfg.heavy.chargeMax;
      p.legs = "stand";
      // 蓄力时身体微微下蹲、轻微呼吸式起伏（浮点，不再 Math.round 成 0/1）
      p.bob = Math.sin(this.t * 16) * 0.6 - k * 0.8;
      p.lean = -1.5 - k * 1.2;
      p.stretch = 1 + Math.sin(this.t * 22) * 0.02 * (1 + k);
      p.sword = -Math.PI / 2 - 0.35 - k * 0.15;
      p.charge = k;
      return p;
    }

    // 蓄力斩：前摇后仰蓄势，出刀前压
    if (this.slash) {
      const H = this.cfg.heavy;
      const t2 = H.windup + H.active;
      if (this.slash.t < H.windup) {
        const u = clamp(this.slash.t / Math.max(0.001, H.windup), 0, 1);
        p.legs = "stand";
        p.bob = -1 - easeInQuad(u) * 2;
        p.lean = -easeInQuad(u) * 2.2;
        p.stretch = 1 + easeInQuad(u) * 0.06;
        p.sword = -Math.PI / 2 - 0.3 - easeInQuad(u) * 0.3;
        p.charge = this.slash.k;
      } else if (this.slash.t < t2) {
        // 出刀：身体前压 + 拉伸
        const u = clamp((this.slash.t - H.windup) / Math.max(0.001, H.active), 0, 1);
        p.legs = "attack";
        p.bob = 1.2 * easeOutCubic(u);
        p.lean = 3.0 * easeOutCubic(u);
        p.stretch = 1 + 0.08 * Math.sin(u * Math.PI);
        p.sword = -Math.PI / 2 + Math.PI * 1.4 * easeOutCubic(u);
        p.trail = this.trail;
      } else {
        const u = clamp((this.slash.t - t2) / Math.max(0.001, H.recover), 0, 1);
        p.legs = "attack";
        p.bob = 1.2 * (1 - easeOutQuad(u));
        p.lean = 3.0 * (1 - easeOutQuad(u));
        p.sword = -Math.PI / 2 + Math.PI * 1.4 * (1 - easeOutQuad(u) * 0.6);
      }
      return p;
    }


    if (this.state === "hurt") {
      p.legs = "fall";
      p.bob = -1.2;
      p.lean = -2.5;
      p.sword = Math.PI / 1.3;
      return p;
    }

    if (this.state === "dash") {
      p.legs = "attack";
      p.bob = 1;
      p.lean = 3.5;
      p.stretch = 0.94;
      p.sword = 0.12;
      return p;
    }

    if (!this.onGround) {
      p.legs = this.vy < 0 ? "jump" : "fall";
      p.lean = this.vy < 0 ? 1.2 : -0.8;
      p.sword = this.vy < 0 ? -1.2 : 0.5;
      return p;
    }

    if (Math.abs(this.vx) > 12) {
      // 跑步：连续相位（不再 floor 成 4 帧），身体略微前倾
      p.legs = "run";
      p.phase = (this.animT * 9) % 4;
      p.bob = 0;
      p.lean = 2.2;
      p.sword = Math.PI / 2.4 - 0.35;
      return p;
    }

    // 站立呼吸：用正弦，浮点，柔和很多
    const breathe = Math.sin(this.t * 3.2);
    p.legs = "stand";
    p.bob = breathe * 0.45;
    p.lean = breathe * 0.3;
    p.sword = Math.PI / 2.2 + breathe * 0.04;
    return p;
  }

  /**
   * 对外的姿态：把目标姿态和时间做混合，得到最终这一帧要画的东西。
   * 攻击中不做平滑（要的就是"啪"一下），其他状态用指数平滑消除硬切。
   */
  pose() {
    const target = this.computePose();

    // 刀光拖尾：蓄力斩判定期间每帧记一个角度
    const slashing = this.slash && this.slash.phase === "active";
    if (slashing) {
      this.trail = this.trail ?? [];
      this.trail.unshift(target.sword);
      if (this.trail.length > 4) this.trail.pop();
    } else if (this.trail && this.trail.length) {
      this.trail.pop();   // 收招后慢慢消失
      if (!this.trail.length) this.trail = null;
    }

    // 第一次调用时直接对齐，避免从 0 开始平滑导致手臂乱甩
    if (this.swordAngle === undefined) this.swordAngle = target.sword;

    const attacking = !!this.slash;
    if (attacking) {
      // 挥砍/收招：完全按缓动走（要的就是脆）
      this.swordAngle = target.sword;
    } else {
      // 非攻击：平滑靠近，状态切换不硬切。tau 小 = 跟手
      this.swordAngle = dampAngle(this.swordAngle, target.sword, 0.055, this._dt ?? 1 / 60);
    }

    const out = { ...target, sword: this.swordAngle, trail: this.slash && this.slash.phase === "active" ? this.trail : null };
    return out;
  }
}
