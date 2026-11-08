// 蓄力条预览：把 0%..100% 的蓄力状态横排画出来，检查颜色分段和满蓄力提示。
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { Surface } from "../core/screen.js";
import { hex } from "../core/util.js";
import { drawNinja, NINJA_DW, NINJA_DH } from "../entities/warriorNinjaArt.js";
import { drawChargeBar } from "../ui/chargebar.js";
import { setTheme } from "../core/theme.js";

const STEPS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0.98, 1.0];
const CELL_W = 30, CELL_H = 34, PAD = 4;
const W = STEPS.length * CELL_W + PAD * 2;
const H = CELL_H + PAD * 2 + 8;

for (const theme of ["dark", "light"]) {
  setTheme(theme);
  const s = new Surface(W, H);
  s.clear(hex(theme === "dark" ? "#14121c" : "#dcdce4"));

  STEPS.forEach((k, i) => {
    const cx = PAD + i * CELL_W + CELL_W / 2;
    // 角色（脚底对齐）
    const px = Math.round(cx - NINJA_DW / 2);
    const py = PAD + 8 + CELL_H - NINJA_DH - 2;
    drawNinja(s, px, py, 1, "walk", 0, { stretch: 0.94, tilt: -0.25 });
    // 蓄力条
    drawChargeBar(s, cx, py, k, 0.5);
    // 百分比
    const label = `${Math.round(k * 100)}`;
  });

  // 放大 4 倍输出
  const K = 4;
  const pw = W * K, ph = H * K;
  const rgba = new Uint8Array(pw * ph * 4);
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      const c = s.color[((y / K) | 0) * W + ((x / K) | 0)];
      const i = (y * pw + x) * 4;
      rgba[i] = c & 255; rgba[i + 1] = (c >>> 8) & 255; rgba[i + 2] = (c >>> 16) & 255; rgba[i + 3] = 255;
    }

  const CRC = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k2 = 0; k2 < 8; k2++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
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
  writeFileSync(`preview-charge-${theme}.png`, encodePNG(pw, ph, rgba));
  console.log(`已写出 preview-charge-${theme}.png（${pw}x${ph}，蓄力 ${STEPS.length} 档）`);
}
