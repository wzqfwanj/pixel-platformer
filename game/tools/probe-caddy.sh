#!/bin/sh
echo "=== Caddyfile 位置 ==="
caddy environ 2>/dev/null | head -3
ls -la /etc/caddy/ 2>/dev/null
echo
echo "=== Caddyfile 内容 ==="
cat /etc/caddy/Caddyfile 2>/dev/null
echo
echo "=== 其它 caddy 配置片段 ==="
ls -la /etc/caddy/conf.d/ 2>/dev/null && cat /etc/caddy/conf.d/* 2>/dev/null
echo
echo "=== caddy 版本 ==="
caddy version
