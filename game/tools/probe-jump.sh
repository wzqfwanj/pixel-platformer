#!/bin/sh
# 探查阿里云跳板机：能不能到 dev、有没有 nginx、域名怎么配的
echo "=== OS ==="
. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
echo
echo "=== Web 服务 ==="
for svc in nginx caddy apache2; do
  command -v $svc >/dev/null 2>&1 && echo "$svc: $(command -v $svc) 状态:$(systemctl is-active $svc 2>/dev/null)"
done
echo
echo "=== 端口 ==="
ss -lntp 2>/dev/null | grep -E ':(80|443|8080|8123) ' || echo "80/443 无监听"
echo
echo "=== 到 dev 的连通性 ==="
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/180.76.180.249/22' && echo "dev:22 通" || echo "dev:22 不通"
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/180.76.180.249/8123' && echo "dev:8123 通" || echo "dev:8123 不通"
echo
echo "=== nginx 站点配置 ==="
ls /etc/nginx/conf.d/ 2>/dev/null; ls /etc/nginx/sites-enabled/ 2>/dev/null
echo
echo "=== 已有反代配置里的 server_name ==="
grep -rh "server_name" /etc/nginx/ 2>/dev/null | head -10
