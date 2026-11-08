#!/usr/bin/env python3
"""极简静态服务器（只用 Python 标准库，无第三方依赖）。

规范要求后端用 Python，这个文件就是唯一的后端：负责把工作区里的静态文件发出去，
另外收下无头浏览器回传的截图和元信息（开发时验证画面用）。

用法:
    python game/server.py [端口]        # 默认 8123
    python game/server.py 9000

然后打开 http://127.0.0.1:8123/game/index.html
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# 工作区根目录：game/ 的上一级。这样 /game/ 和 /pixelfx/ 都能互相 import。
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(ROOT, "game")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "pixelfx-demo/1.0"

    # ---------- 工具 ----------
    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        return self.rfile.read(length) if length else b""

    # ---------- GET：静态文件 ----------
    def do_GET(self):
        url = self.path.split("?")[0]
        if url == "/":
            url = "/game/index.html"
        if url.endswith("/"):
            url += "index.html"

        rel = url.lstrip("/").replace("\\", "/")
        path = os.path.normpath(os.path.join(ROOT, rel))
        # 防路径穿越
        if not path.startswith(ROOT):
            self._send(403, "forbidden")
            return
        if not os.path.isfile(path):
            self._send(404, "not found: " + url)
            return

        ext = os.path.splitext(path)[1].lower()
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError as e:
            self._send(500, "read error: %s" % e)
            return
        self._send(200, data, MIME.get(ext, "application/octet-stream"))

    do_HEAD = do_GET

    # ---------- POST：开发工具用的两个回传接口 ----------
    def do_POST(self):
        url = self.path.split("?")[0]
        body = self._read_body()

        if url.startswith("/__shot"):
            data = body.decode("utf-8", "replace")
            b64 = data.split(",", 1)[1] if "," in data else data
            try:
                import base64
                out = os.path.join(GAME, "preview.png")
                with open(out, "wb") as f:
                    f.write(base64.b64decode(b64))
                self._send(200, "ok " + out)
            except Exception as e:  # noqa: BLE001
                self._send(500, "save png failed: %s" % e)
            return

        if url.startswith("/__meta"):
            try:
                json.loads(body.decode("utf-8"))
                out = os.path.join(GAME, "preview.json")
                with open(out, "wb") as f:
                    f.write(body)
                self._send(200, "ok meta")
            except Exception as e:  # noqa: BLE001
                self._send(400, "bad json: %s" % e)
            return

        self._send(404, "no such endpoint: " + url)

    # 只打印出错，避免刷屏
    def log_message(self, fmt, *args):
        pass


def main():
    # 用法: python game/server.py [端口] [监听地址]
    # 默认 0.0.0.0，这样局域网/公网能直接访问（规范要求在线可访问、无密码）。
    # 想只在本机用就传 127.0.0.1。
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    host = sys.argv[2] if len(sys.argv) > 2 else "0.0.0.0"
    httpd = ThreadingHTTPServer((host, port), Handler)
    shown = "127.0.0.1" if host == "0.0.0.0" else host
    print("本机: http://%s:%d/game/index.html" % (shown, port))
    if host == "0.0.0.0":
        import socket
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            print("局域网: http://%s:%d/game/index.html" % (s.getsockname()[0], port))
            s.close()
        except OSError:
            pass
    print("Ctrl+C 停止")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
