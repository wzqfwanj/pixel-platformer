// 连招的可视化验证：把连续若干帧的攻击动作拼成一张图。
// 用来肉眼确认"刀光 + 身体 + 敌人反应"是不是连贯的。
// 用法: node game/tools/combostrip.mjs [帧数] -> preview-combo.png

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Surface } from "../core/screen.js";
import { hex } from "../core/util.js";
import { Level } from "../world/level.js";
import { Warrior } from "../entities/warrior.js";
import { Enemy } from "../entities/enemy.js";
import { FxLayer, WARRIOR_PALETTE } from "../fx/fxlayer.js";
import { drawText } from "../core/text.js";
import { placeCamera, followCamera, renderCamera } from "../world/camera.js";
import { bakeSky, bakeHills, PARALLAX_W } from "../world/background.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 320, H = 180;
const FRAMES = Number(process.argv[2] ?? 10);
const EVERY = Number(process.argv[3] ?? 4);

const fx = new FxLayer();
await fx.preload();
const level = new Level();
const baked = level.bake();
const sky = bakeSky(W, H);
const hills = bakeHills(PARALLAX_W, H);

const world = {
  level, fx, enemies: [], player: null,
  shake() {}, hitLag() {}, onHit() {}, onEnemyKilled() {}, respawnPlayer() {},
};

const p = new Warrior(level.spawn.x, level.spawn.y);
world.player = p;
const e = new Enemy("dummy", level.spawn.x + 26, level.spawn.y);
e.update = () => {};
world.enemies = [e];
const cam = placeCamera({ x: 0, y: 0 }, p, level);

class FakeInput {
  constructor() { this.down = new Set(); this.just = new Set(); }
  held(a) { return this.down.has(a); }
  pressed(a) { return this.just.has(a); }
  letGo() { return false; }
  axis() { return 1; }
  apply(want) {
    this.just.clear();
    for (const k of want) if (!this.down.has(k)) this.just.add(k);
    this.down = new Set(want);
  }
}
const input = new FakeInput();

// 逐帧推进，按节奏连打
const shots = [];
for (let i = 0; i < FRAMES * EVERY; i++) {
  // 每 7 帧按一次攻击，模拟玩家连点
  input.apply(new Set(i % 7 === 0 ? ["attack"] : []));
  p.update(1 / 60, input, world);
  followCamera(cam, p, level);
  fx.update(1 / 60, cam);
  input.apply(new Set());

  if (i % EVERY === 0) {
    const buf = new Surface(W, H);
    buf.clearLight();
    const rc = renderCamera(cam, 0);
    // 背景 + 关卡
    const { blitRect } = await import("../core/screen.js");
    blitRect(sky, buf, 0, 0, W, H, 0, 0);
    const off = Math.round((rc.x * 0.28) % PARALLAX_W);
    for (let k = -1; k <= 1; k++) blitRect(hills, buf, 0, 0, PARALLAX_W, H, k * PARALLAX_W - off, 0);
    blitRect(baked, buf, rc.x, rc.y, W, H, 0, 0);
    fx.drawBack(buf, rc);
    // 敌人（用固定位置，不跑）
    e.x = p.cx + 22 - e.w / 2;
    e.y = level.spawn.y - e.h;
    e.draw(buf, rc);
    p.draw(buf, rc);
    fx.drawFront(buf, rc);

    // 帧号标注
    const atkInfo = p.atk ? `${p.atk.kind}#${p.atk.idx + 1} ${p.atk.phase}` : p.state;
    drawText(buf, `f${i} ${atkInfo}`, 4, 4, hex("#ffffff"), { shadow: hex("#000000") });
    shots.push({ surf: buf, label: atkInfo });
  }
}

// 拼成竖排长图（每格 320x180）
const cols = 2;
const rows = Math.ceil(shots.length / cols);
const PAD = 4, LABEL_H = 10;
const OW = cols * (W + PAD) + PAD;
const OH = rows * (H + PAD + LABEL_H) + PAD;
const out = new Surface(OW, OH);
out.clear(hex("#101018"));

shots.forEach((sh, idx) => {
  const cx = PAD + (idx % cols) * (W + PAD);
  const cy = PAD + Math.floor(idx / cols) * (H + PAD + LABEL_H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = sh.surf.color[y * W + x];
      if (c) out.px(cx + x, cy + LABEL_H + y, c);
    }
  drawText(out, sh.label, cx + 2, cy + 1, hex("#c8bfd8"));
});

function save() {
  writeFileSync(join(HERE, "..", "preview-combo.png"), encodePNG(OW, OH, rgba(out)));
  console.log(`已写出 preview-combo.png  ${OW}x${OH}（${shots.length} 格，每 ${EVERY} 帧一张）`);
}

function rgba(surf) {
  const w = surf.w, h = surf.h, d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = surf.color[i];
    d[i * 4] = c & 255;
    d[i * 4 + 1] = (c >>> 8) & 255;
    d[i * 4 + 2] = (c >>> 16) & 255;
    d[i * 4 + 3] = (c >>> 24) & 255;
  }
  return d;
}

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, "ascii"), data]), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, d) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(d.buffer, d.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

save();
