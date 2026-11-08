# 部署与运维脚本说明

这些脚本用于把这套 demo 部署到开发主机，并验证线上可访问。

## 拓扑

```
本地 --(key)--> aliyun 8.133.209.25（跳板机，Caddy 占 80/443，wkeeli.cn 解析到这里）
                        --(TCP 转发)--> dev 180.76.180.249（百度云，跑游戏服务）

公网访问：https://wkeeli.cn/pixel/game/index.html
         Caddy 把 /pixel/* 反代到 http://180.76.180.249:8123
```

dev 机的 8123 端口没有对公网开放（百度云安全组只放行了 22 等），
所以走跳板机上的 Caddy 做反代，这样还顺带拿到了 HTTPS 证书。

## 脚本

| 脚本 | 用途 |
| --- | --- |
| `probe-host.sh` | 探查 dev：OS、Python、端口、防火墙、磁盘 |
| `probe-ports.sh` | 探查 dev 上哪些端口被占、域名解析、出口 IP |
| `probe-jump.sh` | 探查跳板机：Web 服务、到 dev 的连通性 |
| `probe-caddy.sh` | 读跳板机的 Caddyfile 与备份 |
| `deploy-prep.sh` | 在 dev 上建 /opt/pixel-demo 目录 |
| `deploy-service.sh` | 装 systemd 服务 `pixel-demo.service` 并启动 |
| `caddy-add-pixel.py` | 在跳板机 Caddyfile 里插入 /pixel/ 反代（带备份、校验、失败回滚） |
| `verify-live.mjs` | 用无头浏览器验证公网地址：抓画布、查报错、比对明暗主题 |

## 部署流程

```bash
# 1. 本地打包（不包含生成物和上游依赖的 .git）
tar -czf deploy.tgz --exclude='*.png' --exclude='preview.json' \
    --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
    --exclude='records' --exclude='.*-profile*' game pixelfx/src

# 2. 上传并解包
scp deploy.tgz dev:/tmp/deploy.tgz
ssh dev "cd /opt/pixel-demo && tar -xzf /tmp/deploy.tgz && systemctl restart pixel-demo"

# 3. 首次部署才需要（装 systemd 服务 / 配 Caddy 反代）
ssh dev bash -s < game/tools/deploy-service.sh
scp game/tools/caddy-add-pixel.py aliyun:/tmp/ && ssh aliyun "python3 /tmp/caddy-add-pixel.py"

# 4. 验证
node game/tools/verify-live.mjs
```

## 回滚

```bash
# 服务
ssh dev "systemctl stop pixel-demo"          # 停服务
ssh dev "ls /etc/systemd/system/pixel-demo.service"  # 卸服务就删这个再 daemon-reload

# Caddy 反代：脚本每次改之前都会备份到 /etc/caddy/Caddyfile.bak-pixel-<时间戳>
ssh aliyun "cp /etc/caddy/Caddyfile.bak-pixel-xxxx /etc/caddy/Caddyfile && caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy"
```

## 已知情况

- wkeeli.cn 解析到 8.133.209.25（跳板机），不是 dev 机。所以域名入口是跳板机。
- 跳板机 Caddyfile 里还有十几个其他服务的反代，`caddy-add-pixel.py` 只插入一段，
  改动前备份、改动后 `caddy validate` 校验，校验不通过自动还原。
- 8123 端口本身对公网不可达，这是预期的：只通过 Caddy 反代暴露。
