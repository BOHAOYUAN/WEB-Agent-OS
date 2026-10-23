import { describe, expect, it } from "vitest";
import { buildCsv } from "../src/export.js";
import type { ExtractData } from "../src/executor.js";

const table = (header: string[], rows: string[][]): ExtractData => ({ kind: "table", header, rows });
const text = (value: string): ExtractData => ({ kind: "text", text: value });

describe("buildCsv", () => {
  it("uses the first table's header and appends all rows", () => {
    const result = buildCsv([
      table(["a", "b"], [["1", "2"]]),
      table(["a", "b"], [["3", "4"]]),
    ]);
    expect(result.rowCount).toBe(2);
    expect(result.csv).toBe("a,b\r\n1,2\r\n3,4");
  });

  it("quotes fields that contain commas, quotes or newlines", () => {
    const result = buildCsv([table(["名字", "备注"], [["张三", "含,逗号"]]), table(["名字", "备注"], [["李四", '含"引号']])]);
    expect(result.csv).toBe('名字,备注\r\n张三,"含,逗号"\r\n李四,"含""引号"');
  });

  it("falls back to a single text column when there are no tables", () => {
    const result = buildCsv([text("甲"), text("乙")]);
    expect(result.csv).toBe("text\r\n甲\r\n乙");
    expect(result.rowCount).toBe(2);
  });

  it("returns an empty result for no data", () => {
    const result = buildCsv([]);
    expect(result.csv).toBe("");
    expect(result.rowCount).toBe(0);
  });
});
