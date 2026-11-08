// 启动菜单测试：进入游戏前必须能选模式。
//
// 用法: node game/tools/menu.mjs

import { Surface } from "../core/screen.js";
import { hex } from "../core/util.js";
import { StartMenu } from "../ui/startmenu.js";
import { setTheme } from "../core/theme.js";

let fails = 0;
const ok = (c, l, e) => {
  console.log((c ? "  ok   " : "  FAIL ") + l + (e ? "  " + e : ""));
  if (!c) fails++;
};

const DT = 1 / 60;

function makeInput() {
  return {
    down: new Set(), just: new Set(), rel: new Set(),
    held(a) { return this.down.has(a); },
    pressed(a) { return this.just.has(a); },
    letGo(a) { return this.rel.has(a); },
    axis() { return (this.down.has("right") ? 1 : 0) - (this.down.has("left") ? 1 : 0); },
    press(a) { this.down.add(a); this.just.add(a); },
    release(a) { this.down.delete(a); this.rel.add(a); },
    endFrame() { this.just.clear(); this.rel.clear(); },
  };
}

// ---------------------------------------------------------------- 1. 默认选项
console.log("\n[1] 菜单默认状态");
{
  const m = new StartMenu();
  ok(m.selected === "level", "默认选中第一项（关卡模式）", m.selected);
  ok(m.index === 0, "索引从 0 开始", String(m.index));
}

// ---------------------------------------------------------------- 2. 方向切换
console.log("\n[2] A/D 与方向键切换");
{
  const m = new StartMenu();
  const input = makeInput();

  input.press("right");
  m.update(DT, input);
  input.endFrame();
  ok(m.selected === "endless", "按右切到无尽模式", m.selected);

  input.press("right");
  m.update(DT, input);
  input.endFrame();
  ok(m.selected === "level", "再按右回到关卡模式（循环）", m.selected);

  input.press("left");
  m.update(DT, input);
  input.endFrame();
  ok(m.selected === "endless", "按左也能循环", m.selected);
}

// ---------------------------------------------------------------- 3. 确认
console.log("\n[3] 空格 / 回车确认");
{
  const keys = ["jump", "confirm"];
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const m = new StartMenu();
    const input = makeInput();
    input.press(key);
    const picked = m.update(DT, input);
    input.endFrame();
    ok(picked === "level", key + " 确认返回关卡模式", String(picked));
  }

  const m = new StartMenu();
  const input = makeInput();
  input.press("right");
  m.update(DT, input);
  input.endFrame();
  input.press("confirm");
  const picked = m.update(DT, input);
  ok(picked === "endless", "切到无尽后确认返回 endless", String(picked));
}

// ---------------------------------------------------------------- 4. 数字键直选
console.log("\n[4] 数字键 1 / 2 直选");
{
  const m = new StartMenu();
  const input = makeInput();
  input.press("menu2");
  const picked = m.update(DT, input);
  input.endFrame();
  ok(picked === "endless", "按 2 直接进无尽模式", String(picked));

  const m2 = new StartMenu();
  const in2 = makeInput();
  in2.press("menu1");
  const p2 = m2.update(DT, in2);
  ok(p2 === "level", "按 1 直接进关卡模式", String(p2));
}

// ---------------------------------------------------------------- 5. 渲染
console.log("\n[5] 菜单渲染");
{
  const themes = ["dark", "light"];
  for (let k = 0; k < themes.length; k++) {
    const theme = themes[k];
    setTheme(theme);
    const bg = hex(theme === "dark" ? "#0b0812" : "#e8e8e8");
    const s = new Surface(320, 180);
    s.clear(bg);
    const m = new StartMenu();
    let err = null;
    try { m.draw(s); } catch (e) { err = e; }
    ok(!err, theme + " 主题下渲染不报错", err ? err.message : "");

    let n = 0;
    const uniq = new Set();
    for (let i = 0; i < s.color.length; i++) {
      if (s.color[i] !== bg) n++;
      if (uniq.size < 2000) uniq.add(s.color[i]);
    }
    ok(n > 3000, theme + " 主题下画面有内容", n + " px");
    ok(uniq.size > 5, theme + " 主题下有多层颜色", uniq.size + " 种");
  }
}

console.log(fails === 0 ? "\n启动菜单检查全部通过" : "\n有 " + fails + " 项失败");
process.exit(fails === 0 ? 0 : 1);
