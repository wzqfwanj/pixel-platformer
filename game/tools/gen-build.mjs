import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 构建标记。
// 之前只用 git 短哈希，但未提交的改动不会改变哈希 —— 部署后无法确认"是不是这次的内容"。
// 现在用【时间戳 + git 哈希】：时间戳每次都变，能确认部署真的生效。
const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = join(HERE, "..");
const ROOT = join(GAME, "..");

let hash = "nogit";
try {
  hash = execSync("git rev-parse --short HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  // 有未提交改动就加个 + 标记
  const dirty = execSync("git status --porcelain", { encoding: "utf8", cwd: ROOT }).trim();
  if (dirty) hash += "+";
} catch {
  /* 不是 git 仓库 */
}

const d = new Date();
const pad = (n) => String(n).padStart(2, "0");
// 时间戳精确到秒，每次部署都不同
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const id = stamp.replace(/[-: ]/g, "").slice(0, 14);

const out = `// 构建标记：每次部署前由 tools/gen-build.mjs 生成。
// id 精确到秒，部署后可以在页面左下角/调试信息里核对。
export const BUILD = {
  id: "${id}",
  hash: "${hash}",
  time: "${stamp}",
  label: "${id} ${hash}",
};
`;
writeFileSync(join(GAME, "core", "build.js"), out);
console.log("已生成 core/build.js: " + id + " " + hash);
