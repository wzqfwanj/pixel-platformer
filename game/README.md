# 横板像素闯关 demo —— 战士

纯前端、零依赖。渲染全是手写的软件光栅化（一块 Uint32 颜色缓冲 + 一块叠加光照缓冲），
美术全部由代码画出，没有任何图片资源。特效来自 `../pixelfx`（同一工作区里的 pixelfx 库）。

## 跑起来

```
python game/server.py
# 然后打开 http://127.0.0.1:8123/game/index.html
```

必须用 http 打开（ES module 不能走 file://）。服务器根目录是工作区根，所以
`game/` 能直接 import `../pixelfx/src/...`。

## 操作

| 键 | 作用 |
| --- | --- |
| A / D 或 ← → | 移动 |
| 空格 / W / ↑ | 跳（按住跳得高，松手就落下，有土狼时间和输入缓冲）|
| J / X | 攻击（三段连招：横斩 → 回斩 → 重劈，第三下暴击）|
| K / C | 按住蓄力，松手重砸（地面范围伤害，蓄满范围和伤害都涨）|
| Shift / L | 冲刺（有点无敌帧的意思，用来穿身位）|
| R | 重开 |
| F1 | 调试信息 |

## 战士这个职业做了什么

- 移动：加速度 + 摩擦，空中控制力比地面弱；可变跳跃高度；0.09 秒土狼时间；0.12 秒跳跃输入缓冲。
- 三段连招：`CFG.combo` 里三段的 前摇/判定/后摇/伤害/攻击范围/特效/震屏 都是数据，
  加职业时照抄这段改数就行。每段在 active 阶段才判定，命中后立刻进 `hitLag`（0.045 秒定格），
  这是打击感的主要来源。
- 蓄力重砸：按住 K 出 `lightning/charge-up` 特效并蓄力，松手在地面砸出
  `impacts/ground-slam` + `explosions/dirt-explosion`，按 42 像素半径结算范围伤害；
  空中按 K 会变成下坠砸地。
- 受伤：0.85 秒无敌、击退、闪白、震屏；血空后倒地 1.1 秒再回到最近的安全点。
- 掉坑：扣 15 血并回到最后站稳的位置（安全点每 0.25 秒记录一次）。

## 关卡

`data/level1.js` 是 208x22 格的 ASCII 地图，由 `tools/genmap.mjs` 生成（也可以手改）。

```
#  实体土石     =  浮空石台     ^  尖刺
T  火把       C  金币         D  木桩靶
E  史莱姆     S  出生点       X  出口
```

生成器带可玩性检查：坑宽不超过 3 格、台阶不超过 2 格、出生点和出口不在坑上、
尖刺必须落在凹地里。不通过会直接报出来。

当前这关的内容：11 个火把、14 枚金币、9 个木桩靶、4 只史莱姆、10 个尖刺、9 块浮台。

## 特效怎么接进来的

`fx/fxlayer.js` 是唯一和 pixelfx 打交道的文件：

- 显式列了一张 `LOADERS` 表（`"melee/sword-slash": () => import(...)`），
  只加载用到的 21 个特效，不是整个库。
- 每个特效有自己的 frame（尺寸取特效的 `meta.size`，原点取 `meta.origin`），
  画完把颜色按 alpha 混进场景、把 light 累加进光照缓冲，所以火把、刀光会真的照亮周围。
- 屏幕外的特效不更新（`fx.update` 里做了视野剔除），常驻特效（火把）离开视野时保持不动。
- 战士用一套自定义暖橙调色板 `WARRIOR_PALETTE`，默认刀光是冷蓝的，换成橙金配红战袍。

## 相机与抖动

移动时的"抖"有两层原因，都修了：

1. 相机用 `lerp(cam, target, dt*7)` 再 `Math.round`。lerp 每帧推进的比例是小数，
   取整后相机每帧走 0/1/2/3 像素不等，匀速跑动时整个场景的滚动节奏就不匀。
   现在（`world/camera.js`）相机以角色的**整数**位置为准，带 22 像素水平死区，
   死区内完全不动、出死区后 1:1 跟上，相机坐标始终是整数。
