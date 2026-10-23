import { describe, expect, it } from "vitest";
import {
  DANGER_BY_KIND,
  describeAction,
  describeDanger,
  isDangerousFor,
  isSafeSelector,
  validatePageAction,
  validatePageActions,
  type PageAction,
} from "../src/dsl.js";

describe("page action DSL — validation", () => {
  it("accepts each supported action", () => {
    const cases: unknown[] = [
      { kind: "click", selector: "#submit" },
      { kind: "fill", selector: "input[name=q]", value: "hello" },
      { kind: "scroll", to: "top" },
      { kind: "scroll", to: "bottom" },
      { kind: "scroll", to: { selector: "#section-3" } },
      { kind: "extract", selector: "table", as: "table" },
      { kind: "extract", selector: "#body", as: "text" },
      { kind: "waitFor", selector: ".done", timeoutMs: 1000 },
      { kind: "nextPage", selector: ".next" },
      { kind: "export", format: "csv" },
    ];
    for (const item of cases) {
      expect(validatePageAction(item).ok).toBe(true);
    }
  });

  it("rejects anything that is not an object", () => {
    expect(validatePageAction("click").ok).toBe(false);
    expect(validatePageAction(null).ok).toBe(false);
    expect(validatePageAction([{ kind: "click", selector: "#x" }]).ok).toBe(false);
  });

  it("rejects an unknown action kind", () => {
    const result = validatePageAction({ kind: "eval", code: "alert(1)" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("unknown action kind");
  });

  it("rejects extra fields — the model cannot smuggle anything", () => {
    const result = validatePageAction({ kind: "click", selector: "#x", js: "alert(1)" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("unexpected field");
  });

  it("rejects missing fields", () => {
    expect(validatePageAction({ kind: "click" }).ok).toBe(false);
    expect(validatePageAction({ kind: "fill", selector: "#x" }).ok).toBe(false);
  });

  it("rejects an unsafe or oversized selector", () => {
    expect(validatePageAction({ kind: "click", selector: "<script>" }).ok).toBe(false);
    expect(validatePageAction({ kind: "click", selector: "a{b}" }).ok).toBe(false);
    expect(validatePageAction({ kind: "click", selector: "x".repeat(201) }).ok).toBe(false);
    expect(validatePageAction({ kind: "click", selector: "" }).ok).toBe(false);
    expect(validatePageAction({ kind: "click", selector: 42 }).ok).toBe(false);
  });

  it("rejects an oversized value", () => {
    expect(validatePageAction({ kind: "fill", selector: "#x", value: "x".repeat(1001) }).ok).toBe(false);
    expect(validatePageAction({ kind: "fill", selector: "#x", value: "x".repeat(1000) }).ok).toBe(true);
    expect(validatePageAction({ kind: "fill", selector: "#x", value: 5 }).ok).toBe(false);
  });

  it("rejects a bad scroll target", () => {
    expect(validatePageAction({ kind: "scroll", to: "middle" }).ok).toBe(false);
    expect(validatePageAction({ kind: "scroll", to: { selector: "#x", extra: 1 } }).ok).toBe(false);
    expect(validatePageAction({ kind: "scroll", to: { selector: "<script>" } }).ok).toBe(false);
  });

  it("rejects a bad extract mode", () => {
    expect(validatePageAction({ kind: "extract", selector: "#x", as: "html" }).ok).toBe(false);
  });

  it("rejects an out-of-range timeout", () => {
    expect(validatePageAction({ kind: "waitFor", selector: "#x", timeoutMs: 99 }).ok).toBe(false);
    expect(validatePageAction({ kind: "waitFor", selector: "#x", timeoutMs: 30_001 }).ok).toBe(false);
    expect(validatePageAction({ kind: "waitFor", selector: "#x", timeoutMs: 1.5 }).ok).toBe(false);
  });

  it("validates a batch as a whole", () => {
    const good = validatePageActions([
      { kind: "click", selector: "#a" },
      { kind: "waitFor", selector: "#b", timeoutMs: 500 },
    ]);
    expect(good.ok).toBe(true);
    expect(good.ok === true && good.actions).toHaveLength(2);

    const bad = validatePageActions([
      { kind: "click", selector: "#a" },
      { kind: "eval", code: "x" },
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.reason).toContain("action[1]");
  });
});

describe("page action DSL — selectors", () => {
  it("accepts ordinary CSS, including the child combinator", () => {
    expect(isSafeSelector("#id .cls")).toBe(true);
    expect(isSafeSelector("div > span")).toBe(true);
    expect(isSafeSelector("input[name='q']")).toBe(true);
  });

  it("rejects characters that never belong in a selector", () => {
    expect(isSafeSelector("<img onerror=x>")).toBe(false);
    expect(isSafeSelector("a{color:red}")).toBe(false);
  });
});

describe("page action DSL — danger mapping", () => {
  it("only clicks and fills can be dangerous", () => {
    expect(DANGER_BY_KIND.click).toContain("download");
    expect(DANGER_BY_KIND.fill).toEqual(["credential"]);
    expect(DANGER_BY_KIND.extract).toEqual([]);
    expect(DANGER_BY_KIND.scroll).toEqual([]);
  });

  it("asks whether a danger applies to an action", () => {
    const click: PageAction = { kind: "click", selector: "#x" };
    const fill: PageAction = { kind: "fill", selector: "#x", value: "v" };
    expect(isDangerousFor(click, "download")).toBe(true);
    expect(isDangerousFor(click, "credential")).toBe(false);
    expect(isDangerousFor(fill, "credential")).toBe(true);
  });

  it("describes every danger in words", () => {
    expect(describeDanger("download")).toContain("下载");
    expect(describeDanger("submit")).toContain("提交");
    expect(describeDanger("credential")).toContain("密码");
    expect(describeDanger("destructive")).toContain("删除");
  });
});

describe("page action DSL — summaries", () => {
  it("summarises each action in Chinese", () => {
    expect(describeAction({ kind: "click", selector: "#submit" })).toContain("#submit");
    expect(describeAction({ kind: "scroll", to: "top" })).toContain("顶部");
    expect(describeAction({ kind: "extract", selector: "table", as: "table" })).toContain("表格");
    expect(describeAction({ kind: "nextPage", selector: ".next" })).toContain("翻页");
  });

  it("truncates a long value so the prompt stays readable", () => {
    const summary = describeAction({ kind: "fill", selector: "#x", value: "y".repeat(200) });
    expect(summary.length).toBeLessThan(90);
    expect(summary).toContain("…");
  });
});

describe("page action DSL — export", () => {
  it("rejects a non-csv format (xlsx needs SheetJS, a whitelist decision)", () => {
    const result = validatePageAction({ kind: "export", format: "xlsx" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("csv");
  });

  it("rejects extra fields on export", () => {
    const result = validatePageAction({ kind: "export", format: "csv", filename: "evil.csv" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("unexpected field");
  });

  it("marks export as a download danger", () => {
    expect(DANGER_BY_KIND.export).toContain("download");
  });
});
