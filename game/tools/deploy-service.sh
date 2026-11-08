#!/bin/sh
# 安装 systemd 服务，让 demo 常驻运行（规范：在线可访问、无密码）
set -e

PORT=8123
cat > /etc/systemd/system/pixel-demo.service <<'EOF'
[Unit]
Description=pixel platformer demo (static, python stdlib)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/pixel-demo/game
ExecStart=/usr/bin/python3 /opt/pixel-demo/game/server.py 8123 0.0.0.0
Restart=always
RestartSec=2
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now pixel-demo.service
sleep 2
echo "=== 服务状态 ==="
systemctl is-active pixel-demo.service
echo
echo "=== 端口 ==="
ss -lntp | grep ":${PORT} " || echo "端口未监听"
echo
echo "=== 本机自测 ==="
curl -s -o /dev/null -w "index.html -> HTTP %{http_code}\n" http://127.0.0.1:${PORT}/game/index.html
curl -s -o /dev/null -w "main.js    -> HTTP %{http_code}\n" http://127.0.0.1:${PORT}/game/main.js
curl -s -o /dev/null -w "pixelfx fx -> HTTP %{http_code}\n" http://127.0.0.1:${PORT}/pixelfx/src/core/fx.js
