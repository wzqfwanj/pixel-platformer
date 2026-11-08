import { hex } from "../core/util.js";

// 新增三种敌人。像素图统一宽度，方便排版。
const P = {
  ink: hex("#141021"),
  // 蝙蝠
  batBody: hex("#6a4a8a"),
  batDark: hex("#3f2a56"),
  batWing: hex("#8a63ad"),
  batEye: hex("#ff5a4a"),
  // 骷髅
  bone: hex("#e4dcc8"),
  boneD: hex("#a89c80"),
  boneL: hex("#fffaf0"),
  skullEye: hex("#141021"),
  skullGlow: hex("#7cf0d0"),
  // 石像鬼
  stone: hex("#5c5c6b"),
  stoneD: hex("#3a3a46"),
  stoneL: hex("#8a8a9c"),
  stoneEye: hex("#ffb03a"),
};

const ART = {
  // 12x10，翅膀会随帧开合（这里给两张）
  bat: [
    "...kkkk.....",
    "..kbbbbk....",
    ".kbwbbwbk...",
    "kbbbbbbbbk..",
    "kwbbmmbbwk..",
    ".kbbbbbbk...",
    "..kbbbbk....",
    "...kbbk.....",
    "....kk......",
  ],
  skull: [
    "...kkkkkk...",
    "..kbbbbbbk..",
    ".kbbbbbbbbk.",
    ".kbkkbbkkbk.",
    ".kbkkbbkkbk.",
    ".kbbbbbbbbk.",
    "..kbbkkbbk..",
    "...kbkbk....",
    "....kkkk....",
  ],
  gargoyle: [
    "..kk....kk..",
    ".kssk..kssk.",
    "ksssskkssssk",
    "kssseesssssk",
    "kssssssssssk",
    ".kssssssssk.",
    "..kssssssk..",
    "..ksskkssk..",
    "...kk..kk...",
  ],
};

for (const [name, rows] of Object.entries(ART)) {
  const w = rows[0].length;
  for (const r of rows) if (r.length !== w) throw new Error(`敌人像素图 ${name} 行宽不一致: "${r}" (${r.length} vs ${w})`);
}

const PALS = {
  bat: { k: P.ink, b: P.batBody, d: P.batDark, w: P.batWing, e: P.batEye, m: P.batEye },
  skull: { k: P.ink, b: P.bone, e: P.skullGlow },
  gargoyle: { k: P.ink, s: P.stone, e: P.stoneEye },
};

export { ART as ENEMY_ART2, PALS as ENEMY_PAL2, P as ENEMY_COLORS2 };
