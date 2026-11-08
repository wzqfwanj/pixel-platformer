// 把角色/敌人的各种姿势排成一张 PNG，方便肉眼检查像素画
// 用法: node game/tools/sprites.mjs  -> 写 preview-sprites.png

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Surface } from "../core/screen.js";
import { hex } from "../core/util.js";
import { drawWarrior, WARRIOR_W, WARRIOR_H } from "../entities/warriorArt.js";
import { drawText } from "../core/text.js";
import { SpritePlate } from "../core/spriteplate.js";
import { ENEMY_ART, ENEMY_PAL } from "../entities/enemy.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const K = 6;
const CELL = 30;

const POSES = [
  ["idle", { legs: "stand", bob: 0, sword: Math.PI / 2.2 }],
  ["idle2", { legs: "stand", bob: 1, sword: Math.PI / 2.2 }],
  ["run1", { legs: "run", phase: 0, bob: 0, sword: 1.0 }],
  ["run2", { legs: "run", phase: 1, bob: 1, sword: 1.0 }],
  ["run3", { legs: "run", phase: 2, bob: 0, sword: 1.0 }],
  ["jump", { legs: "jump", sword: -1.2 }],
  ["fall", { legs: "fall", sword: 0.5 }],
  ["wind", { legs: "attack", sword: -1.9 }],
  ["cut", { legs: "attack", sword: -1.2 }],
  ["cut2", { legs: "attack", sword: 0.2 }],
  ["cut3", { legs: "attack", sword: 0.9 }],
  ["down", { legs: "attack", sword: 1.15 }],
  ["charge", { legs: "stand", sword: -2.0, charge: 1 }],
  ["hurt", { legs: "fall", bob: -1, sword: 2.4, flash: true }],
  ["dead", { legs: "dead", sword: Math.PI / 2 }],
];

const W = POSES.length * CELL + 6;
const H = 58;
const s = new Surface(W, H);
s.clear(hex("#241a30"));

POSES.forEach(([label, pose], i) => {
  const x = i * CELL + 4;
  s.rect(x - 1, 3, CELL - 2, 34, hex("#171223"));
  const plate = new SpritePlate(WARRIOR_W + 2, WARRIOR_H + 2);
  plate.render((p) => drawWarrior(p, 1, 1, 1, pose));
  plate.blit(s, x, 6, true);
  drawText(s, label, x + 11, 42, hex("#c8bfd8"), { align: "center" });
});

// 敌人
let bx = 4;
for (const [name, rows] of Object.entries(ENEMY_ART)) {
  s.rect(bx - 1, 44, rows[0].length + 14, 14, hex("#171223"));
  const plate = new SpritePlate(rows[0].length + 2, rows.length + 2);
  plate.render((p) => p.sprite(rows, ENEMY_PAL, 1, 1));
  plate.blit(s, bx, 45, true);
  drawText(s, name, bx + 16, 49, hex("#c8bfd8"));
  bx += rows[0].length + 20;
}
drawText(s, "warrior poses / enemies", W - 4, 4, hex("#7a7290"), { align: "right" });

function main() {
  const png = encodePNG(W * K, H * K, upscale(s, K));
  writeFileSync(join(HERE, "..", "preview-sprites.png"), png);
  console.log(`已写出 preview-sprites.png  ${W * K}x${H * K}`);
}

function upscale(surf, k) {
  const w = surf.w * k, h = surf.h * k, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = surf.color[((y / k) | 0) * surf.w + ((x / k) | 0)];
      const i = (y * w + x) * 4;
      out[i] = c & 255;
      out[i + 1] = (c >>> 8) & 255;
      out[i + 2] = (c >>> 16) & 255;
      out[i + 3] = (c >>> 24) & 255;
    }
  return out;
}

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, "ascii"), data]), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePNG(w, h, rgba) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
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

main();
