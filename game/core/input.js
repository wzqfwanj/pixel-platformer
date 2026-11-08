// 键盘输入：区分"按住"和"这一帧刚按下"

const MAP = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  jump: ["Space", "KeyW", "ArrowUp"],
  attack: ["KeyJ", "KeyX"],
  heavy: ["KeyK", "KeyC"],
  dash: ["ShiftLeft", "ShiftRight", "KeyL"],
  restart: ["KeyR"],
  theme: ["KeyT"],
  mode: ["KeyM"],
  debug: ["F1", "Backquote"],
};

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.just = new Set();
    this.released = new Set();
    target.addEventListener("keydown", (e) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "F1"].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.just.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener("keyup", (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    target.addEventListener("blur", () => this.down.clear());
  }
  held(action) {
    return MAP[action].some((k) => this.down.has(k));
  }
  pressed(action) {
    return MAP[action].some((k) => this.just.has(k));
  }
  letGo(action) {
    return MAP[action].some((k) => this.released.has(k));
  }
  axis() {
    return (this.held("right") ? 1 : 0) - (this.held("left") ? 1 : 0);
  }
  /** 每帧末尾调用 */
  endFrame() {
    this.just.clear();
    this.released.clear();
  }
}
