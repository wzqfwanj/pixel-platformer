// 主题：明暗两套，黑白色调（规范要求）。
// 只影响页面外壳和 HUD，游戏里的像素画保持原色 —— 黑白化整张画面会把美术细节盖掉，
// 需要的话在 main.js 的 render() 末尾加一道去色即可。

const THEMES = {
  light: {
    name: "light",
    page: "#f2f2f2",
    pageText: "#1a1a1a",
    frame: "#cccccc",
    canvasBg: "#e8e8e8",
    hud: {
      panel: "#ffffff",
      ink: "#111111",
      text: "#111111",
      dim: "#7a7a7a",
      bar: "#111111",
      barHi: "#4a4a4a",
      barBack: "#d6d6d6",
      barEdge: "#111111",
      accent: "#111111",
      accentDim: "#8a8a8a",
    },
  },
  dark: {
    name: "dark",
    page: "#0a0a0a",
    pageText: "#e6e6e6",
    frame: "#2e2e2e",
    canvasBg: "#111111",
    hud: {
      panel: "#101010",
      ink: "#000000",
      text: "#ededed",
      dim: "#8a8a8a",
      bar: "#ededed",
      barHi: "#ffffff",
      barBack: "#333333",
      barEdge: "#000000",
      accent: "#ffffff",
      accentDim: "#9a9a9a",
    },
  },
};

export const themeNames = Object.keys(THEMES);

let current = "dark";

export function getTheme() {
  return THEMES[current];
}

export function setTheme(name) {
  if (THEMES[name]) current = name;
  return THEMES[current];
}

export function toggleTheme() {
  current = current === "dark" ? "light" : "dark";
  return THEMES[current];
}

/** 把主题刷到页面外壳上（CSS 变量 + body 的 class） */
export function applyThemeToPage(theme) {
  if (typeof document === "undefined") return;
  const s = document.documentElement.style;
  s.setProperty("--page", theme.page);
  s.setProperty("--page-text", theme.pageText);
  s.setProperty("--frame", theme.frame);
  s.setProperty("--canvas-bg", theme.canvasBg);
  document.body.dataset.theme = theme.name;
  const btn = document.getElementById("theme");
  if (btn) btn.textContent = theme.name === "dark" ? "☀ 亮色" : "☾ 暗色";
}
