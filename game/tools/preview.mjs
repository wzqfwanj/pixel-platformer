import { Surface } from "../core/screen.js";
import { drawWarrior } from "../entities/warriorArt.js";
import { Warrior } from "../entities/warrior.js";
import { Enemy } from "../entities/enemy.js";

const SH = " .:-=+*#%@";
const dump = (label, w, h, fill) => {
  const s = new Surface(w, h);
  s.clear(0xff101018);
  fill(s);
  let out = `\n---- ${label} (${w}x${h}) ----\n`;
  for (let y = 0; y < h; y++) {
    let line = "";
    for (let x = 0; x < w; x++) {
      const c = s.color[y * w + x];
      if (c === 0xff101018) { line += " "; continue; }
      const lum = ((c & 255) * 0.3 + ((c >>> 8) & 255) * 0.6 + ((c >>> 16) & 255) * 0.1);
      line += SH[Math.max(1, Math.min(9, Math.round((lum / 255) * 9)))];
    }
    out += line + "\n";
  }
  console.log(out);
};

const ROLES = {
  "#100d18": "K", "#2b3348": "S", "#4a5570": "s", "#7d8cb0": "L", "#c2cee6": "X",
  "#5e1018": "C", "#a82430": "c", "#e06250": "l", "#f0c49a": "f", "#c98b6a": "F",
  "#e8b424": "g", "#a86408": "G", "#e8f0ff": "b", "#8f9dc0": "B", "#6a4426": "h", "#ffffff": "W",
};
const colorMap = (label, w, h, fill) => {
  const s = new Surface(w, h);
  s.clear(0xff101018);
  fill(s);
  let out = `\n---- ${label} (${w}x${h}) ----\n`;
  for (let y = 0; y < h; y++) {
    let line = "";
    for (let x = 0; x < w; x++) {
      const c = s.color[y * w + x];
      if (c === 0xff101018) { line += "."; continue; }
      const hexed = "#" + [c & 255, (c >>> 8) & 255, (c >>> 16) & 255].map((v) => v.toString(16).padStart(2, "0")).join("");
      line += ROLES[hexed] ?? "?";
    }
    out += line + "\n";
  }
  console.log(out);
};

// 战士的几种姿势并排看
const poses = [
  ["idle", { legs: "stand", bob: 0, sword: Math.PI / 2.2 }],
  ["run", { legs: "run", phase: 1, bob: 1, sword: 1 }],
  ["jump", { legs: "jump", sword: -1.2 }],
  ["windup", { legs: "attack", sword: -1.9 }],
  ["cut", { legs: "attack", sword: 0.4 }],
  ["down", { legs: "attack", sword: 1.15 }],
];
dump("战士姿势 (每个 26x26)", 30 * poses.length, 27, (s) => {
  poses.forEach(([, pose], i) => drawWarrior(s, i * 30 + 2, 0, 1, pose));
});
console.log("姿势顺序:", poses.map(([n]) => n).join(", "));
console.log("角色: K=描边 S=暗钢 s=钢 L=亮钢 X=高光 c=红布 C=暗红 l=亮红 f=皮肤 F=暗肤 g=金 G=暗金 b=刃 B=刃暗 h=木 W=白");
colorMap("战士 idle", 28, 27, (s) => drawWarrior(s, 1, 0, 1, poses[0][1]));
colorMap("战士 run", 28, 27, (s) => drawWarrior(s, 1, 0, 1, poses[1][1]));
colorMap("战士 down(斩完)", 28, 27, (s) => drawWarrior(s, 1, 0, 1, poses[5][1]));

// 敌人
dump("木桩靶 + 史莱姆", 34, 20, (s) => {
  const d = new Enemy("dummy", 8, 18);
  d.draw(s);
  const e = new Enemy("slime", 26, 18);
  e.draw(s);
});

// 图块
import { Level } from "../world/level.js";
const lv = new Level();
const baked = lv.bake();
dump("图块样本：坑 + 台地 + 尖刺 + 火把位 (x=0..79, y=224..288)", 80, 64, (s) => {
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 80; x++) s.color[y * 80 + x] = baked.color[(224 + y) * baked.w + (16 + x)];
});
