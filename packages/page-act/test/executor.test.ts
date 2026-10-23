import { describe, expect, it } from "vitest";
import type { PageDanger } from "../src/dsl.js";
import {
  executeAction,
  executeActions,
  type ConfirmationRequest,
  type PageElement,
  type PageEnvironment,
} from "../src/executor.js";

/** A fake element that records what the executor did to it. */
class FakeElement implements PageElement {
  clicks = 0;
  values: string[] = [];
  scrolls = 0;

  constructor(
    readonly describe: string,
    readonly textContent = "",
    readonly danger: PageDanger | null = null,
    private readonly tableRows: string[][] = [],
  ) {}

  click(): void {
    this.clicks += 1;
  }

  setValue(value: string): void {
    this.values.push(value);
  }

  scrollIntoView(): void {
    this.scrolls += 1;
  }

  rows(): string[][] {
    return this.tableRows;
  }
}

class FakeEnvironment implements PageEnvironment {
  readonly scrolls: Array<"top" | "bottom"> = [];

  constructor(private readonly elements: Record<string, FakeElement>) {}

  query(selector: string): PageElement | null {
    return this.elements[selector] ?? null;
  }

  queryAll(selector: string): PageElement[] {
    const element = this.elements[selector];
    return element ? [element] : [];
  }

  scrollWindow(to: "top" | "bottom"): void {
    this.scrolls.push(to);
  }

  async waitFor(selector: string): Promise<PageElement | null> {
    return this.elements[selector] ?? null;
  }
}

const click = (selector: string) => ({ kind: "click", selector }) as const;

describe("page act executor — ordinary actions", () => {
  it("clicks an element", async () => {
    const button = new FakeElement("button#ok");
    const env = new FakeEnvironment({ "#ok": button });
    const result = await executeAction(click("#ok"), env);
    expect(result.ok).toBe(true);
    expect(button.clicks).toBe(1);
  });

  it("reports a missing element instead of throwing", async () => {
    const env = new FakeEnvironment({});
    const result = await executeAction(click("#nope"), env);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("找不到元素");
  });

  it("fills a field", async () => {
    const input = new FakeElement("input");
    const env = new FakeEnvironment({ "#q": input });
    const result = await executeAction({ kind: "fill", selector: "#q", value: "hello" }, env);
    expect(result.ok).toBe(true);
    expect(input.values).toEqual(["hello"]);
  });

  it("scrolls the window and an element", async () => {
    const section = new FakeElement("section");
    const env = new FakeEnvironment({ "#s": section });
    expect((await executeAction({ kind: "scroll", to: "top" }, env)).ok).toBe(true);
    expect((await executeAction({ kind: "scroll", to: "bottom" }, env)).ok).toBe(true);
    expect(env.scrolls).toEqual(["top", "bottom"]);
    expect((await executeAction({ kind: "scroll", to: { selector: "#s" } }, env)).ok).toBe(true);
    expect(section.scrolls).toBe(1);
  });

  it("extracts text and tables", async () => {
    const table = new FakeElement("table", "", null, [
      ["订单号", "金额"],
      ["A-1", "12.00"],
      ["A-2", "8.50"],
    ]);
    const env = new FakeEnvironment({ "#t": table, "#p": new FakeElement("p", "  正文  ") });

    const text = await executeAction({ kind: "extract", selector: "#p", as: "text" }, env);
    expect(text.ok).toBe(true);
    expect(text.data).toEqual({ kind: "text", text: "正文" });

    const rows = await executeAction({ kind: "extract", selector: "#t", as: "table" }, env);
    expect(rows.ok).toBe(true);
    expect(rows.data).toEqual({
      kind: "table",
      header: ["订单号", "金额"],
      rows: [
        ["A-1", "12.00"],
        ["A-2", "8.50"],
      ],
    });
  });

  it("waits for an element", async () => {
    const env = new FakeEnvironment({ ".done": new FakeElement("div") });
    const found = await executeAction({ kind: "waitFor", selector: ".done", timeoutMs: 1000 }, env);
    expect(found.ok).toBe(true);
    const missing = await executeAction({ kind: "waitFor", selector: ".nope", timeoutMs: 1000 }, env);
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain("等待超时");
  });

  it("survives a page that throws", async () => {
    const env: PageEnvironment = {
      query() {
        throw new Error("boom");
      },
      queryAll() {
        return [];
      },
      scrollWindow() {},
      async waitFor() {
        return null;
      },
    };
    const result = await executeAction(click("#x"), env);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("执行失败");
  });
});