2. 角色绘制和相机各自 `Math.round`，两者的舍入相位不同，就会出现相对 ±1 的来回。
   现在角色和相机用的是同一个 `Math.round(cx)`，所以角色在屏幕上（死区内）纹丝不动，
   滚动全部交给相机。

验证方法不是眼看，是逐帧量：

```
node game/tools/jitterpix.mjs    # 像素级：把角色画出来找包围盒，检查每帧位移
node game/tools/test.mjs         # 第 10 项固化了同样的检查，防回归
```

跑动 169 帧的结果：精灵包围盒上沿恒为 14、高度恒为 28、水平位置反向 0 次。

## 规范对照

按 `开发规则` 里的三条要求逐项落实：

| 要求 | 落实方式 |
| --- | --- |
| 只实现最小功能 | 只做"能玩通一关的战士"：移动/跳跃/三段连招/蓄力重砸/冲刺，两种敌人，一关。没有商店、技能树、存档、音频 |
| 主题：明暗切换、黑白色调 | `core/theme.js` 定义两套主题，HUD 与页面外壳全部走主题色，没有彩色。T 键或右上角按钮切换，选择存 localStorage，首次跟随系统 |
| 前端：HTML/CSS/JS，极简风格 | 单页 `index.html`，样式内联、无框架无依赖；JS 按 core/world/entities/fx/ui 分目录，纯 ES module |
| 后端：Python | `server.py`，只用标准库（http.server），负责静态文件 + 开发用的截图/元信息回传 |
| 使用 Git 版本管理 | 仓库已初始化，`.gitignore` 排除生成物与上游依赖 pixelfx |

还没做、需要先确认的（规则里明确要求"请先确认"）：

- 在线部署：是否给访问加账号密码？
- 上传 GitHub 并发布：是否开源？

## 目录

```
game/
  index.html          页面壳
  server.py           后端（Python 标准库，静态文件 + 开发用的回传接口）
  core/               util(颜色/数学/随机)、screen(软件画布)、spriteplate(描边贴图)、input、text
  world/              level(解析+碰撞+烘图)、camera(死区跟随+整数化)、tiles、background、pickups
  entities/           warrior(战士逻辑)、warriorArt(战士像素画)、enemy(木桩靶/史莱姆)
  fx/fxlayer.js       pixelfx 接入层
  ui/hud.js           血条、连击、金币、结算
  data/level1.js      地图数据（生成出来的）
  tools/
    genmap.mjs        生成地图 + 可玩性检查
    test.mjs          无浏览器逻辑自测（物理、跳跃、连招、蓄力、掉坑、通关、画面）
    bench.mjs         性能测量（node 里跑同一套 update+render）
    shot.mjs          无头 Chrome 截图 + 画面 ASCII/色相检查
    inspect.mjs       放大看截图局部（按颜色分类成字符）
    sprites.mjs       把角色各种姿势排成 preview-sprites.png
    jitter.mjs        抖动量测（逻辑层，纯 Node）
    jitterpix.mjs     抖动量测（像素层：画出角色量包围盒）
    themecheck.mjs    明暗主题验证（截图 + 取样检查黑白/切换）
```

## 验证

```
node game/tools/test.mjs      # 17 项逻辑与画面检查，全通过才算过
node game/tools/bench.mjs     # 单帧耗时
node game/tools/shot.mjs --frames 205 --script showcase   # 无头截图
```

`test.mjs` 里第 7 项会让一个机器人自动打通全关（29 秒到出口，零死亡），
第 9 项会检查角色真的画在了屏幕坐标上 —— 这条是加出来的，因为曾经忘减相机，
角色被画到屏幕外，而"画面亮度正常"这种检查完全发现不了。

## 已知的简化

- 敌人只有木桩靶（不动，练连招）和史莱姆（会走过来咬）两种，都没有攻击前摇。
- 没有音频。
- 只有一关，通关后按 R 重开；没有存档、没有商店、没有技能树。
- 角色是代码画的简笔像素画（26x26），不像手工绘制的精灵那样精致；
  要换真图的话，`warriorArt.js` 那个 `drawWarrior(s, x, y, facing, pose)` 换成贴图就行。
