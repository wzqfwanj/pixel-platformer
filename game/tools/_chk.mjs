import { readFileSync } from "node:fs";
const s = readFileSync("entities/warrior.js", "utf8");
const checks = ["startMove(kind", "attackBuffer = Math.max", "this.attackBuffer = 0;", 'input.held("up")', "launcher:", "air:"];
for (const k of checks) console.log(k.padEnd(28), "->", s.includes(k));
