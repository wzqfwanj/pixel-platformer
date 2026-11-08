#!/bin/sh
# 探查开发主机的环境：Python、Nginx、防火墙、端口占用
set -e
echo "=== OS ==="
. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
echo
echo "=== Python ==="
which python3 && python3 --version
echo
echo "=== Web 服务 ==="
for svc in nginx caddy apache2 httpd; do
  if command -v $svc >/dev/null 2>&1; then echo "$svc: 已装 ($(command -v $svc))"; fi
done
systemctl is-active nginx 2>/dev/null || echo "nginx 未运行"
echo
echo "=== 端口占用 ==="
(ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null) | head -20
echo
echo "=== 防火墙 ==="
ufw status 2>/dev/null | head -8 || echo "无 ufw"
echo
echo "=== 现有站点目录 ==="
ls -la /var/www 2>/dev/null | head -10 || echo "无 /var/www"
echo
echo "=== 磁盘 ==="
df -h / | tail -1
