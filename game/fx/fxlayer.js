// pixelfx 特效层：把库里的小代码特效接进游戏。
// 特效画进自己的 frame（颜色缓冲 + 光照缓冲），再贴进游戏画布，光照会叠到场景上。

import { createFx, createFrame, clearFrame } from "../../pixelfx/src/core/fx.js";

// 用到的特效清单（显式列出，打包器和浏览器都能静态分析）
const LOADERS = {
  "fire/torch": () => import("../../pixelfx/src/fx/fire/torch.js"),
  "fire/flame-pillar": () => import("../../pixelfx/src/fx/fire/flame-pillar.js"),
  "melee/sword-slash": () => import("../../pixelfx/src/fx/melee/sword-slash.js"),
  "melee/double-slash": () => import("../../pixelfx/src/fx/melee/double-slash.js"),
  "melee/heavy-cleave": () => import("../../pixelfx/src/fx/melee/heavy-cleave.js"),
  "melee/spin-slash": () => import("../../pixelfx/src/fx/melee/spin-slash.js"),
  "melee/thrust": () => import("../../pixelfx/src/fx/melee/thrust.js"),
  "impacts/hit-spark": () => import("../../pixelfx/src/fx/impacts/hit-spark.js"),
  "melee/claw-swipe": () => import("../../pixelfx/src/fx/melee/claw-swipe.js"),
  "melee/uppercut": () => import("../../pixelfx/src/fx/melee/uppercut.js"),
  "impacts/crit-hit": () => import("../../pixelfx/src/fx/impacts/crit-hit.js"),
  "impacts/ground-slam": () => import("../../pixelfx/src/fx/impacts/ground-slam.js"),
  "impacts/heavy-landing": () => import("../../pixelfx/src/fx/impacts/heavy-landing.js"),
  "explosions/dirt-explosion": () => import("../../pixelfx/src/fx/explosions/dirt-explosion.js"),
  "lightning/charge-up": () => import("../../pixelfx/src/fx/lightning/charge-up.js"),
  "arcane/spell-charge": () => import("../../pixelfx/src/fx/arcane/spell-charge.js"),
  "ui/damage-number": () => import("../../pixelfx/src/fx/ui/damage-number.js"),
  "ui/combo-counter": () => import("../../pixelfx/src/fx/ui/combo-counter.js"),
  "ui/coin-collect": () => import("../../pixelfx/src/fx/ui/coin-collect.js"),
  "ui/level-up": () => import("../../pixelfx/src/fx/ui/level-up.js"),
  "spawn/poof": () => import("../../pixelfx/src/fx/spawn/poof.js"),
  "spawn/spawn-portal": () => import("../../pixelfx/src/fx/spawn/spawn-portal.js"),
  "spawn/disintegrate": () => import("../../pixelfx/src/fx/spawn/disintegrate.js"),
  "status/burning": () => import("../../pixelfx/src/fx/status/burning.js"),
};

export const MANIFEST = Object.keys(LOADERS);

// 战士的暖色刀光：默认那套是冷蓝的，换成橙金色更配红色战袍
export const WARRIOR_PALETTE = ["#2a0f22", "#4d1230", "#8c2233", "#d8502a", "#ffa83a", "#ffe08a", "#fffaf0"];

const FALLBACK_PALETTE = ["#1a1024", "#3a1a3a", "#6a2a4a", "#b04a5a", "#f08a5a", "#ffd08a", "#fff6e0"];

export class FxLayer {
  constructor() {
    this.mods = {};
    this.live = [];
    this.pool = new Map(); // "w x h" -> 空闲 frame 数组
    this.camera = { x: 0, y: 0 };
    this.time = 0;
    this.seedN = 1;
    this.missing = new Set();
  }

  async preload() {
    await Promise.all(
      Object.entries(LOADERS).map(async ([id, load]) => {
        try {
          this.mods[id] = await load();
        } catch (e) {
          console.warn(`[pixelfx] 载入 ${id} 失败:`, e.message);
        }
      })
    );
    return Object.keys(this.mods).length;
  }

