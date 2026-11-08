// 敌人：木桩靶（不会动，练连招用）和史莱姆（会走过来咬你）

import { hex, clamp } from "../core/util.js";
import { SpritePlate } from "../core/spriteplate.js";

const P = {
  straw: hex("#d8b064"), strawD: hex("#a87c3c"), strawL: hex("#f0d090"),
  wood: hex("#6a4426"), woodD: hex("#42291a"), ink: hex("#241a12"),
  band: hex("#a82430"), bandL: hex("#d8544a"),
  green: hex("#6cc24a"), greenD: hex("#3f8a2e"), greenL: hex("#a8e070"),
  eye: hex("#141021"), white: hex("#ffffff"),
};

const ART = {
  dummy: [
    "...kkkk....",
    "..kssssk...",
    ".kssssssk..",
    ".ksLssLsk..",
    "kssSssSssk.",
    "kssSssSssk.",
    "krrrrrrrrk.",
    "krRrrrrRrk.",
    "kssssssssk.",
    ".kssssssk..",
    ".kssssssk..",
    "..kssssk...",
    "...kwwk....",
    "...kwwk....",
    "...kwwk....",
    "...kwwk....",
    "...kwwk....",
    "..kkkkkk...",
  ],
  slime: [
    "....kkkk....",
    "..kggggggk..",
    ".kggwwwwggk.",
    "kggweewweggk",
    "kggwwwwwwggk",
    "kgggggggggGk",
    ".kgGggggGgk.",
    "..kkkkkkkk..",
  ],
};

for (const [k, rows] of Object.entries(ART))
  for (const r of rows)
    if (r.length !== rows[0].length) throw new Error(`敌人像素图 ${k} 行宽不一致: "${r}" (${r.length} vs ${rows[0].length})`);

const PAL = {
  k: P.ink, s: P.straw, S: P.strawD, L: P.strawL, w: P.wood, r: P.band, R: P.bandL,
  g: P.green, G: P.greenD, e: P.eye,
};
const WHITE_PAL = Object.fromEntries(Object.keys(PAL).map((c) => [c, P.white]));

const plate = new SpritePlate(16, 22);

const TYPES = {
  dummy: { w: 12, h: 18, hp: 40, art: "dummy", speed: 0, contact: 0, xp: 20 },
  slime: { w: 11, h: 8, hp: 20, art: "slime", speed: 20, contact: 8, xp: 10 },
};

export class Enemy {
  constructor(type, x, y) {
    const d = TYPES[type];
    this.type = type;
    this.def = d;
    this.w = d.w;
    this.h = d.h;
    this.x = x - d.w / 2;
    this.y = y - d.h;
    this.vx = 0;
    this.vy = 0;
    this.hp = d.hp;
    this.maxHp = d.hp;
    this.flash = 0;
    this.shakeT = 0;    // 被打时的高频抖动（木桩用）
    this.shakeAmp = 0;
    this.hitStun = 0;
    this.dead = false;
    this.deadT = 0;
    this.dir = -1;
    this.t = Math.random() * 4;
    this.contactCd = 0;
    this.grounded = false;
    this.homeX = x;
  }

  get box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  /**
   * 受伤。opts: { kb 水平击退, lift 竖直（负数=浮空）, stun 僵直秒数 }
   * 命中反馈的强度由招式决定，敌人只负责照着演。
   */
  takeDamage(dmg, fromX, world, crit = false, opts = {}) {
    if (this.dead) return;
    this.hp -= dmg;
    this.flash = 0.09;
    this.hitStun = opts.stun ?? 0.16;

    const dir = Math.sign(this.cx - fromX) || 1;
    const kb = opts.kb ?? (this.type === "dummy" ? 26 : 90);
    // 木桩钉在原地（练连招用），但要有"被打到"的反应：抖动 + 前倾
    if (this.type === "dummy") {
      this.vx = dir * Math.min(kb, 30) * 0.35;
      this.shakeT = 0.12;
      this.shakeAmp = Math.min(3, kb / 40);
    } else {
      this.vx = dir * kb;
      if (opts.lift) this.vy = opts.lift;
    }

    world.fx.spawn("impacts/hit-spark", this.cx + dir * 4, this.cy, { flip: dir < 0, seed: this.cx });
    world.fx.spawn("ui/damage-number", this.cx, this.y - 4, { number: dmg, crit });

    // 连段递增：第 2、3 下火花更大
    if (crit) world.fx.spawn("impacts/crit-hit", this.cx, this.cy, { seed: this.cx });

    if (this.hp <= 0) {
      this.dead = true;
      this.deadT = 0;
      world.fx.spawn(this.type === "slime" ? "spawn/poof" : "spawn/disintegrate", this.cx, this.cy + this.h / 2);
      world.fx.spawn("ui/coin-collect", this.cx, this.cy, {});
      world.onEnemyKilled?.(this);
    }
  }

