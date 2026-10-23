import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4318);

const NORMAL_FRAMES = [
  { v: { response: { fragments: [{ type: "THINK", content: "思考：先读取问题。" }] } } },
  { p: "response/fragments", o: "APPEND", v: [{ type: "RESPONSE", content: "你好" }] },
  { p: "response/fragments/1/content", o: "APPEND", v: "，世界" },
  { v: "！" },
  { v: "这是 Web-OS-Agent 的本地 SSE demo。" },
  { p: "response/status", v: "FINISHED" },
];

const TRUNCATED_FRAMES = NORMAL_FRAMES.slice(0, 4);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function serveFile(res, fileName) {
  const content = await readFile(join(here, fileName), "utf8");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(content);
}

async function streamCompletion(req, res) {
  req.resume();
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const truncated = url.searchParams.get("case") === "truncated";
  const frames = truncated ? TRUNCATED_FRAMES : NORMAL_FRAMES;

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders?.();

  for (const frame of frames) {
    if (res.destroyed || res.writableEnded) return;
    res.write("data: " + JSON.stringify(frame) + "\n\n");
    await sleep(45);
  }
  if (!truncated) res.write("data: [DONE]\n\n");
  res.end();
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/") {
        await serveFile(res, "index.html");
        return;
      }
      // PageAct 测试台：每种危险判定都有对应元素，点击后写日志。
      if (req.method === "GET" && url.pathname === "/pageact") {
        await serveFile(res, "pageact-fixture.html");
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/v0/chat/completion") {
        await streamCompletion(req, res);
        return;
      }
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(String(error));
    }
  })();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Web-OS-Agent demo: http://localhost:" + PORT);
  console.log("Open the demo page, load the dev extension, then click XHR / fetch.");
});
