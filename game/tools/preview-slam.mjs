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
import { setTheme } from "../core/theme.js";

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
const idle = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: () => false, axis: () => 0 };
for (let i = 0; i < 12; i++) p.update(1 / 60, idle, world);
const cam = placeCamera({ x: 0, y: 0 }, p, level);
setTheme("dark");

const shots = [];
function snap(label, highlight) {
  const buf = new Surface(W, H);
  buf.clearLight();
  const rc = renderCamera(cam, 0);
  blitRect(sky, buf, 0, 0, W, H, 0, 0);
  const off = Math.round((rc.x * 0.28) % PARALLAX_W);
  for (let k = -1; k <= 1; k++) blitRect(hills, buf, 0, 0, PARALLAX_W, H, k * PARALLAX_W - off, 0);
  blitRect(baked, buf, rc.x, rc.y, W, H, 0, 0);
  fx.drawBack(buf, rc);
  for (const e of world.enemies) if (!e.dead) e.draw(buf, rc);
  p.draw(buf, rc);
  fx.drawFront(buf, rc);
  drawText(buf, label, 4, 4, hex("#ffffff"), { shadow: hex("#000000") });
  shots.push({ buf, label, highlight });
}

world.enemies = [26, -26, 42].map((dx) => {
  const e = new Enemy("slime", p.cx + dx, p.feet);
  e.update = () => {};
  return e;
});

// 蓄满
const holdIn = { down: new Set(["heavy"]), just: new Set(["heavy"]), held: (a) => a === "heavy", pressed: (a) => a === "heavy", letGo: () => false, axis: () => 0 };
p.update(1 / 60, holdIn, world);
holdIn.just.clear();
holdIn.pressed = () => false;
for (let i = 0; i < 50; i++) p.update(1 / 60, holdIn, world);
snap("蓄满，按住 K");

const relIn = { down: new Set(), just: new Set(), held: () => false, pressed: () => false, letGo: (a) => a === "heavy", axis: () => 0 };
p.update(1 / 60, relIn, world);
let guard = 0;
while (p.slash && p.slash.phase === "windup" && guard++ < 30) p.update(1 / 60, idle, world);

// 爆炸后不同时刻
for (const [frames, label] of [[2, "爆炸 +0.03s 地形闪红"], [6, "爆炸 +0.1s"], [14, "爆炸 +0.23s 石头飞起"], [30, "爆炸 +0.5s"]]) {
  for (let i = 0; i < frames; i++) { p.update(1 / 60, idle, world); fx.update(1 / 60, cam); }
  snap(label);
}

// 拼图 2 列
const cols = 2;
const rows = Math.ceil(shots.length / cols);
const PAD = 4;
const OW = cols * (W + PAD) + PAD;
const OH = rows * (H + PAD) + PAD;
const out = new Surface(OW, OH);
out.clear(hex("#101018"));
shots.forEach((sh, i) => {
  const cx = PAD + (i % cols) * (W + PAD);
  const cy = PAD + Math.floor(i / cols) * (H + PAD);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = sh.buf.color[y * W + x];
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
writeFileSync("preview-slam.png", encodePNG(pw, ph, rgba));
console.log("已写出 preview-slam.png（" + pw + "x" + ph + "，" + shots.length + " 格）");
shots.forEach((s, i) => console.log("  " + (i + 1) + ". " + s.label));
