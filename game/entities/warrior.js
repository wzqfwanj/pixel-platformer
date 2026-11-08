// 战士职业：移动、跳跃、三段连招、蓄力重砸、冲刺。
// 数值都放在 CFG 里，加别的职业时照这份改就行（动作逻辑是通用的）。

import { clamp, approach, aabb } from "../core/util.js";
import { drawWarrior, WARRIOR_W, WARRIOR_H, WARRIOR_CX } from "./warriorArt.js";
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
  w: 10,
  h: 22,
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
  comboWindow: 0.34,
  combo: [
    { windup: 0.09, active: 0.10, recover: 0.16, dmg: 6, reach: 26, hitH: 20, fx: "melee/sword-slash", shake: 1.6, kb: 46 },
    { windup: 0.07, active: 0.10, recover: 0.18, dmg: 7, reach: 28, hitH: 20, fx: "melee/double-slash", shake: 2.2, kb: 54 },
    { windup: 0.13, active: 0.13, recover: 0.28, dmg: 14, reach: 32, hitH: 24, fx: "melee/heavy-cleave", shake: 4.5, kb: 120, crit: true },
  ],
  heavy: { chargeMax: 0.75, dmg: 16, dmgPerCharge: 14, radius: 42, windup: 0.10, active: 0.12, recover: 0.34, shake: 6 },
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
    this.atk = null;      // { idx, t, phase, hits:Set, cfg }
    this.comboTimer = 0;
    this.comboIdx = 0;
    this.queued = false;
    this.charging = false;
    this.charge = 0;
    this.chargeFx = null;
    this.slamOnLand = false;
    this.slam = null;     // { t, phase }
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
    this.atk = null;
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
  startAttack(world) {
    const idx = this.comboIdx % this.cfg.combo.length;
    const c = this.cfg.combo[idx];
    this.atk = { idx, t: 0, phase: "windup", hits: new Set(), cfg: c };
    this.state = "attack";
    this.comboIdx = idx + 1;
    this.comboTimer = 0;
    this.charging = false;
    this.queued = false;
    if (this.chargeFx) { this.chargeFx.fx.stop(); this.chargeFx = null; }
    if (this.onGround) this.vx *= 0.35;
  }

  startCharge(world) {
    if (this.state === "dead" || this.charging) return;
    this.charging = true;
    this.charge = 0;
    this.atk = null;
    this.state = "attack";
    this.chargeFx = world.fx.spawn("lightning/charge-up", this.cx, this.feet - 4, {
      palette: ["#2a1024", "#5a1a2a", "#a83a2a", "#e87a2a", "#ffc04a", "#fff0b0", "#ffffff"],
      seed: Math.random() * 100,
    });
  }

  releaseCharge(world) {
    if (!this.charging) return;
    this.charging = false;
    const k = this.charge / this.cfg.heavy.chargeMax;
    if (this.chargeFx) { this.chargeFx.fx.stop(); this.chargeFx = null; }
    if (this.onGround) {
      this.slam = { t: 0, phase: "windup", k };
      this.state = "attack";
    } else {
      // 空中重砸：先快速下坠，落地时炸开
      this.slamOnLand = true;
      this.slamK = k;
      this.vy = Math.max(this.vy, 120);
      this.vx *= 0.4;
    }
    this.charge = 0;
  }

  /** 重砸落地的那一刻：范围伤害 */
  doSlam(world, k) {
    const H = this.cfg.heavy;
    const dmg = H.dmg + Math.round(H.dmgPerCharge * k);
    const cx = this.cx, cy = this.feet;
    world.fx.spawn("impacts/ground-slam", cx, cy, { palette: WARRIOR_PALETTE, seed: Math.random() * 100 });
    world.fx.spawn("explosions/dirt-explosion", cx, cy, { seed: Math.random() * 100 });
    world.shake(H.shake + k * 3);
    world.hitLag(0.06);
    for (const e of world.enemies) {
      if (e.dead) continue;
      const dx = e.cx - cx, dy = e.cy - cy;
      if (Math.abs(dx) <= H.radius && Math.abs(dy) <= 26) {
        e.takeDamage(dmg, cx, world, k > 0.5);
        world.onHit?.(1);
      }
    }
  }

  update(dt, input, world) {
    this.t += dt;
    this.animT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer <= 0 && !this.atk) this.comboIdx = 0;

    if (this.state === "dead") {
      this.deadT += dt;
      this.vy = Math.min(this.cfg.maxFall, this.vy + this.cfg.gravity * dt);
      this.moveWithCollision(dt, world.level);
      if (this.deadT > 1.1) world.respawnPlayer();
      return;
    }

    const L = world.level;
    const dir = input.axis();
    if (dir !== 0 && this.state !== "hurt") this.facing = dir;

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
      this.vx = approach(this.vx, dir * this.cfg.runSpeed * 0.35, this.cfg.accel * dt);
      if (input.letGo("heavy") || !input.held("heavy")) this.releaseCharge(world);
      this.physics(dt, L);
      this.checkHazards(world);
      return;
    }

    // ---- 重砸动作中
    if (this.slam) {
      this.slam.t += dt;
      const H = this.cfg.heavy;
      if (this.slam.phase === "windup" && this.slam.t >= H.windup) {
        this.slam.phase = "active";
        this.doSlam(world, this.slam.k);
      }
      if (this.slam.phase === "active" && this.slam.t >= H.windup + H.active + H.recover) this.slam = null;
      this.vx = approach(this.vx, 0, 900 * dt);
      this.physics(dt, L);
      return;
    }

    // ---- 攻击中
    if (this.atk) {
      const a = this.atk, c = a.cfg;
      a.t += dt;
      const t1 = c.windup, t2 = c.windup + c.active;
      if (a.t >= t1 && a.phase === "windup") {
        a.phase = "active";
        world.fx.spawn(c.fx, this.cx + this.facing * 12, this.feet - 22, {
          flip: this.facing < 0,
          palette: WARRIOR_PALETTE,
          seed: Math.random() * 100,
        });
      }
      if (a.phase === "active") {
        const hb = {
          x: this.facing > 0 ? this.x + this.w - 4 : this.x - c.reach + 4,
          y: this.y + 1,
          w: c.reach,
          h: c.hitH,
        };
        for (const e of world.enemies) {
          if (e.dead || a.hits.has(e)) continue;
          if (aabb(hb, e.box)) {
            a.hits.add(e);
            e.takeDamage(c.dmg, this.cx, world, !!c.crit);
            world.onHit?.(1);
            world.hitLag(0.045);
            world.shake(c.shake);
          }
        }
      }
      if (a.t >= t2 + c.recover) {
        this.comboTimer = this.cfg.comboWindow;
        this.atk = null;
        this.state = "idle";
      } else if (input.pressed("attack") && a.t > t1 + 0.02) {
        this.queued = true;
      }
      if (this.queued && this.comboTimer > 0) this.startAttack(world);
      this.vx = approach(this.vx, dir * this.cfg.runSpeed * 0.25, this.cfg.accel * dt);
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
      world.fx.spawn("impacts/hit-spark", this.cx - this.facing * 6, this.cy, { flip: this.facing < 0, palette: WARRIOR_PALETTE, seed: Math.random() * 100 });
      return;
    }
    if (input.pressed("heavy")) { this.startCharge(world); return; }
    if (input.pressed("attack")) { this.startAttack(world); return; }

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
      if (this.slamOnLand) {
        this.slamOnLand = false;
        this.doSlam(world, this.slamK ?? 0);
      }
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
    const sw = 10, shx = Math.round(this.cx) - sw / 2 - camX, shy = Math.round(this.feet) - 1 - camY;
    for (let i = 0; i < sw; i++) s.blendPx(shx + i, shy, 0xff000000, 0.35);
    for (let i = 1; i < sw - 1; i++) s.blendPx(shx + i, shy - 1, 0xff000000, 0.18);

    // 精灵画到独立小画布，再带描边贴到场景（亮背景下才看得清轮廓）
    const pose = this.pose();
    plate.render((p) => drawWarrior(p, 1, 1, this.facing, pose));
    // 取整源和相机一致（都是 round(cx)），角色在屏幕上的位置才不会因为两次取整不同步而跳 1 像素
    const body = BODY_OFFSET[this.facing > 0 ? 1 : 0];
    const px = Math.round(this.cx) - body - 1 - camX;
    const py = Math.round(this.feet) - WARRIOR_H - camY;
    plate.blit(s, px, py, true);

    // 蓄力光
    if (this.charging) {
      const k = this.charge / this.cfg.heavy.chargeMax;
      s.addGlow(this.cx - camX, this.cy - camY, 14 + k * 12, 60 * k + 10, 30 * k + 4, 0);
    }
    // 冲刺残影
    if (this.dashT > 0) {
      for (let i = 1; i <= 2; i++) {
        const tx = this.cx - this.facing * i * 7 - camX;
        s.addGlow(tx, this.cy - camY, 7, 90, 60, 40);
      }
    }
  }

  pose() {
    const p = { legs: "stand", phase: 0, bob: 0, sword: Math.PI / 2.2, flutter: this.t };
    if (this.state === "dead") {
      p.legs = "dead";
      p.sword = Math.PI / 2;
      return p;
    }
    if (this.flash > 0) p.flash = true;

    if (this.charging) {
      p.legs = "stand";
      p.bob = Math.round(Math.sin(this.t * 18) * 0.6);
      p.sword = -Math.PI / 2 - 0.5;
      p.charge = this.charge / this.cfg.heavy.chargeMax;
      return p;
    }

    if (this.slam) {
      if (this.slam.phase === "windup") {
        p.legs = "stand";
        p.bob = -2;
        p.sword = -Math.PI / 2 - 0.3;
        p.charge = 1;
      } else {
        p.legs = "attack";
        p.bob = 2;
        p.sword = Math.PI / 2 + 0.35;
      }
      return p;
    }

    if (this.atk) {
      const a = this.atk, c = a.cfg;
      p.legs = "attack";
      // 每段连招的挥砍弧度：起手 -> 落点 -> 收势
      const arc = [
        [-1.9, -1.2, 0.55, 1.1],
        [0.9, 0.55, -0.55, -1.2],
        [-2.4, -2.0, 1.15, 1.35],
      ][a.idx % 3];
      const t = a.t;
      let ang;
      if (t < c.windup) ang = arc[0] + (arc[1] - arc[0]) * (t / c.windup);
      else if (t < c.windup + c.active) ang = arc[1] + (arc[2] - arc[1]) * ((t - c.windup) / c.active);
      else ang = arc[2] + (arc[3] - arc[2]) * ((t - c.windup - c.active) / c.recover);
      p.sword = ang;
      p.bob = a.phase === "active" ? 1 : 0;
      return p;
    }

    if (this.state === "hurt") {
      p.legs = "fall";
      p.bob = -1;
      p.sword = Math.PI / 1.3;
      return p;
    }

    if (this.state === "dash") {
      p.legs = "attack";
      p.bob = 1;
      p.sword = 0.15;
      return p;
    }

    if (!this.onGround) {
      p.legs = this.vy < 0 ? "jump" : "fall";
      p.sword = this.vy < 0 ? -1.2 : 0.5;
      return p;
    }

    if (Math.abs(this.vx) > 12) {
      // 跑步：只靠腿部 4 帧循环表现，身体不做整体上下位移。
      // 早期这里是每隔一帧挪 1px，等于每秒颠 11 次，看着就是"抖"。
      p.legs = "run";
      p.phase = Math.floor(this.animT * 9) % 4;
      p.bob = 0;
      p.sword = Math.PI / 2.4 - 0.35;
      return p;
    }

    // 站立呼吸
    p.legs = "stand";
    p.bob = Math.floor(this.t * 1.6) % 2 === 0 ? 0 : 1;
    p.sword = Math.PI / 2.2;
    return p;
  }
}