describe("page act executor — dangerous actions need confirmation", () => {
  it("refuses a download click when nothing can confirm it", async () => {
    const button = new FakeElement("a.download", "下载", "download");
    const env = new FakeEnvironment({ "#dl": button });
    const result = await executeAction(click("#dl"), env);
    expect(result.ok).toBe(false);
    expect(result.refused).toBe(true);
    expect(button.clicks).toBe(0);
  });

  it("refuses when the user says no", async () => {
    const button = new FakeElement("button.submit", "提交订单", "submit");
    const env = new FakeEnvironment({ "#s": button });
    const result = await executeAction(click("#s"), env, { confirm: () => false });
    expect(result.ok).toBe(false);
    expect(result.refused).toBe(true);
    expect(button.clicks).toBe(0);
  });

  it("runs when the user says yes, and passes the reason along", async () => {
    const button = new FakeElement("button.submit", "提交订单", "submit");
    const env = new FakeEnvironment({ "#s": button });
    const requests: ConfirmationRequest[] = [];
    const result = await executeAction(click("#s"), env, {
      confirm: (request) => {
        requests.push(request);
        return true;
      },
    });
    expect(result.ok).toBe(true);
    expect(button.clicks).toBe(1);
    expect(requests[0]?.danger).toBe("submit");
    expect(requests[0]?.summary).toContain("#s");
    expect(requests[0]?.element).toBe("button.submit");
  });

  it("refuses a credential field without confirmation", async () => {
    const input = new FakeElement("input[type=password]", "", "credential");
    const env = new FakeEnvironment({ "#pw": input });
    const refused = await executeAction({ kind: "fill", selector: "#pw", value: "hunter2" }, env);
    expect(refused.ok).toBe(false);
    expect(input.values).toEqual([]);

    const approved = await executeAction(
      { kind: "fill", selector: "#pw", value: "hunter2" },
      env,
      { confirm: () => true },
    );
    expect(approved.ok).toBe(true);
    expect(input.values).toEqual(["hunter2"]);
  });

  it("does not ask about a harmless click", async () => {
    const button = new FakeElement("button#ok", "确定");
    const env = new FakeEnvironment({ "#ok": button });
    let asked = false;
    const result = await executeAction(click("#ok"), env, {
      confirm: () => {
        asked = true;
        return false;
      },
    });
    expect(result.ok).toBe(true);
    expect(asked).toBe(false);
  });
});

describe("page act executor — batches", () => {
  it("runs actions in order", async () => {
    const a = new FakeElement("a");
    const b = new FakeElement("b");
    const env = new FakeEnvironment({ "#a": a, "#b": b });
    const results = await executeActions([click("#a"), click("#b")], env);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(a.clicks).toBe(1);
    expect(b.clicks).toBe(1);
  });

  it("stops at the first failure", async () => {
    const a = new FakeElement("a");
    const b = new FakeElement("b");
    const env = new FakeEnvironment({ "#a": a, "#b": b });
    const results = await executeActions([click("#missing"), click("#b")], env);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(b.clicks).toBe(0);
  });

  it("stops at a refused dangerous action", async () => {
    const download = new FakeElement("a.download", "下载", "download");
    const after = new FakeElement("after");
    const env = new FakeEnvironment({ "#dl": download, "#after": after });
    const results = await executeActions([click("#dl"), click("#after")], env);
    expect(results).toHaveLength(1);
    expect(results[0]?.refused).toBe(true);
    expect(after.clicks).toBe(0);
  });

  it("caps the number of actions", async () => {
    const env = new FakeEnvironment({ "#a": new FakeElement("a") });
    const results = await executeActions([click("#a"), click("#a"), click("#a")], env, { maxActions: 2 });
    expect(results).toHaveLength(3);
    expect(results[2]?.refused).toBe(true);
    expect(results[2]?.message).toContain("上限");
  });

  it("caps pagination steps — the runaway loop breaker", async () => {
    const next = new FakeElement("a.next");
    const env = new FakeEnvironment({ ".next": next });
    const results = await executeActions(
      [{ kind: "nextPage", selector: ".next" }, { kind: "nextPage", selector: ".next" }],
      env,
      { maxPaginationSteps: 1 },
    );
    expect(results).toHaveLength(2);
    expect(results[1]?.refused).toBe(true);
    expect(results[1]?.message).toContain("翻页");
    expect(next.clicks).toBe(1);
  });
});

describe("page act executor — export", () => {
  const table = (header: string[], rows: string[][]) =>
    new FakeElement("table", "", null, [header, ...rows]);

  it("assembles prior extracts into a CSV after approval", async () => {
    const env = new FakeEnvironment({
      "#t1": table(["订单号", "金额"], [["A-1", "12.00"]]),
      "#t2": table(["订单号", "金额"], [["B-7", "8.50"]]),
    });
    const results = await executeActions(
      [
        { kind: "extract", selector: "#t1", as: "table" },
        { kind: "extract", selector: "#t2", as: "table" },
        { kind: "export", format: "csv" },
      ],
      env,
      { confirm: () => true },
    );
    const exported = results[2]?.export;
    expect(exported?.rowCount).toBe(2);
    expect(exported?.csv).toBe('订单号,金额\r\nA-1,12.00\r\nB-7,8.50');
  });

  it("refuses to export without a confirm channel", async () => {
    const env = new FakeEnvironment({ "#t": table(["a"], [["1"]]) });
    const results = await executeActions(
      [
        { kind: "extract", selector: "#t", as: "table" },
        { kind: "export", format: "csv" },
      ],
      env,
    );
    const exported = results[1];
    expect(exported?.ok).toBe(false);
    expect(exported?.refused).toBe(true);
    expect(exported?.export).toBeUndefined();
  });

  it("fails (not refused) when there is nothing to export", async () => {
    const env = new FakeEnvironment({});
    const results = await executeActions([{ kind: "export", format: "csv" }], env, { confirm: () => true });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.refused).toBeUndefined();
    expect(results[0]?.message).toContain("没有可导出的数据");
  });

  it("turns text-only extracts into a single column", async () => {
    const env = new FakeEnvironment({
      "#a": new FakeElement("p", "甲"),
      "#b": new FakeElement("p", "乙"),
    });
    const results = await executeActions(
      [
        { kind: "extract", selector: "#a", as: "text" },
        { kind: "extract", selector: "#b", as: "text" },
        { kind: "export", format: "csv" },
      ],
      env,
      { confirm: () => true },
    );
    expect(results[2]?.export?.csv).toBe("text\r\n甲\r\n乙");
    expect(results[2]?.export?.rowCount).toBe(2);
  });
});
