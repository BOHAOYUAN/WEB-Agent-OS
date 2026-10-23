/**
 * End-to-end check for the artifact sandbox.
 *
 * Unit tests prove the srcdoc is well-formed; they do not prove anything
 * actually runs inside it. Two real-Chrome mechanisms are used:
 *
 *  1. `--dump-dom` for the React probe: renders the artifact, snapshots the
 *     DOM after a virtual-time budget, and we assert on the result.
 *  2. CDP (Chrome DevTools Protocol over the local debugging socket) for the
 *     animation probe. `--dump-dom` cannot verify animation: virtual time
 *     does not produce animation frames, so requestAnimationFrame fires at
 *     most once before the snapshot. CDP drives a LIVE page, where rAF runs
 *     at real frame rate — the only honest way to verify "编程动画呈现".
 *
 * Usage: npx vite-node scripts/verify-artifact-runtime.ts
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderArtifactSrcdoc } from "@webos/shared";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const PROBE_CODE = `
function App() {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    let reportStatus = "missing";
    try {
      if (typeof window.webos === "undefined") reportStatus = "no-webos";
      else if (typeof window.webos.report !== "function") reportStatus = "no-report";
      else { window.webos.report("probe-value", "probe-label"); reportStatus = "ok"; }
    } catch (error) {
      reportStatus = "throw:" + (error && error.message ? error.message : String(error));
    }
    const probe = document.createElement("div");
    probe.id = "webos-probe";
    probe.textContent = "mounted=1;report=" + reportStatus;
    document.body.appendChild(probe);
  }, []);
  return React.createElement("button", { id: "counter", onClick: () => setN(n + 1) }, "点击 " + n);
}
`;

/** Code that cannot compile — used to prove the failure path is reachable. */
const BROKEN_CODE = "function App() { return <div>unclosed; }";

/**
 * Canvas animation probe, as a plain html artifact (the primary
 * "编程动画呈现" path — no React needed). The page runs its own rAF loop
 * and publishes the result on `window.__animResult`; the CDP evaluator
 * waits for it. A watchdog makes a broken rAF fail the check instead of
 * hanging the verifier.
 */
const CANVAS_ARTIFACT_CODE = `<canvas id="anim" width="120" height="60"></canvas>
<script>
(function () {
  var canvas = document.getElementById("anim");
  var ctx2d = "missing";
  var drawn = 0;
  try {
    var ctx = canvas.getContext("2d");
    if (ctx) {
      ctx2d = "ok";
      ctx.fillStyle = "#e01b24";
      ctx.fillRect(0, 0, 40, 40);
      drawn = 1;
    }
  } catch (error) {
    ctx2d = "throw:" + (error && error.message ? error.message : String(error));
  }
  var frames = 0;
  var dataUrl = "not-run";
  function finish() {
    try {
      dataUrl = canvas.toDataURL().slice(0, 20);
    } catch (error) {
      dataUrl = "throw";
    }
    window.__animResult = { ctx2d: ctx2d, drawn: drawn, frames: frames, dataUrl: dataUrl };
  }
  function tick() {
    frames += 1;
    if (frames < 10) requestAnimationFrame(tick);
    else finish();
  }
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(tick);
  else finish();
  setTimeout(function () {
    if (!window.__animResult) finish();
  }, 4000);
})();
</script>`;

/** Waits (in-page) for the animation probe to publish its result. */
const AWAIT_ANIM = `new Promise((resolve) => {
  const started = Date.now();
  (function poll() {
    if (window.__animResult) resolve(window.__animResult);
    else if (Date.now() - started > 8000) resolve({ error: "timeout" });
    else setTimeout(poll, 50);
  })();
})`;

interface Runtime {
  reactSource: string;
  sucraseSource: string;
}

