/**
 * CSV assembly for PageAct exports — pure data, no DOM, no I/O.
 *
 * The "数据组装" half of the batch-export story: the executor already
 * collects `ExtractData` from every `extract` action; this turns that into a
 * CSV string the service worker can hand to `chrome.downloads`.
 */

import type { ExtractData } from "./executor.js";

export interface CsvExport {
  csv: string;
  /** Number of data rows (excluding the header). */
  rowCount: number;
}

/** Quote a field only when it needs it; double internal quotes. */
function escapeCsvField(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Assemble extracted data into CSV.
 *
 * Tables win: when any table was extracted, the first table's header becomes
 * the CSV header and every table's rows are appended in order. (The caller
 * is responsible for extracting same-shape tables across pages; a page whose
 * table changes shape mid-batch will produce ragged rows, not an error.)
 *
 * With only text extracts, each becomes one row under a single `text` column.
 * With nothing at all, `rowCount` is 0 and the caller must refuse to export.
 */
export function buildCsv(items: readonly ExtractData[]): CsvExport {
  const tables = items.filter((d): d is ExtractData & { kind: "table" } => d.kind === "table");
  if (tables.length > 0) {
    const header = tables[0]!.header;
    const rows = tables.flatMap((table) => table.rows);
    const lines = [header, ...rows].map((row) => row.map(escapeCsvField).join(","));
    return { csv: lines.join("\r\n"), rowCount: rows.length };
  }

  const texts = items.filter((d): d is ExtractData & { kind: "text" } => d.kind === "text");
  if (texts.length === 0) {
    return { csv: "", rowCount: 0 };
  }
  const lines = ["text", ...texts.map((t) => escapeCsvField(t.text))];
  return { csv: lines.join("\r\n"), rowCount: texts.length };
}
