import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 生成构建标记（时间戳 + git 短哈希），显示在页面上。
// 这样能立刻确认浏览器加载的是不是最新代码 —— 排查"改了没生效"最快的办法。
const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = join(HERE, "..");
const ROOT = join(GAME, "..");

let hash = "n/a";
try {
  hash = execSync("git rev-parse --short HEAD", { encoding: "utf8", cwd: ROOT }).trim();
} catch {
  /* 不是 git 仓库就用 n/a */
}
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

const out = `// 构建标记：每次部署前由 tools/gen-build.mjs 生成。
export const BUILD = {
  hash: "${hash}",
  time: "${stamp}",
  label: "${hash} ${stamp}",
};
`;
writeFileSync(join(GAME, "core", "build.js"), out);
console.log("已生成 core/build.js: " + hash + " " + stamp);
