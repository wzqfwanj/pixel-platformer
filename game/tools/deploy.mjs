#!/usr/bin/env node
// 一键部署：node game/tools/deploy.mjs
//
// 做四件事：
//   1. 更新 core/build.js（git 短哈希 + 时间戳），页面上能看到
//   2. 打包（排除生成物和上游依赖）
//   3. scp 到 dev 机 + 解包 + 重启 systemd 服务
//   4. 拉一次线上 core/build.js，确认和本地一致

import { execSync } from "node:child_process";
import { rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = join(HERE, "..");
const ROOT = join(GAME, "..");
const DEV = process.env.PIXELFX_DEV ?? "dev";
const BASE = process.env.PIXELFX_URL ?? "https://wkeeli.cn/pixel/game/";

const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });

console.log("== 1. 更新构建标记 ==");
run("node game/tools/gen-build.mjs");
const build = readFileSync(join(GAME, "core/build.js"), "utf8");
const buildId = (build.match(/id: "([^"]+)"/) || [])[1];
const hash = (build.match(/hash: "([^"]+)"/) || [])[1];
console.log("   build = " + buildId + " (" + hash + ")");

console.log("\n== 2. 打包 ==");
rmSync(join(ROOT, "deploy.tgz"), { force: true });
run(
  'tar -czf deploy.tgz --exclude="*.png" --exclude="preview.json" --exclude=".git" ' +
  '--exclude="node_modules" --exclude="__pycache__" --exclude="records" ' +
  '--exclude=".*-profile*" --exclude="assets" game pixelfx/src'
);

console.log("\n== 3. 上传并重启 ==");
run("scp -o BatchMode=yes deploy.tgz " + DEV + ":/tmp/deploy.tgz");
run(
  "ssh -o BatchMode=yes " + DEV +
  ' "cd /opt/pixel-demo && tar -xzf /tmp/deploy.tgz && systemctl restart pixel-demo && sleep 1 && systemctl is-active pixel-demo"'
);

console.log("\n== 4. 验证线上 build ==");
try {
  const body = execSync('curl.exe -s --noproxy "*" --max-time 20 "' + BASE + 'core/build.js"', { encoding: "utf8" });
  const liveId = (body.match(/id: "([^"]+)"/) || [])[1];
  console.log("   线上 = " + liveId);
  console.log(liveId === buildId ? "   部署已生效（id 一致）" : "   ! 线上 id 不匹配，可能被缓存");
} catch (e) {
  console.log("   拉取失败: " + e.message);
}

rmSync(join(ROOT, "deploy.tgz"), { force: true });
console.log("\n完成。浏览器里看不到变化就硬刷新（Ctrl+Shift+R）。");
