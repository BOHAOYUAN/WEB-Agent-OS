/**
 * Audit trail for the local Actor bridge.
 *
 * What belongs in here: anything a security reviewer would ask about later —
 * a refused handshake, a refused token, a malformed frame, a command the
 * allowlist denied, a command that ran, a connection that got throttled.
 *
 * What must never get here: the handshake token, a full command line, or
 * anything the user typed. The trail exists for traceability, not for replay.
 * `redact()` therefore masks token-shaped substrings and caps the length
 * BEFORE a record is stored — an exported trail cannot leak what it must not,
 * because the secret was never kept.
 *
 * The log is an in-memory ring: bounded, oldest-first, and gone when the
 * process exits. That is a deliberate limitation, not an oversight — a
 * persistent audit file on disk is a new privacy surface (see the memory
 * system's rules about what may touch the disk).
 */

import type { AuditEvent, AuditRecord } from "@webos/shared";

/** Longest detail we keep. Enough to say what happened, not to store a payload. */
export const MAX_AUDIT_DETAIL_CHARS = 120;

/**
 * Substrings that must never survive into the trail.
 *
 * The handshake token is the important one: it is reusable, so leaking it
 * into an export file would hand out the bridge. The others are cheap
 * insurance for command lines that happen to contain a key.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /WebOSLocal-[0-9a-f]+/gi,
  /token=[^\s&"']+/gi,
  /sk-[A-Za-z0-9]{8,}/g,
];

/**
 * Mask secret-shaped substrings and cap the length.
 *
 * Exported on purpose: the server and the tests both need it, and a redaction
 * rule that lives in one place cannot drift away from the thing it protects.
 */
export function redact(detail: string): string {
  let out = detail;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  if (out.length > MAX_AUDIT_DETAIL_CHARS) {
    out = `${out.slice(0, MAX_AUDIT_DETAIL_CHARS - 1)}…`;
  }
  return out;
}

/** Default number of records kept in memory. */
export const DEFAULT_AUDIT_CAPACITY = 500;

export interface AuditLogOptions {
  /** Maximum records kept; the oldest is dropped past this. */
  capacity?: number;
  /** Called for every stored record (the bridge logs them here). */
  onRecord?: (record: AuditRecord) => void;
}

/**
 * Bounded audit trail.
 *
 * Capacity is a hard cap, not a soft hint: when the ring is full the OLDEST
 * record is dropped. An audit trail that grows without bound is a memory leak
 * with extra steps.
 */
export class AuditLog {
  private readonly records: AuditRecord[] = [];
  private readonly capacity: number;
  private readonly onRecord: ((record: AuditRecord) => void) | undefined;

  constructor(options: AuditLogOptions = {}) {
    const capacity = options.capacity ?? DEFAULT_AUDIT_CAPACITY;
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("audit capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.onRecord = options.onRecord;
  }

  /** Append a record. Returns the stored (already redacted) record. */
  record(event: AuditEvent, detail = ""): AuditRecord {
    const entry: AuditRecord = { ts: Date.now(), event, detail: redact(detail) };
    this.records.push(entry);
    while (this.records.length > this.capacity) {
      this.records.shift();
    }
    this.onRecord?.(entry);
    return entry;
  }

  /** Oldest first. */
  list(): AuditRecord[] {
    return [...this.records];
  }

  /** How many records are currently held. */
  size(): number {
    return this.records.length;
  }

  /** Drop everything (used by tests and by an explicit "clear" action). */
  clear(): void {
    this.records.length = 0;
  }
}
