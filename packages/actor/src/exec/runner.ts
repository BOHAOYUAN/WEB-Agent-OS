/**
 * Safe command execution via child_process — no shell, isolated cwd, stripped
 * environment, hard timeout.
 *
 * The runner NEVER invokes a shell (`shell: false` is the default and is kept
 * explicit). The allowlist has already vetted argv by the time it reaches here;
 * this layer enforces the runtime containment:
 *   - the process runs in a fixed, user-configured working directory (never the
 *     bridge's own directory, never a path derived from the model's output);
 *   - the environment is stripped to a small safe subset (no secrets, no API
 *     keys, no proxy config);
 *   - a hard timeout kills the process if it overruns.
 */

import { spawn } from "node:child_process";

/** Environment variables that are safe to forward to a child process. */
const SAFE_ENV_KEYS: readonly string[] = ["PATH", "HOME", "LANG", "LC_ALL", "TZ"] as const;

export interface ExecutionOptions {
  /** The working directory the child runs in (must be an absolute path). */
  cwd: string;
  /** Hard timeout in milliseconds; the process is killed on expiry. */
  timeoutMs: number;
  /** Maximum bytes of combined stdout+stderr to retain (prevents memory blowup). */
  maxOutputBytes: number;
}

export interface ExecutionResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** Set when the process was killed for overrunning the timeout. */
  timedOut: boolean;
  /** Set when spawning itself failed (e.g. executable not found). */
  spawnError?: string;
}

/** Build the minimal safe environment for a child process. */
export function safeEnvironment(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    env[key] = value;
  }
  return env;
}

/**
 * Execute `argv` (already allowlisted) as a child process. Returns a promise
 * that resolves with the captured output and exit status. Never throws for
 * runtime failures — those are reported in the result.
 */
export function executeCommand(argv: string[], options: ExecutionOptions): Promise<ExecutionResult> {
  return new Promise<ExecutionResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: ExecutionResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawn(argv[0]!, argv.slice(1), {
        cwd: options.cwd,
        env: safeEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish({
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        timedOut: false,
        spawnError: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, stdout, stderr, exitCode: null, timedOut: true });
    }, options.timeoutMs);

    const cap = (current: string, chunk: Buffer): string => {
      if (current.length >= options.maxOutputBytes) return current;
      const room = options.maxOutputBytes - current.length;
      return current + chunk.subarray(0, room).toString("utf8");
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = cap(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = cap(stderr, chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        stdout,
        stderr,
        exitCode: null,
        timedOut: false,
        spawnError: error.message,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0, stdout, stderr, exitCode: code, timedOut: false });
    });
  });
}
