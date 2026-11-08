#!/bin/sh
# 找一个空闲端口
echo "=== 80 / 8080 / 8090 / 9000 / 3000 是否被占 ==="
for p in 80 8080 8090 9000 3000 8888 8181 8123; do
  if (ss -lnt 2>/dev/null | awk '{print $4}' | grep -qE ":$p\$"); then
    echo "$p 被占用"
  else
    echo "$p 空闲"
  fi
done
echo
echo "=== 谁占了 443 / 80 ==="
ss -lntp 2>/dev/null | grep -E ':(443|80) ' || echo "80/443 无监听"
echo
echo "=== docker 容器 ==="
docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null | head -15
echo
echo "=== 域名解析检查 ==="
getent hosts wkeeli.cn 2>/dev/null || echo "wkeeli.cn 无解析"
curl -s -m 6 ifconfig.me 2>/dev/null && echo " <- 出口 IP"
