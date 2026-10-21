/**
 * Command allowlist / denylist engine — the security foundation of the Actor.
 *
 * Policy is deny-by-default:
 *   1. Only commands whose executable (argv[0]) appears in the allowlist may run.
 *   2. Even an allowed executable is rejected if its arguments trigger a denylist
 *      pattern (shell escapes, command substitution, redirection, pipes, etc.).
 *   3. Anything malformed or unexpected is rejected — never guessed at.
 *
 * The engine is a pure function of the raw command string so it can be unit
 * tested exhaustively without spawning any process or opening any socket.
 */

/** Outcome of evaluating one command against the policy. */
export type PolicyDecision =
  | { ok: true; argv: string[]; executable: string }
  | { ok: false; reason: string };

/** A single executable allowed to run, with optional argument guardrails. */
export interface AllowlistEntry {
  /** The exact executable name, e.g. "node" or "git". */
  name: string;
  /** Optional subcommand allowlist, e.g. git may only run ["status", "log"]. */
  subcommands?: readonly string[];
}

/**
 * The built-in allowlist. Deliberately tiny: this is a local bridge, not a
 * general shell. Adding an executable is an explicit, reviewed act.
 *
 * Interpreters (node / python / npm) are intentionally ABSENT. Any of them
 * accepts an inline code flag (`-e` / `-c` / `--eval` / `exec`) that runs
 * arbitrary code without any shell metacharacter, which would bypass the
 * denylist entirely. Running user/model code needs a dedicated executor with a
 * fixed script directory and a fixed entrypoint — never a bare interpreter.
 */
export const DEFAULT_ALLOWLIST: readonly AllowlistEntry[] = [
  { name: "git", subcommands: ["status", "log", "diff", "branch", "show"] },
] as const;

/**
 * Shell metacharacters / constructs that must never reach the OS, even when the
 * executable itself is allowlisted. This is the belt-and-suspenders layer on top
 * of the allowlist.
 */
const DANGEROUS_PATTERNS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /rm\s+(-[a-zA-Z]+\s+)*-?rf\b/i, why: "recursive force delete" },
  { pattern: /\bsh\s+-c\b/, why: "shell -c arbitrary command" },
  { pattern: /\bbash\s+-c\b/, why: "bash -c arbitrary command" },
  { pattern: /\bzsh\s+-c\b/, why: "zsh -c arbitrary command" },
  { pattern: /\$\(/, why: "command substitution $(...)" },
  { pattern: /`/, why: "backtick command substitution" },
  { pattern: /[|;&]/, why: "pipe, background, or command chaining" },
  { pattern: /[<>]/, why: "input/output redirection" },
  { pattern: /\$\{[^}]*\}/, why: "environment variable expansion" },
  { pattern: /\$[A-Za-z_][A-Za-z0-9_]*/, why: "environment variable reference" },
  { pattern: /&&|\|\|/, why: "logical command chaining" },
  { pattern: /\.\.\//, why: "parent directory traversal" },
  { pattern: /sudo\b/i, why: "privilege escalation" },
  { pattern: /chmod\b/i, why: "permission mutation" },
  { pattern: /curl\b.*\b(https?:)?\/\//i, why: "network exfiltration" },
  // Defense-in-depth: even if an interpreter is ever re-added to the allowlist,
  // its inline-code flags must stay blocked (no shell metacharacter needed to
  // abuse them).
  { pattern: /(?:^|\s)node(?:\.exe)?\s+(?:-e|--eval|-p|--print)\b/, why: "node inline code execution" },
  { pattern: /(?:^|\s)python(?:3)?\s+-c\b/, why: "python inline code execution" },
  { pattern: /(?:^|\s)npm\s+(?:exec|x)\b/, why: "npm arbitrary package execution" },
];

/**
 * Split a raw command string into argv without invoking a shell. This is a
 * conservative, quote-aware tokenizer — it never executes anything, it only
 * splits on whitespace while respecting single/double quotes.
 */
export function tokenizeCommand(raw: string): string[] {
  const argv: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      if (current.length > 0) {
        argv.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
    i += 1;
  }
  if (quote !== null) {
    // Unterminated quote — reject downstream, don't silently swallow.
    throw new Error("unterminated quote in command");
  }
  if (current.length > 0) argv.push(current);
  return argv;
}

/**
 * Evaluate a raw command string against the allowlist + denylist.
 * Returns either a clean argv ready for spawn (argv[0] = executable) or a
 * denial reason. Never throws for policy reasons — only for malformed input
 * that cannot be split (unterminated quote).
 */
export function evaluateCommand(
  raw: string,
  allowlist: readonly AllowlistEntry[] = DEFAULT_ALLOWLIST,
): PolicyDecision {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty command" };
  }

  // Denylist runs first — it must reject even allowlisted executables when the
  // arguments carry a dangerous construct.
  for (const { pattern, why } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: why };
    }
  }

  let argv: string[];
  try {
    argv = tokenizeCommand(trimmed);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "malformed command" };
  }

  if (argv.length === 0) {
    return { ok: false, reason: "empty command" };
  }

  const executable = argv[0];
  if (executable === undefined) {
    return { ok: false, reason: "missing executable" };
  }

  const entry = allowlist.find((a) => a.name === executable);
  if (entry === undefined) {
    return { ok: false, reason: `executable not allowed: ${executable}` };
  }

  if (entry.subcommands !== undefined && argv.length > 1) {
    const sub = argv[1];
    if (sub !== undefined && !entry.subcommands.includes(sub)) {
      return { ok: false, reason: `subcommand not allowed for ${executable}: ${sub}` };
    }
  }

  return { ok: true, argv, executable };
}