  update(dt, world) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.hitStun = Math.max(0, this.hitStun - dt);
    this.contactCd = Math.max(0, this.contactCd - dt);
    if (this.dead) {
      this.deadT += dt;
      return;
    }

    const L = world.level;

    if (this.type === "slime" && this.hitStun <= 0) {
      const p = world.player;
      const dx = p.cx - this.cx;
      if (Math.abs(dx) < 70 && Math.abs(p.cy - this.cy) < 40) {
        this.dir = Math.sign(dx) || 1;
        this.vx = this.dir * 34;
      } else {
        this.vx = this.dir * this.def.speed;
        // 走到出生点附近就掉头，别掉进坑
        if (Math.abs(this.cx - this.homeX) > 40) this.dir = Math.sign(this.homeX - this.cx);
      }
      // 前面没路就掉头
      const aheadX = this.cx + this.dir * (this.w / 2 + 3);
      if (!L.solidAt(aheadX, this.y + this.h + 2)) {
        this.dir *= -1;
        this.vx = 0;
      }
    }

    // ---- 重力 + 碰撞
    this.vy = Math.min(420, this.vy + 1000 * dt);

    this.x += this.vx * dt;
    if (L.solidRect(this.x, this.y, this.w, this.h)) {
      this.x -= this.vx * dt;
      this.dir *= -1;
      this.vx = 0;
    }

    this.y += this.vy * dt;
    if (L.solidRect(this.x, this.y, this.w, this.h)) {
      this.y = Math.floor((this.y + this.h) / L.T) * L.T - this.h;
      this.vy = 0;
    }
    // 站立判定 + 脚压到格线（和战士同样的原因：不压住就会每几帧下沉 1 像素）
    const grounded = this.vy >= 0 && L.solidRect(this.x, this.y + 1, this.w, this.h);
    if (grounded) {
      const feet = this.y + this.h, line = Math.round(feet / L.T) * L.T;
      if (Math.abs(line - feet) <= 1.5) this.y = line - this.h;
      this.vy = 0;
    }
    this.grounded = grounded;

    if (this.hitStun <= 0 && this.type === "dummy") this.vx *= 0.85;
  }

  draw(s, cam = { x: 0, y: 0 }) {
    const rows = ART[this.def.art];
    const camX = cam.x | 0, camY = cam.y | 0;
    // 史莱姆的弹性：0 或 1 像素的挤压，频率跟着时间走
    const squash = this.type === "slime" ? (Math.sin(this.t * 8) > 0 ? 0 : 1) : 0;
    // 同战士：以角色中心/脚底的整数位置为准，避免和相机两次取整不同步
    const dx = Math.round(this.cx) - Math.round(rows[0].length / 2) - camX;
    const dy = Math.round(this.y + this.h) - rows.length - camY + squash;

    if (this.dead) {
      const k = clamp(1 - this.deadT / 0.5, 0, 1);
      if (k <= 0) return;
      plate.render((p) => p.sprite(rows, PAL, 1, 1, { flip: this.dir < 0 }));
      plate.blit(s, dx - 1, Math.round(dy + (1 - k) * 6) - 1, true);
      return;
    }

    plate.render((p) => {
      p.sprite(rows, PAL, 1, 1, { flip: this.dir < 0 });
      if (this.flash > 0) p.sprite(rows, WHITE_PAL, 1, 1, { flip: this.dir < 0 });
    });
    plate.blit(s, dx - 1, dy - 1, true);

    if (this.type === "slime" && this.hp < this.maxHp) {
      const w = 12, hpw = Math.round((this.hp / this.maxHp) * w);
      s.rect(dx, dy - 4, w, 2, hex("#141021"));
      s.rect(dx, dy - 4, hpw, 1, hex("#d8544a"));
    }
  }
}

export { P as ENEMY_COLORS, ART as ENEMY_ART, PAL as ENEMY_PAL };
