// 敌人：木桩靶（不会动，练连招用）和史莱姆（会走过来咬你）

import { hex, clamp } from "../core/util.js";
import { SpritePlate } from "../core/spriteplate.js";
import { ENEMY_ART2, ENEMY_PAL2 } from "./enemyArt.js";

const P = {
  straw: hex("#d8b064"), strawD: hex("#a87c3c"), strawL: hex("#f0d090"),
  wood: hex("#6a4426"), woodD: hex("#42291a"), ink: hex("#241a12"),
  band: hex("#a82430"), bandL: hex("#d8544a"),
  green: hex("#6cc24a"), greenD: hex("#3f8a2e"), greenL: hex("#a8e070"),
  eye: hex("#141021"), white: hex("#ffffff"),
};

const ART = {
  ...ENEMY_ART2,
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

// 新增敌人的调色板（蝙蝠/骷髅/石像鬼）
const PAL2 = { ...PAL, ...ENEMY_PAL2, ...Object.fromEntries(Object.entries(ENEMY_PAL2).flatMap(([k, v]) => Object.entries(v))) };

const WHITE_PAL = Object.fromEntries(Object.keys(PAL).map((c) => [c, P.white]));

const plate = new SpritePlate(16, 22);

const TYPES = {
  // 原有关卡用
  dummy: { w: 12, h: 18, hp: 40, art: "dummy", speed: 0, contact: 0, xp: 20 },
  slime: { w: 11, h: 8, hp: 20, art: "slime", speed: 20, contact: 8, xp: 10 },

  // 无尽模式用 —— 从两侧刷出来往玩家身上扑
  // 蝙蝠：会飞，走正弦上下飘，不受重力
  bat: {
    w: 10, h: 8, hp: 14, art: "bat", speed: 54, contact: 6, xp: 12,
    fly: true, flying: true,
  },
  // 骷髅：地面单位，会往玩家方向小跳
  skull: {
    w: 10, h: 9, hp: 26, art: "skull", speed: 30, contact: 9, xp: 18,
    hops: true,
  },
  // 石像鬼：慢、血厚，会蓄力后冲撞
  gargoyle: {
    w: 11, h: 9, hp: 46, art: "gargoyle", speed: 22, contact: 13, xp: 30,
    charges: true,
  },
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
    this.hopCd = 0;
    this.chargeT = 0;
    this.chargeCd = 0;
    this.charging = false;
    this.chargeLeft = 0;
    this.grounded = false;
  }

  get box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  /**
   * 受伤。opts: { kb 水平击退, lift 竖直（负数=浮空）, stun 僵直秒数 }
   * 命中反馈的强度由招式决定，敌人只负责照着演。
   */
  takeDamage(dmg, fromX, world, crit = false, opts = {}) {
    // 已经死了就不再吃伤害：否则会重复触发击杀流程
    if (this.dead) return;
    // 防御：伤害必须是有限数，否则 hp 会变成 NaN 并污染后续所有计算
    if (!Number.isFinite(dmg)) {
      console.warn("[enemy] 收到非法伤害值:", dmg);
      return;
    }
    this.hp = Math.max(0, this.hp - dmg);
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

    if (this.hp <= 0 && !this.dead) {
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

    const p = world.player;

    if (this.hitStun <= 0) {
      switch (this.type) {
        case "slime": {
          const dx = p.cx - this.cx;
          if (Math.abs(dx) < 70 && Math.abs(p.cy - this.cy) < 40) {
            this.dir = Math.sign(dx) || 1;
            this.vx = this.dir * 34;
          } else {
            this.vx = this.dir * this.def.speed;
            if (Math.abs(this.cx - this.homeX) > 40) this.dir = Math.sign(this.homeX - this.cx);
          }
          const aheadX = this.cx + this.dir * (this.w / 2 + 3);
          if (!L.solidAt(aheadX, this.y + this.h + 2)) { this.dir *= -1; this.vx = 0; }
          break;
        }

        case "bat": {
          // 飞行：一直朝玩家水平逼近，竖直用正弦飘移（不受重力）
          const dx = p.cx - this.cx;
          this.dir = Math.sign(dx) || this.dir;
          // 靠近后不硬贴，减速盘旋，给玩家反击窗口
          const dist = Math.abs(dx);
          const speed = dist < 26 ? this.def.speed * 0.35 : this.def.speed;
          this.vx = this.dir * speed;
          // 竖直：朝玩家胸口靠，同时叠正弦让轨迹飘忽
          const targetY = p.cy - this.h / 2;
          const bob = Math.sin(this.t * 3.4 + this.homeX) * 14;
          this.vy = (targetY + bob - this.cy) * 2.2;
          this.vy = Math.max(-90, Math.min(90, this.vy));
          break;
        }

        case "skull": {
          // 地面：朝玩家走，间隔起跳越过障碍
          const dx = p.cx - this.cx;
          this.dir = Math.sign(dx) || this.dir;
          this.vx = this.dir * this.def.speed;
          this.hopCd = (this.hopCd ?? 0) - dt;
          if (this.grounded && this.hopCd <= 0 && Math.abs(dx) > 18) {
            this.vy = -250;
            this.hopCd = 0.9 + Math.random() * 0.5;
          }
          break;
        }

        case "gargoyle": {
          // 慢速推进；进入范围后先蓄力（亮眼 + 不动），然后猛冲
          const dx = p.cx - this.cx;
          this.dir = Math.sign(dx) || this.dir;
          this.chargeT = (this.chargeT ?? 0) + dt;

          if (this.charging) {
            // 冲撞中：保持高速，撞到东西或超时就结束
            this.vx = this.dir * this.def.speed * 4.2;
            this.chargeLeft -= dt;
            if (this.chargeLeft <= 0) {
              this.charging = false;
              this.chargeT = 0;
              this.chargeCd = 2.2;
            }
          } else if (this.chargeCd > 0) {
            this.chargeCd -= dt;
            this.vx = this.dir * this.def.speed * 0.6;
          } else if (this.chargeT > 1.1 && Math.abs(dx) < 90) {
            // 蓄力结束，冲
            this.charging = true;
            this.chargeLeft = 0.42;
            world.fx.spawn("impacts/hit-spark", this.cx, this.cy, { flip: this.dir < 0 });
          } else {
            this.vx = this.dir * this.def.speed;
          }
          break;
        }
      }
    }

    // ---- 重力 + 碰撞（飞行单位不受重力）
    if (!this.def.flying) this.vy = Math.min(420, this.vy + 1000 * dt);

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