  frame(w, h) {
    const key = w + "x" + h;
    const arr = this.pool.get(key);
    if (arr && arr.length) return arr.pop();
    return createFrame(w, h);
  }
  give(f) {
    const key = f.w + "x" + f.h;
    let arr = this.pool.get(key);
    if (!arr) this.pool.set(key, (arr = []));
    if (arr.length < 4) arr.push(f); // 别无限攒
  }

  /**
   * 放一个特效。x/y 是特效的"原点"在世界里的位置（脚下、命中点、火把根部）。
   * opts 会被传给 pixelfx 的效果（seed、flip、palette，以及各效果自己的选项）。
   */
  spawn(id, x, y, opts = {}) {
    const mod = this.mods[id];
    if (!mod) {
      if (!this.missing.has(id)) {
        this.missing.add(id);
        console.warn(`[pixelfx] 没有这个特效: ${id}`);
      }
      return null;
    }
    const meta = mod.meta;
    const [w, h] = meta.size;
    const [ox, oy] = meta.origin;
    const frame = this.frame(w, h);
    const o = {
      seed: opts.seed ?? (this.seedN++ * 9.13 + this.time * 3.7) % 1000,
      palette: opts.palette ?? FALLBACK_PALETTE,
      ...opts,
      x: ox,
      y: oy,
    };
    // 临时埋点：统计 spawn 次数，排查"连续蓄满后特效消失"
    if (typeof window !== "undefined") {
      window.__spawnCount = window.__spawnCount || {};
      window.__spawnCount[id] = (window.__spawnCount[id] || 0) + 1;
    }
    // 同类特效并发上限：新的进来时把最旧的收掉。
    // 关键：ground-slam 这种大特效叠 3 层会让单帧涨到 10ms，帧率一掉，
    // 视觉上大红闪就变得一顿一顿，像"特效没出现"。
    const maxSame = opts.maxSame ?? 2;
    const same = this.live.filter((e) => e.id === id && !e.stopping);
    for (let i = 0; i <= same.length - maxSame; i++) {
      same[i].fx.stop();
      same[i].stopping = true;
    }

    const fx = createFx(mod, o);
    const inst = { id, fx, mod, frame, ox, oy, x, y, lift: opts.lift ?? 1, sticky: !!opts.sticky, dead: false, stopping: false };
    this.live.push(inst);
    return inst;
  }

  /** 让某个特效提前收尾（配合 stop()，0.3 秒淡出） */
  stopAll(filter) {
    for (const inst of this.live) if (filter(inst)) inst.fx.stop();
  }

  update(dt, camera) {
    this.time += dt;
    if (camera) this.camera = camera;
    const cx = this.camera.x, cy = this.camera.y;
    const keep = [];
    for (const inst of this.live) {
      // 屏幕外的特效不更新（很贵，GDScript 版就吃过这个亏）
      const sx = inst.x - inst.ox - cx, sy = inst.y - inst.oy - cy;
      const onScreen = sx > -inst.frame.w - 64 && sy > -inst.frame.h - 64 && sx < 320 + 64 && sy < 180 + 64;
      inst.fx.update(dt);
      if (inst.fx.done()) {
        if (!inst.sticky) {
          this.give(inst.frame);
          inst.dead = true;
          continue;
        }
      }
      if (inst.sticky && !onScreen) {
        // 循环特效离开屏幕就重置时间，回来时不会闪一下
        keep.push(inst);
        continue;
      }
      keep.push(inst);
    }
    this.live = keep;
  }

  _draw(s, camera, layer) {
    const cx = camera.x, cy = camera.y;
    for (const inst of this.live) {
      const f = inst.frame;
      const sx = inst.x - inst.ox - cx, sy = inst.y - inst.oy - cy;
      if (sx > s.w + 8 || sy > s.h + 8 || sx + f.w < -8 || sy + f.h < -8) continue;
      clearFrame(f);
      inst.fx.draw(f, layer);
      s.blitEffect(f, sx, sy, inst.lift);
    }
  }
  /** 画在角色后面的部分 */
  drawBack(s, camera) {
    this._draw(s, camera, "back");
  }
  /** 画在角色前面的部分（光照也在这一步叠上去） */
  drawFront(s, camera) {
    this._draw(s, camera, "front");
  }

  get count() {
    return this.live.length;
  }
}
