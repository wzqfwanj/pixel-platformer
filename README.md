# second run / 说明

## 这套东西是什么

一套横板像素闯关 demo，战士职业，一关。前端纯 HTML/CSS/JS 零依赖，
渲染是手写的软件光栅化（Uint32 颜色缓冲 + 叠加光照缓冲），后两端 Python 标准库。

## 在线玩

https://wkeeli.cn/pixel/game/index.html

## 本地跑

```bash
python game/server.py            # 默认 0.0.0.0:8123
# 打开 http://127.0.0.1:8123/game/index.html
```

## 依赖 pixelfx

特效来自 [patch-gg/pixelfx](https://github.com/patch-gg/pixelfx)（MIT）。
仓库里没有包含它，先拉下来放在同级目录：

```bash
git clone --depth 1 https://github.com/patch-gg/pixelfx.git pixelfx
```

## 操作

| 键 | 作用 |
| --- | --- |
| A / D、← → | 移动 |
| 空格 / W / ↑ | 跳（按住跳得高） |
| J / X | 攻击（三段连招，第三下暴击） |
| K / C | 按住蓄力，松手重砸 |
| Shift / L | 冲刺 |
| T | 切换明暗主题 |
| R | 重开 |
| F1 | 调试信息 |

## 自测

```bash
node game/tools/test.mjs          # 21 项逻辑与画面检查
node game/tools/jitterpix.mjs     # 像素级抖动检查
node game/tools/themecheck.mjs    # 明暗主题验证
node game/tools/bench.mjs         # 性能基准
```

## 更多

见 `game/README.md`（实现细节）和 `game/DEPLOY.md`（部署拓扑与流程）。

## 致谢

- 特效库：[patch-gg/pixelfx](https://github.com/patch-gg/pixelfx) by Patch，MIT
- 方法来源：Hugo Duprez《How to make (good) pixel art effects with Claude》
- 像素字体：pixelfx 自带的 3x5 / 5x7 字体
