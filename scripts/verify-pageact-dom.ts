/**
 * Real-browser check for `dom-environment.ts` — the one page-act file that
 * unit tests cannot cover (no jsdom in this repo).
 *
 * What it proves, in a real Chromium engine:
 *   1. danger classification: download attr / password / submit / destructive
 *      text / harmless, each mapped correctly;
 *   2. the native value setter fires `input` so a React-like controlled field
 *      actually observes the change;
 *   3. `extract` pulls a table into header + body rows;
 *   4. a synthetic click reaches the element's listener;
 *   5. a dangerous click with no confirmation is refused and NOT clicked.
 *
 * Mechanism: esbuild-bundle `@webos/page-act` into an IIFE, load it into a
 * fixture page, drive it with headless Chrome `--dump-dom`, and assert on the
 * emitted result string. No extension, no login, no user browser involved.
 *
 * Usage: npx vite-node scripts/verify-pageact-dom.ts
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

/** The probe, written against the real `document` in the fixture page. */
const PROBE = `
import { classifyDanger, createDomEnvironment, executeActions } from "@webos/page-act";

async function run(): Promise<string> {
  const out: string[] = [];
  const $ = (sel: string): HTMLElement => document.querySelector(sel) as HTMLElement;
  const push = (name: string, ok: boolean, detail: string): void => {
    out.push(name + "=" + (ok ? "ok" : "fail:" + detail));
  };

  push("danger-download", classifyDanger($("#dl")) === "download", String(classifyDanger($("#dl"))));
  push("danger-credential", classifyDanger($("#pw")) === "credential", String(classifyDanger($("#pw"))));
  push("danger-submit", classifyDanger($("#submit-input")) === "submit", String(classifyDanger($("#submit-input"))));
  push("danger-destructive", classifyDanger($("#del")) === "destructive", String(classifyDanger($("#del"))));
  push("danger-none", classifyDanger($("#ok")) === null, String(classifyDanger($("#ok"))));

  const env = createDomEnvironment();

  const input = $("#controlled") as HTMLInputElement;
  let inputEvents = 0;
  input.addEventListener("input", () => { inputEvents += 1; });
  await executeActions([{ kind: "fill", selector: "#controlled", value: "React输入" }], env);
  push("fill-value", input.value === "React输入", input.value);
  push("fill-input-event", inputEvents >= 1, String(inputEvents));

  const extract = await executeActions([{ kind: "extract", selector: "#tbl", as: "table" }], env);
  const data = extract[0]?.data as { header?: string[]; rows?: string[][] } | undefined;
  push("extract-header", data?.header?.join("|") === "订单|金额", data?.header?.join("|") ?? "");
  push("extract-rows", (data?.rows?.length ?? 0) === 1 && data?.rows?.[0]?.join("|") === "A-1|12.00", JSON.stringify(data?.rows));

  let clicks = 0;
  ($("#clickme") as HTMLButtonElement).addEventListener("click", () => { clicks += 1; });
  await executeActions([{ kind: "click", selector: "#clickme" }], env);
  push("click-fired", clicks === 1, String(clicks));

  let dlClicks = 0;
  ($("#dl") as HTMLAnchorElement).addEventListener("click", () => { dlClicks += 1; });
  const refused = await executeActions([{ kind: "click", selector: "#dl" }], env);
  push("danger-refused", refused[0]?.refused === true && dlClicks === 0, "refused=" + refused[0]?.refused + " clicks=" + dlClicks);

  return out.join(";");
}

(globalThis as { __pageactProbe?: () => Promise<string> }).__pageactProbe = run;
`;

async function main(): Promise<void> {
  // 1. Bundle the probe (typed module) into a standalone IIFE.
  const bundle = await build({
    stdin: { contents: PROBE, resolveDir: join(here, ".."), loader: "ts" },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome116"],
    logLevel: "silent",
    alias: { "@webos/page-act": join(root, "packages/page-act/src/index.ts") },
    write: false,
  });
  const probeJs = bundle.outputFiles[0]?.text ?? "";
  if (!probeJs) {
    console.error("FAIL — probe 打包为空");
    process.exitCode = 1;
    return;
  }

  // 2. Fixture page: the dangerous + ordinary elements the probe drives.
  const fixture = `<!doctype html><meta charset="utf-8"><title>pageact-dom-probe</title>
<input id="controlled">
<a id="dl" download href="#">下载</a>
<input id="pw" type="password">
<input id="submit-input" type="submit" value="提交">
<button id="del">删除</button>
<button id="ok">确定</button>
<table id="tbl"><tr><th>订单</th><th>金额</th></tr><tr><td>A-1</td><td>12.00</td></tr></table>
<button id="clickme">点我</button>
<script>${probeJs}</script>
<script>
window.__pageactProbe().then(function (result) {
  var el = document.createElement("div");
  el.id = "probe-result";
  el.textContent = result;
  document.body.appendChild(el);
});
</script>`;

  const dir = mkdtempSync(join(tmpdir(), "webos-pageact-dom-"));
  let dom = "";
  try {
    const htmlPath = join(dir, "fixture.html");
    writeFileSync(htmlPath, fixture, "utf8");
    dom = execFileSync(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-extensions",
        "--virtual-time-budget=3000",
        "--dump-dom",
        pathToFileURL(htmlPath).href,
      ],
      { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    console.error("FAIL — headless Chrome 执行失败：" + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
    return;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const resultLine = dom.match(/id="probe-result"[^>]*>([^<]*)</)?.[1] ?? "";
  if (!resultLine) {
    console.error("FAIL — 未在 DOM 快照中找到 probe-result 元素");
    console.error(dom.slice(-1200));
    process.exitCode = 1;
    return;
  }

  const results = resultLine.split(";");
  console.log(`bundle 体积：${(probeJs.length / 1024).toFixed(0)} kb\n`);
  let failed = 0;
  for (const item of results) {
    const ok = item.endsWith("=ok");
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${item}`);
  }
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  process.exitCode = failed === 0 ? 0 : 1;
}

await main();
