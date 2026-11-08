// 生成角色预览：素材 4 帧行走 + 游戏内实拍（待机/跑动/攻击/跳跃）。
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { Surface, blitRect } from "../core/screen.js";
import { hex } from "../core/util.js";
import { Level } from "../world/level.js";
import { Warrior } from "../entities/warrior.js";
import { Enemy } from "../entities/enemy.js";
import { FxLayer } from "../fx/fxlayer.js";
import { bakeSky, bakeHills, PARALLAX_W } from "../world/background.js";
import { placeCamera, renderCamera } from "../world/camera.js";
import { drawText } from "../core/text.js";
import { drawNinja, NINJA_W, NINJA_H } from "../entities/warriorNinjaArt.js";

const fx = new FxLayer();
await fx.preload();

const W = 320, H = 180;
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
const dummy = new Enemy("dummy", level.spawn.x + 30, level.spawn.y);
dummy.update = () => {};
world.enemies = [dummy];

const idleIn = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0, set() {} };
for (let i = 0; i < 10; i++) p.update(1 / 60, idleIn, world);

const cam = placeCamera({ x: 0, y: 0 }, p, level);
const shots = [];
function snap(label) {
  const buf = new Surface(W, H);
  buf.clearLight();
  const rc = renderCamera(cam, 0);
  blitRect(sky, buf, 0, 0, W, H, 0, 0);
  const off = Math.round((rc.x * 0.28) % PARALLAX_W);
  for (let k = -1; k <= 1; k++) blitRect(hills, buf, 0, 0, PARALLAX_W, H, k * PARALLAX_W - off, 0);
  blitRect(baked, buf, rc.x, rc.y, W, H, 0, 0);
  fx.drawBack(buf, rc);
  for (const e of world.enemies) e.draw(buf, rc);
  p.draw(buf, rc);
  fx.drawFront(buf, rc);
  drawText(buf, label, 4, 4, hex("#ffffff"), { shadow: hex("#000000") });
  shots.push(buf);
}

snap("IDLE");
// 跑动：连续几帧看走路循环
const runIn = { down: new Set(["right"]), just: new Set(), held: (a) => a === "right", pressed: () => false, letGo: () => false, axis: () => 1, set() {} };
for (let i = 0; i < 14; i++) p.update(1 / 60, runIn, world);
snap("RUN a");
for (let i = 0; i < 6; i++) p.update(1 / 60, runIn, world);
snap("RUN b");
for (let i = 0; i < 6; i++) p.update(1 / 60, runIn, world);
snap("RUN c");

// 攻击
const atkIn = { down: new Set(), just: new Set(["attack"]), held: () => false, pressed: (a) => a === "attack", letGo: () => false, axis: () => 0, set() {} };
p.update(1 / 60, atkIn, world);
atkIn.just.clear();
let shotAtk = 0;
for (let i = 0; i < 24; i++) {
  p.update(1 / 60, atkIn, world);
  if (p.atk && p.atk.phase === "active" && shotAtk === 0) { snap("ATTACK"); shotAtk = 1; }
}
// 跳跃
const jumpIn = { down: new Set(["jump"]), just: new Set(["jump"]), held: (a) => a === "jump", pressed: (a) => a === "jump", letGo: () => false, axis: () => 0, set() {} };
p.update(1 / 60, jumpIn, world);
jumpIn.just.clear();
for (let i = 0; i < 8; i++) p.update(1 / 60, jumpIn, world);
snap("JUMP");

// ---- 拼图
const cols = 3;
const rowsN = Math.ceil(shots.length / cols);
const PAD = 4;
const OW = cols * (W + PAD) + PAD;
const OH = rowsN * (H + PAD) + PAD;
const out = new Surface(OW, OH);
out.clear(hex("#101018"));
shots.forEach((sh, i) => {
  const cx = PAD + (i % cols) * (W + PAD);
  const cy = PAD + Math.floor(i / cols) * (H + PAD);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = sh.color[y * W + x];
      if (c) out.px(cx + x, cy + y, c);
    }
});

const K = 2;
const pw = OW * K, ph = OH * K;
const rgba = new Uint8Array(pw * ph * 4);
for (let y = 0; y < ph; y++)
  for (let x = 0; x < pw; x++) {
    const c = out.color[((y / K) | 0) * OW + ((x / K) | 0)];
    const i = (y * pw + x) * 4;
    rgba[i] = c & 255; rgba[i + 1] = (c >>> 8) & 255; rgba[i + 2] = (c >>> 16) & 255; rgba[i + 3] = 255;
  }

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, "ascii"), data]), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePNG(w, h, d) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(d.buffer, d.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
writeFileSync("preview-ninja-game.png", encodePNG(pw, ph, rgba));
console.log(`已写出 preview-ninja-game.png（${pw}x${ph}，${shots.length} 格）`);
