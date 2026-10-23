import { describe, expect, it } from "vitest";
import { AuditLog, MAX_AUDIT_DETAIL_CHARS, redact } from "../src/security/audit-log.js";

describe("audit log — redaction", () => {
  it("masks the reusable handshake token", () => {
    const out = redact("WebOSLocal-abcdef123456 rejected");
    expect(out).not.toContain("abcdef123456");
    expect(out).toContain("[redacted]");
  });

  it("masks token query parameters and API keys", () => {
    expect(redact("?token=WebOSLocal-deadbeefcafe")).not.toContain("deadbeefcafe");
    expect(redact("key sk-0123456789abcdef")).not.toContain("sk-0123456789abcdef");
  });

  it("caps the detail length", () => {
    const out = redact("x".repeat(500));
    expect(out.length).toBe(MAX_AUDIT_DETAIL_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves harmless detail alone", () => {
    expect(redact("origin not allowed")).toBe("origin not allowed");
  });
});

describe("audit log — ring buffer", () => {
  it("keeps records oldest first", () => {
    const log = new AuditLog();
    log.record("command-ok", "exec");
    log.record("command-denied", "denied");
    expect(log.list().map((r) => r.event)).toEqual(["command-ok", "command-denied"]);
  });

  it("drops the oldest record past capacity", () => {
    const log = new AuditLog({ capacity: 3 });
    for (let i = 0; i < 5; i++) log.record("command-ok", `n${i}`);
    const records = log.list();
    expect(records).toHaveLength(3);
    expect(records[0]?.detail).toBe("n2");
    expect(records[2]?.detail).toBe("n4");
  });

  it("redacts on the way in, not on the way out", () => {
    const log = new AuditLog();
    log.record("token-denied", "token WebOSLocal-abcdef123456");
    expect(log.list()[0]?.detail).not.toContain("abcdef123456");
  });

  it("notifies the sink for every record", () => {
    const seen: string[] = [];
    const log = new AuditLog({ onRecord: (record) => seen.push(record.event) });
    log.record("token-denied");
    log.record("command-ok");
    expect(seen).toEqual(["token-denied", "command-ok"]);
  });

  it("rejects a non-positive capacity", () => {
    expect(() => new AuditLog({ capacity: 0 })).toThrow();
    expect(() => new AuditLog({ capacity: 1.5 })).toThrow();
  });

  it("clears on demand", () => {
    const log = new AuditLog();
    log.record("command-ok");
    log.clear();
    expect(log.size()).toBe(0);
  });
});
