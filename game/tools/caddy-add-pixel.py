#!/usr/bin/env python3
"""在阿里云跳板机的 Caddyfile 里插入 /pixel/ 反代（指向 dev:8123）。

安全措施：
  1. 先备份（带时间戳）
  2. 幂等：已经有 /pixel/ 配置就跳过
  3. 写入后跑 caddy validate，不通过就自动回滚
  4. 只 reload，不 restart
"""
import re
import shutil
import subprocess
import sys
import time

CF = "/etc/caddy/Caddyfile"
UPSTREAM = "http://180.76.180.249:8123"

BLOCK = """
\t# ===== Pixel 像素闯关 demo（dev 180.76.180.249:8123，公开子路径 /pixel/） =====
\t# 静态站：index.html 用相对路径引 main.js，main.js 再引 ../pixelfx/src/...
\t# handle_path 去掉 /pixel 前缀后，路径正好对上 upstream 的目录结构。
\tredir /pixel /pixel/game/index.html 308
\thandle_path /pixel/* {
\t\treverse_proxy %s
\t}
""" % UPSTREAM

src = open(CF, encoding="utf-8", errors="replace").read()

if "/pixel/*" in src:
    print("已经存在 /pixel/ 配置，跳过")
    sys.exit(0)

# 插入点：wkeeli.cn 块内、兜底 reverse_proxy localhost:5000 之前
anchor = "\treverse_proxy localhost:5000"
if anchor not in src:
    print("错误：找不到插入点（reverse_proxy localhost:5000）")
    sys.exit(1)

backup = CF + ".bak-pixel-" + time.strftime("%Y%m%d-%H%M%S")
shutil.copy2(CF, backup)
print("已备份 ->", backup)

new = src.replace(anchor, BLOCK.rstrip("\n") + "\n\n" + anchor, 1)
open(CF, "w", encoding="utf-8").write(new)
print("已写入新配置")

# 校验
r = subprocess.run(["caddy", "validate", "--config", CF, "--adapter", "caddyfile"],
                   capture_output=True, text=True)
if r.returncode != 0:
    print("校验失败，回滚")
    print(r.stdout)
    print(r.stderr)
    shutil.copy2(backup, CF)
    sys.exit(1)
print("校验通过:", (r.stdout or r.stderr).strip()[:200])

# reload
r = subprocess.run(["systemctl", "reload", "caddy"], capture_output=True, text=True)
if r.returncode != 0:
    print("reload 失败:", r.stderr)
    shutil.copy2(backup, CF)
    subprocess.run(["systemctl", "reload", "caddy"])
    sys.exit(1)
print("caddy 已 reload")
time.sleep(2)
print("caddy 状态:", subprocess.run(["systemctl", "is-active", "caddy"],
                                    capture_output=True, text=True).stdout.strip())
