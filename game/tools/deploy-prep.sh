#!/bin/sh
# 在开发主机上首次部署：建目录、装 systemd 服务、开端口
set -e

APP=/opt/pixel-demo
PORT=8123

echo "=== 建目录 ==="
mkdir -p "$APP/game" "$APP/pixelfx"
chown -R root:root "$APP"
echo "$APP 就绪"

echo
echo "=== 检查端口 $PORT ==="
if ss -lnt 2>/dev/null | awk '{print $4}' | grep -qE ":${PORT}\$"; then
  echo "警告: $PORT 已被占用"
  ss -lntp 2>/dev/null | grep ":${PORT} "
else
  echo "$PORT 空闲"
fi
