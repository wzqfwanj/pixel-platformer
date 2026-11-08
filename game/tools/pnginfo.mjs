// 读取 PNG 头，报告尺寸和色彩格式（不解码像素，先看规格）
import { readFileSync } from "node:fs";

for (const f of ["art/walk.png", "art/attack.png"]) {
  const b = readFileSync(f);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const depth = b[24];
  const ctype = b[25];
  const interlace = b[28];
  const types = { 0: "灰度", 2: "RGB", 3: "调色板", 4: "灰度+alpha", 6: "RGBA" };
  console.log(`${f}: ${w}x${h}, ${depth}bit, ${types[ctype] ?? ctype}, 隔行=${interlace}, 文件 ${(b.length / 1024).toFixed(0)}KB`);
}
