import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALLOWLIST,
  evaluateCommand,
  tokenizeCommand,
} from "../src/security/command-policy.js";

describe("tokenizeCommand", () => {
  it("splits on whitespace", () => {
    expect(tokenizeCommand("git status")).toEqual(["git", "status"]);
  });

  it("respects double quotes", () => {
    expect(tokenizeCommand('echo "hello world"')).toEqual(["echo", "hello world"]);
  });

  it("respects single quotes", () => {
    expect(tokenizeCommand("echo 'a b'")).toEqual(["echo", "a b"]);
  });

  it("throws on unterminated quote", () => {
    expect(() => tokenizeCommand('echo "unterminated')).toThrow("unterminated quote");
  });
});

describe("evaluateCommand — deny by default", () => {
  it("rejects empty command", () => {
    expect(evaluateCommand("   ")).toEqual({ ok: false, reason: "empty command" });
  });

  it("rejects an executable not in the allowlist", () => {
    const result = evaluateCommand("rm -rf /");
    expect(result.ok).toBe(false);
  });

  it("allows a plain allowlisted executable", () => {
    const result = evaluateCommand("git status");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.argv).toEqual(["git", "status"]);
      expect(result.executable).toBe("git");
    }
  });

  it("rejects a non-allowlisted subcommand", () => {
    const result = evaluateCommand("git push origin main");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("subcommand not allowed");
  });

  it("rejects shell command substitution", () => {
    expect(evaluateCommand("git status $(whoami)").ok).toBe(false);
  });

  it("rejects backtick substitution", () => {
    expect(evaluateCommand("git status `whoami`").ok).toBe(false);
  });

  it("rejects pipes", () => {
    expect(evaluateCommand("git log | grep foo").ok).toBe(false);
  });

  it("rejects redirection", () => {
    expect(evaluateCommand("git log > /tmp/out").ok).toBe(false);
  });

  it("rejects environment variable expansion", () => {
    expect(evaluateCommand("echo $HOME").ok).toBe(false);
  });

  it("rejects rm -rf even if rm were allowlisted", () => {
    const allowlist = [...DEFAULT_ALLOWLIST, { name: "rm" }];
    expect(evaluateCommand("rm -rf /", allowlist).ok).toBe(false);
  });

  it("rejects sudo even on an allowlisted executable", () => {
    expect(evaluateCommand("sudo git status").ok).toBe(false);
  });

  it("rejects parent directory traversal", () => {
    expect(evaluateCommand("git log ../../etc/passwd").ok).toBe(false);
  });

  it("rejects node even if node were allowlisted (inline code flag)", () => {
    const allowlist = [...DEFAULT_ALLOWLIST, { name: "node" }];
    expect(evaluateCommand("node -e \"require('child_process').execSync('id')\"", allowlist).ok).toBe(false);
  });

  it("rejects python -c even if python were allowlisted", () => {
    const allowlist = [...DEFAULT_ALLOWLIST, { name: "python" }];
    expect(evaluateCommand("python -c \"import os; os.system('id')\"", allowlist).ok).toBe(false);
  });

  it("rejects npm exec even if npm were allowlisted", () => {
    const allowlist = [...DEFAULT_ALLOWLIST, { name: "npm" }];
    expect(evaluateCommand("npm exec --yes some-package", allowlist).ok).toBe(false);
  });

  it("does not allowlist any interpreter by default", () => {
    for (const name of ["node", "npm", "python", "python3"]) {
      expect(DEFAULT_ALLOWLIST.some((entry) => entry.name === name)).toBe(false);
    }
  });
});
