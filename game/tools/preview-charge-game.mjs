// 蓄力实测：真的按 K 键走一遍，看蓄力条和光晕在不同进度下的样子。
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { Surface, blitRect } from "../core/screen.js";
import { hex } from "../core/util.js";
import { Level } from "../world/level.js";
import { Warrior } from "../entities/warrior.js";
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
function snap(label) {
  const buf = new Surface(W, H);
  buf.clearLight();
  const rc = renderCamera(cam, 0);
  blitRect(sky, buf, 0, 0, W, H, 0, 0);
  const off = Math.round((rc.x * 0.28) % PARALLAX_W);
  for (let k = -1; k <= 1; k++) blitRect(hills, buf, 0, 0, PARALLAX_W, H, k * PARALLAX_W - off, 0);
  blitRect(baked, buf, rc.x, rc.y, W, H, 0, 0);
  fx.drawBack(buf, rc);
  p.draw(buf, rc);
  fx.drawFront(buf, rc);
  drawText(buf, label, 4, 4, hex("#ffffff"), { shadow: hex("#000000") });
  // 放大角色区域，方便看条
  shots.push({ buf, focus: { x: Math.round(p.cx - rc.x) - 30, y: Math.round(p.feet - rc.y) - 46, w: 60, h: 56 } });
}

// 按下 K 并保持
const holdIn = {
  down: new Set(["heavy"]), just: new Set(["heavy"]),
  held: (a) => a === "heavy", pressed: (a) => a === "heavy",
  letGo: () => false, axis: () => 0,
};
p.update(1 / 60, holdIn, world);
holdIn.just.clear();
holdIn.pressed = () => false;

const marks = [0.1, 0.3, 0.5, 0.7, 0.9, 1.0];
let mi = 0;
for (let i = 0; i < 90 && mi < marks.length; i++) {
  // 把 charge 凑到目标值附近再截图
  if (p.charging && p.charge / p.cfg.heavy.chargeMax >= marks[mi]) {
    snap(`K 蓄力 ${(marks[mi] * 100).toFixed(0)}%`);
    mi++;
  }
  p.update(1 / 60, holdIn, world);
}

// 拼图：上排是全景，下排是角色特写
const cols = Math.max(1, shots.length);
const PW = 320, PH = 180;
const FW = 120, FH = 112;   // 特写 2 倍
const PAD = 4;
const OW = cols * (PW + PAD) + PAD;
const OH = (PH + PAD) + (FH * 2 + PAD) + PAD;
const out = new Surface(OW, OH);
out.clear(hex("#101018"));

shots.forEach((sh, i) => {
  const cx = PAD + i * (PW + PAD);
  // 全景
  for (let y = 0; y < PH; y++)
    for (let x = 0; x < PW; x++) {
      const c = sh.buf.color[y * PW + x];
      if (c) out.px(cx + x, PAD + y, c);
    }
  // 特写（2 倍放大）
  const f = sh.focus;
  const K = 2;
  const oy = PAD + PH + PAD;
  for (let y = 0; y < f.h * K; y++)
    for (let x = 0; x < f.w * K; x++) {
      const sx = f.x + Math.floor(x / K), sy = f.y + Math.floor(y / K);
      if (sx < 0 || sy < 0 || sx >= PW || sy >= PH) continue;
      const c = sh.buf.color[sy * PW + sx];
      if (c) out.px(cx + x, oy + y, c);
    }
});

const K2 = 2;
const pw = OW * K2, ph = OH * K2;
const rgba = new Uint8Array(pw * ph * 4);
for (let y = 0; y < ph; y++)
  for (let x = 0; x < pw; x++) {
    const c = out.color[((y / K2) | 0) * OW + ((x / K2) | 0)];
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
writeFileSync("preview-charge-game.png", encodePNG(pw, ph, rgba));
console.log(`已写出 preview-charge-game.png（${pw}x${ph}，${shots.length} 档蓄力）`);