function renderToDom(code: string, runtime: Runtime, chrome: string): string {
  const plan = renderArtifactSrcdoc(
    { id: "artifact-0", index: 0, language: "jsx", code, kind: "render", runtime: "react" },
    { reactRuntime: runtime },
  );
  if (plan.kind !== "render" || !plan.srcdoc) {
    throw new Error("srcdoc 未生成：" + (plan.reason ?? "unknown"));
  }

  const dir = mkdtempSync(join(tmpdir(), "webos-artifact-e2e-"));
  try {
    const htmlPath = join(dir, "artifact.html");
    writeFileSync(htmlPath, plan.srcdoc, "utf8");
    return execFileSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-extensions",
        "--virtual-time-budget=5000",
        "--dump-dom",
        pathToFileURL(htmlPath).href,
      ],
      { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface AnimResult {
  ctx2d?: string;
  drawn?: number;
  frames?: number;
  dataUrl?: string;
  error?: string;
}

/**
 * Render an artifact and evaluate an expression in the LIVE page via CDP.
 *
 * Why not --dump-dom: virtual time does not produce animation frames, so an
 * rAF loop cannot be observed in a DOM snapshot. This launches headless Chrome
 * with a debugging socket, drives the real page, and resolves with the value
 * of `expression` (awaited if it returns a promise). Zero dependencies —
 * Node 22 ships global fetch + WebSocket.
 */
async function evaluateInLivePage(
  code: string,
  language: string,
  runtime: Runtime,
  expression: string,
): Promise<AnimResult> {
  const plan = renderArtifactSrcdoc(
    { id: "artifact-0", index: 0, language, code, kind: "render", runtime: "html" },
    { reactRuntime: runtime },
  );
  if (plan.kind !== "render" || !plan.srcdoc) {
    throw new Error("srcdoc 未生成：" + (plan.reason ?? "unknown"));
  }

  const dir = mkdtempSync(join(tmpdir(), "webos-artifact-cdp-"));
  const htmlPath = join(dir, "artifact.html");
  writeFileSync(htmlPath, plan.srcdoc, "utf8");

  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-extensions",
      "--mute-audio",
      `--user-data-dir=${dir}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    // Chrome writes the chosen port to DevToolsActivePort once the socket is up.
    const portFile = join(dir, "DevToolsActivePort");
    let port = 0;
    for (let attempt = 0; attempt < 100 && port === 0; attempt += 1) {
      try {
        const first = readFileSync(portFile, "utf8").split("\n")[0]?.trim();
        if (first) port = Number(first);
      } catch {
        // not written yet
      }
      if (port === 0) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (port === 0) throw new Error("DevTools 端口未就绪");

    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
      type: string;
      webSocketDebuggerUrl: string;
    }>;
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("找不到 page target");

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("DevTools WebSocket 连接失败")), { once: true });
    });

    let nextId = 0;
    const pending = new Map<number, (value: unknown) => void>();
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
      if (message.id !== undefined) {
        const settle = pending.get(message.id);
        if (settle) {
          pending.delete(message.id);
          settle(message.result);
        }
      }
    });
    const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
      new Promise((resolve) => {
        nextId += 1;
        pending.set(nextId, resolve);
        socket.send(JSON.stringify({ id: nextId, method, params }));
      });

    await send("Page.enable");
    await send("Page.navigate", { url: pathToFileURL(htmlPath).href });
    // Give the artifact's inline scripts time to mount before evaluating.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const result = (await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: AnimResult } };
    socket.close();
    return result?.result?.value ?? { error: "empty-result" };
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const runtime: Runtime = {
    // The standalone IIFE bundles live outside `dist/` on purpose: dist/ is the
    // extension package and nothing in it loads these files.
    reactSource: readFileSync(join(root, ".tmp-runtime", "artifact-runtime.js"), "utf8"),
    sucraseSource: readFileSync(join(root, ".tmp-runtime", "artifact-sucrase.js"), "utf8"),
  };

  const samplePlan = renderArtifactSrcdoc(
    { id: "artifact-0", index: 0, language: "jsx", code: PROBE_CODE, kind: "render", runtime: "react" },
    { reactRuntime: runtime },
  );

  let dom = "";
  try {
    dom = renderToDom(PROBE_CODE, runtime, CHROME);
  } catch (error) {
    console.error("FAIL — headless Chrome 执行失败：" + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
    return;
  }

  const checks: { name: string; ok: boolean; detail: string }[] = [
    {
      name: "React 挂载成功",
      ok: dom.includes('id="counter"') && dom.includes("点击 0"),
      detail: dom.includes("点击 0") ? "按钮渲染为「点击 0」" : "未找到按钮文本",
    },
    {
      name: "hooks 生效（useEffect 执行）",
      ok: dom.includes("mounted=1"),
      detail: dom.includes("mounted=1") ? "probe 元素已写入" : "probe 未出现",
    },
    {
      name: "webos.report harness 可调用",
      ok: dom.includes("report=ok"),
      detail: (dom.match(/report=([a-z-:]+)/)?.[1] ?? "未探测到").replace("report=", ""),
    },
  ];

  // Failure path: broken code must surface a readable message inside the
  // sandbox rather than a blank frame. Match ">渲染失败" — the rendered text
  // node — because the same words also appear in the bootstrap's own source,
  // which --dump-dom echoes back.
  let brokenDom = "";
  try {
    brokenDom = renderToDom(BROKEN_CODE, runtime, CHROME);
  } catch (error) {
    brokenDom = "执行失败：" + (error instanceof Error ? error.message : String(error));
  }
  checks.push({
    name: "错误代码展示可读提示（而非空白）",
    ok: brokenDom.includes(">渲染失败"),
    detail: brokenDom.includes(">渲染失败") ? "错误提示已渲染" : "未出现错误提示",
  });

  // Canvas animation scenario, driven through CDP on a live page (the only
  // way to observe a real requestAnimationFrame loop — see file header).
  let anim: AnimResult;
  try {
    anim = await evaluateInLivePage(CANVAS_ARTIFACT_CODE, "html", runtime, AWAIT_ANIM);
  } catch (error) {
    anim = { error: error instanceof Error ? error.message : String(error) };
  }
  const frameCount = anim.frames ?? 0;
  checks.push(
    {
      name: "Canvas 2D context 可获取",
      ok: anim.ctx2d === "ok",
      detail: anim.ctx2d ?? anim.error ?? "未探测到",
    },
    {
      name: "Canvas 可绘制",
      ok: anim.drawn === 1,
      detail: anim.drawn === 1 ? "fillRect 已执行" : "绘制未发生",
    },
    {
      name: "requestAnimationFrame 循环推进（帧数 > 1）",
      ok: frameCount > 1,
      detail: `frames=${frameCount}`,
    },
    {
      name: "toDataURL 可用",
      ok: typeof anim.dataUrl === "string" && anim.dataUrl.startsWith("data:image"),
      detail: anim.dataUrl ?? "未探测到",
    },
  );

  console.log(`srcdoc 体积：${((samplePlan.srcdoc?.length ?? 0) / 1024).toFixed(0)} kb（含内联 React + Sucrase）\n`);
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name} — ${check.detail}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
  if (failed.length > 0) {
    console.log("\n--- 诊断 ---");
    console.log("动画探针结果：" + JSON.stringify(anim));
    console.log("DOM 末尾片段：");
    console.log(dom.slice(-1500));
  }
  process.exitCode = failed.length === 0 ? 0 : 1;
}

await main();
