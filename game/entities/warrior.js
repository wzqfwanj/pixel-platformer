// 战士职业：移动、跳跃、三段连招、蓄力重砸、冲刺。
// 数值都放在 CFG 里，加别的职业时照这份改就行（动作逻辑是通用的）。

import { clamp, approach, aabb, easeInQuad, easeOutQuad, easeOutCubic, smoothstep, dampAngle } from "../core/util.js";
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
  attackBuffer: 0.22,   // 攻击键输入缓冲：按早了会存着，窗口一开自动接
  // 每段招式的时间轴（秒）：
  //   windup  起手 → active 判定窗口 → recover 后摇
  //   cancelHit  命中后从这一刻起可以取消进下一段（贴着 active 结束）
  //   cancelWhiff 落空后从这一刻起才能取消（几乎要等完整后摇）
  // 这个"打中就连得上、打空就要罚站"是格斗游戏连招丝滑感的来源。
  combo: [
    {
      id: "slash1", windup: 0.10, active: 0.09, recover: 0.14,
      cancelHit: 0.035, cancelWhiff: 0.13,
      dmg: 6, reach: 27, hitH: 20, fx: "melee/sword-slash",
      shake: 1.6, kb: 42, lunge: 54, hitstop: 0.045, next: 1,
    },
    {
      id: "slash2", windup: 0.085, active: 0.09, recover: 0.15,
      cancelHit: 0.03, cancelWhiff: 0.14,
      dmg: 7, reach: 29, hitH: 20, fx: "melee/double-slash",
      shake: 2.2, kb: 50, lunge: 46, hitstop: 0.05, next: 2,
    },
    {
      id: "slash3", windup: 0.125, active: 0.11, recover: 0.22,
      cancelHit: 0.05, cancelWhiff: 0.2,
      dmg: 14, reach: 33, hitH: 24, fx: "melee/heavy-cleave",
      shake: 4.5, kb: 130, lunge: 78, hitstop: 0.09, crit: true,
    },
  ],
  // 上挑：按住上再攻击。把敌人挑浮空，之后可以接空中连段
  launcher: {
    id: "launcher", windup: 0.10, active: 0.1, recover: 0.18,
    cancelHit: 0.04, cancelWhiff: 0.16,
    dmg: 8, reach: 26, hitH: 26, fx: "melee/uppercut",
    shake: 2.4, kb: 30, lunge: 40, hitstop: 0.06, lift: -230, launch: true,
  },
  // 空中攻击：下落中也能出，命中后轻微上浮，允许二段跳式的追加
  air: {
    id: "air", windup: 0.08, active: 0.1, recover: 0.16,
    cancelHit: 0.03, cancelWhiff: 0.12,
    dmg: 6, reach: 27, hitH: 22, fx: "melee/spin-slash",
    shake: 1.8, kb: 44, lunge: 30, hitstop: 0.045, float: -40,
  },
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
    this.attackBuffer = 0;
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
  /**
   * 起一招。kind: "combo"（三段连招，可指定第几段）| "launcher"（上挑）| "air"（空中斩）
   * 用统一入口，派生招式才好加。
   */
  startMove(kind, world, comboIdx = 0) {
    const cfg = this.cfg;
    let c, idx = 0;
    if (kind === "launcher") {
      c = cfg.launcher;
    } else if (kind === "air") {
      c = cfg.air;
    } else {
      idx = comboIdx % cfg.combo.length;
      c = cfg.combo[idx];
    }

    this.atk = {
      idx, kind, t: 0, phase: "windup",
      hits: new Set(), hitCount: 0, hit: false, cfg: c,
    };
    this.state = "attack";
    this.comboIdx = kind === "combo" ? idx + 1 : this.comboIdx;
    this.comboTimer = 0;
    this.charging = false;
    this.queued = false;
    this.facingLock = this.facing;
    // 记下出招瞬间剑的角度：起手动作从这里出发，而不是硬切到固定姿势
    this.attackEnterAngle = this.swordAngle ?? Math.PI / 2.2;
    if (this.chargeFx) { this.chargeFx.fx.stop(); this.chargeFx = null; }
    // 起手时收住一点速度，但保留惯性（空中攻击不该急停）
    if (this.onGround) this.vx *= 0.45;
    else this.vx *= 0.8;
  }

  /** 兼容旧调用 */
  startAttack(world) {
    this.startMove("combo", world, this.comboIdx % this.cfg.combo.length);
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
    this._dt = dt;   // pose() 的平滑要用
    this.t += dt;
    this.animT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.attackBuffer = Math.max(0, this.attackBuffer - dt);
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
    // 攻击中不转身（挥砍朝向锁定到这一段结束），只允许在起手前/后摇末尾调整
    const canTurn = this.state !== "hurt" && !this.atk;
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

      // 出刀瞬间：放特效 + 突进
      if (a.phase === "windup" && a.t >= t1) {
        a.phase = "active";
        world.fx.spawn(c.fx, this.cx + this.facing * 11, this.feet - 21, {
          flip: this.facing < 0,
          palette: WARRIOR_PALETTE,
          seed: Math.random() * 100,
        });
        // 招式自带的向前突进（"贴上去"的感觉）
        if (c.lunge) this.vx = this.facing * c.lunge;
      }

      // 判定窗口
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
            a.hitCount++;
            const dir = this.facing;
            e.takeDamage(c.dmg, this.cx, world, !!c.crit, {
              kb: c.kb, lift: c.lift, stun: c.launch ? 0.4 : 0.18,
            });
            world.onHit?.(1, c);
            // 命中定格：招式越重停越久（打击感核心）
            world.hitLag(c.hitstop);
            world.shake(c.shake);
            // 命中后角色自己的位移刹住（冲击回馈）
            this.vx *= 0.25;
            // 空中攻击命中：给一点上浮，方便追加
            if (c.float && !this.onGround) this.vy = Math.min(this.vy, c.float);
            if (c.launch) {
              // 上挑踢自己一点点离地，形成"挑起来追打"的节奏
              this.vy = Math.min(this.vy, -80);
            }
            a.hit = true;
          }
        }
      }

      // 攻击键缓冲（按早了存着，窗口一开就用）
      if (input.pressed("attack")) {
        this.attackBuffer = this.cfg.attackBuffer;
        this.lastBufferPeak = Math.max(this.lastBufferPeak ?? 0, this.attackBuffer);
      }

      // 取消窗口：命中后很快就能接，落空要接近完整后摇
      const cancelAt = a.hit ? t2 + c.cancelHit : t2 + c.cancelWhiff;
      const finished = a.t >= t2 + c.recover;

      if (a.t >= cancelAt && this.attackBuffer > 0) {
        this.attackBuffer = 0;   // 消费掉这次输入
        // 决定下一招：上挑 / 连段 / 空中
        const wantUp = input.held("up");
        this.atk = null;
        if (wantUp && this.onGround) this.startMove("launcher", world);
        else if (!this.onGround) this.startMove("air", world);
        else if (c.next !== undefined && c.next < this.cfg.combo.length) this.startMove("combo", world, c.next);
        else this.startMove("combo", world, 0);
        this.physics(dt, L);
        return;
      }

      if (finished) {
        this.comboTimer = this.cfg.comboWindow;
        this.atk = null;
        this.state = this.onGround ? "idle" : "fall";
        // 后摇结束时如果还按着攻击键，直接续上（更宽容）
        if (this.attackBuffer > 0 && this.comboTimer > 0) {
          this.attackBuffer = 0;
          if (input.held("up") && this.onGround) this.startMove("launcher", world);
          else if (!this.onGround) this.startMove("air", world);
          else this.startMove("combo", world, 0);
          this.physics(dt, L);
          return;
        }
      }

      // 攻击中水平速度快速衰减（保留突进的前冲感）
      const drag = a.t < t2 ? 0.6 : 3.2;
      this.vx = approach(this.vx, dir * this.cfg.runSpeed * 0.12, this.cfg.accel * drag * dt);
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
    if (input.pressed("attack")) {
      // 派生：按住上 = 上挑；空中 = 空中斩；否则起三段连招
      if (!this.onGround) this.startMove("air", world);
      else if (input.held("up")) this.startMove("launcher", world);
      else this.startMove("combo", world, this.comboIdx % this.cfg.combo.length);
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

  /**
   * 计算这一帧的目标姿态（全部是浮点，不取整 —— 取整交给绘制层）。
   *
   * 丝滑感来自三件事：
   *   1. 出刀用 easeOutCubic：开头极快、末端减速，视觉上"啪"一下甩出去
   *   2. 收招用 easeOutQuad：慢慢回位，不会突兀弹回
   *   3. 非攻击状态下，剑的角度用 dampAngle 朝目标平滑（状态切换不硬切）
   */
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

    if (this.slam) {
      const H = this.cfg.heavy;
      const u = clamp(this.slam.t / Math.max(0.001, H.windup), 0, 1);
      if (this.slam.phase === "windup") {
        p.legs = "stand";
        p.bob = -1 - easeInQuad(u) * 2;
        p.lean = -easeInQuad(u) * 2;
        p.stretch = 1 + easeInQuad(u) * 0.06;
        p.sword = -Math.PI / 2 - 0.3 - easeInQuad(u) * 0.25;
        p.charge = 1;
      } else {
        p.legs = "attack";
        p.bob = 1.5;
        p.lean = 2.5;
        p.stretch = 0.92;
        p.sword = Math.PI / 2 + 0.35;
      }
      return p;
    }

    if (this.atk) {
      const a = this.atk, c = a.cfg;
      p.legs = "attack";

      // 每段连招的关键姿势：[起手位, 挥砍落点, 收势位]
      // 注意起手不再是一个固定角度 —— 由 attackEnterAngle（按下去那一刻剑在哪）动态决定，
      // 这样"站立/跑步/上一段收招"切到这一段时都是连续过渡，没有瞬移。
      const arcs = {
        0: [-1.95, 0.62, 1.12],
        1: [0.95, -0.62, -1.25],
        2: [-2.45, 1.18, 1.38],
      };
      const arc = a.kind === "launcher"
        ? [2.3, -1.35, -0.9]      // 上挑：从下往上撩
        : a.kind === "air"
          ? [-1.6, 1.9, 2.2]      // 空中：下劈
          : arcs[a.idx % 3];

      const enter = this.attackEnterAngle ?? arc[0];
      const t = a.t;
      const t1 = c.windup, t2 = c.windup + c.active;
      let ang;
      if (t < t1) {
        // 起手：从当前角度拉到蓄力位。
        // smoothstep 两端导数都为 0 —— 起步柔和、到蓄力位速度正好归零，
        // 于是"拉开 -> 顿一下 -> 甩出去"连成一条没有速度突变的曲线。
        const u = clamp(t / t1, 0, 1);
        ang = enter + (arc[0] - enter) * smoothstep(u);
        p.lean = -1.2 * u;
        p.stretch = 1 + 0.05 * u;
        p.bob = -0.6 * u;
      } else if (t < t2) {
        // 出刀：爆发式开始、末端减速 —— 这一段决定"脆不脆"
        const u = clamp((t - t1) / c.active, 0, 1);
        ang = arc[0] + (arc[1] - arc[0]) * easeOutCubic(u);
        p.lean = 2.4 * easeOutCubic(u);
        p.stretch = 1 + 0.1 * Math.sin(u * Math.PI);
        p.bob = 0.8 * easeOutCubic(u);
        p.trail = this.trail;
      } else {
        // 收招：慢慢回位
        const u = clamp((t - t2) / c.recover, 0, 1);
        ang = arc[1] + (arc[2] - arc[1]) * easeOutQuad(u);
        p.lean = 2.4 * (1 - easeOutQuad(u));
        p.stretch = 1 - 0.04 * Math.sin(u * Math.PI);
        p.bob = 0.8 * (1 - easeOutQuad(u));
      }
      p.sword = ang;
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

    // 刀光拖尾：攻击判定期间每帧记一个角度
    if (this.atk && this.atk.phase === "active") {
      this.trail = this.trail ?? [];
      this.trail.unshift(target.sword);
      if (this.trail.length > 4) this.trail.pop();
    } else if (this.trail && this.trail.length) {
      this.trail.pop();   // 收招后慢慢消失
      if (!this.trail.length) this.trail = null;
    }

    // 第一次调用时直接对齐，避免从 0 开始平滑导致手臂乱甩
    if (this.swordAngle === undefined) this.swordAngle = target.sword;

    const attacking = !!this.atk;
    if (attacking) {
      // 挥砍/收招：完全按缓动走（要的就是脆）
      this.swordAngle = target.sword;
    } else {
      // 非攻击：平滑靠近，状态切换不硬切。tau 小 = 跟手
      this.swordAngle = dampAngle(this.swordAngle, target.sword, 0.055, this._dt ?? 1 / 60);
    }

    const out = { ...target, sword: this.swordAngle, trail: this.atk && this.atk.phase === "active" ? this.trail : null };
    return out;
  }
}
