// 无尽模式：怪从玩家左右两侧刷出来，一波比一波多、比一波硬。
// 单独一个模块，关卡模式完全不受影响。

import { Enemy } from "../entities/enemy.js";

/**
 * 难度曲线（按时间，单位秒）
 *   spawnInterval  两批怪之间的间隔，越到后面越短
 *   batch          每批刷几只
 *   pool           这一阶段会出现的怪种（按权重）
 *   hpScale        血量倍率
 */
export const PHASES = [
  {
    at: 0, name: "第一波", spawnInterval: 3.2, batch: [1, 1], hpScale: 1,
    pool: [["slime", 1]],
  },
  {
    at: 25, name: "第二波", spawnInterval: 2.4, batch: [1, 2], hpScale: 1.15,
    pool: [["slime", 3], ["bat", 2]],
  },
  {
    at: 55, name: "第三波", spawnInterval: 1.7, batch: [2, 3], hpScale: 1.35,
    pool: [["slime", 2], ["bat", 3], ["skull", 2]],
  },
  {
    at: 90, name: "第四波", spawnInterval: 1.35, batch: [2, 3], hpScale: 1.6,
    pool: [["bat", 3], ["skull", 3], ["gargoyle", 1]],
  },
  {
    at: 130, name: "第五波", spawnInterval: 1.1, batch: [3, 4], hpScale: 1.9,
    pool: [["slime", 1], ["bat", 3], ["skull", 3], ["gargoyle", 2]],
  },
  {
    at: 180, name: "无尽", spawnInterval: 0.9, batch: [3, 4], hpScale: 2.3,
    pool: [["bat", 3], ["skull", 3], ["gargoyle", 3]],
  },
];

const WEIGHTS = PHASES.map((ph) => {
  const total = ph.pool.reduce((a, [, w]) => a + w, 0);
  return ph.pool.map(([type, w]) => ({ type, acc: w / total }));
});

function pickType(phaseIdx, rand) {
  const table = WEIGHTS[phaseIdx];
  const r = rand();
  let acc = 0;
  for (const e of table) {
    acc += e.acc;
    if (r <= acc) return e.type;
  }
  return table[table.length - 1].type;
}

export class Spawner {
  constructor(rand = Math.random) {
    this.rand = rand;
    this.maxAlive = 18;     // 同屏存活上限（会随阶段调整，见 capOf）
    this.rand  // 保留引用，便于测试注入固定种子
    this.reset();
  }

  reset() {
    this.time = 0;
    this.nextIn = 1.6;      // 开局给玩家一点准备时间
    this.phaseIdx = 0;
    this.spawned = 0;
    this.lastSide = 0;
  }

  /** 每阶段的同屏上限：开局温和，后期才放开 */
  capOf(idx) {
    return [6, 9, 12, 15, 18, 20][Math.min(idx, 5)];
  }

  phaseAt(t) {
    let idx = 0;
    for (let i = 0; i < PHASES.length; i++) if (t >= PHASES[i].at) idx = i;
    return idx;
  }

  get phase() {
    return PHASES[this.phaseIdx];
  }

  /** 下一次刷怪还剩多少秒（HUD 用） */
  get countdown() {
    return Math.max(0, this.nextIn);
  }

  /**
   * 每帧推进。返回这一帧要新生成的敌人数组（由调用方塞进 world.enemies）。
   * viewW 是当前视野宽度，用来决定刷在屏幕外多远。
   */
  update(dt, world, viewW) {
    this.time += dt;
    const newPhase = this.phaseAt(this.time);
    if (newPhase !== this.phaseIdx) {
      this.phaseIdx = newPhase;
      world.onPhaseChange?.(this.phase, newPhase);
    }

    const out = [];
    this.nextIn -= dt;
    if (this.nextIn > 0) return out;

    // 同屏上限：超过就不再刷，等玩家清理。否则躲角落不推进时会堆积到几百只。
    const alive = world.enemies ? world.enemies.filter((e) => !e.dead).length : 0;
    const cap = this.capOf(this.phaseIdx);
    if (alive >= cap) {
      this.nextIn = 0.5;   // 过一会儿再看
      return out;
    }

    const ph = this.phase;
    const [lo, hi] = ph.batch;
    let count = lo + Math.floor(this.rand() * (hi - lo + 1));
    count = Math.min(count, Math.max(1, cap - alive));   // 只补到上限
    this.nextIn = ph.spawnInterval * (0.8 + this.rand() * 0.4);

    // 两侧交替刷，避免总在同一侧
    let side = this.lastSide === 1 ? -1 : 1;
    if (this.rand() < 0.25) side = -side;   // 偶尔连刷同一侧，制造压迫感
    this.lastSide = side;

    for (let i = 0; i < count; i++) {
      const type = pickType(this.phaseIdx, this.rand);
      const margin = 24 + this.rand() * 40;
      const x = side > 0
        ? world.player.cx + viewW / 2 + margin + i * 18
        : world.player.cx - viewW / 2 - margin - i * 18;
      const y = this.spawnY(type, world, x);
      if (y === null) continue;   // 那边没地方站，跳过

      const e = new Enemy(type, x, y);
      // 血量按阶段加成
      e.maxHp = Math.round(e.maxHp * ph.hpScale);
      e.hp = e.maxHp;
      e.fromSpawner = true;
      e.side = side;
      out.push(e);
      this.spawned++;
    }
    return out;
  }

  /** 找这块 x 附近可以落脚的高度；飞行怪直接放在半空 */
  spawnY(type, world, x) {
    const def = ENEMY_DEFS[type];
    if (def?.flying) {
      // 蝙蝠：放在玩家上方一点的空中
      return world.player.cy - 40 - this.rand() * 24;
    }
    const L = world.level;
    // 从地面往下找第一块实心
    const tx = Math.floor(x / L.T);
    for (let ty = 4; ty < L.h; ty++) {
      if (L.at(tx, ty) === "#") return ty * L.T;
    }
    return null;
  }
}

// 只为 spawnY 判断飞行单位，避免额外 import 循环
const ENEMY_DEFS = {
  bat: { flying: true },
  slime: {},
  skull: {},
  gargoyle: {},
};

export { PHASES as SPAWN_PHASES };
