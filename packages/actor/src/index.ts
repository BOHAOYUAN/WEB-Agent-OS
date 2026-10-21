/**
 * Actor layer — the local execution bridge.
 *
 * A Node.js process that listens on 127.0.0.1 and executes allowlisted commands
 * on behalf of the browser extension. Security posture is deny-by-default:
 * Origin + one-shot token handshake, allowlist/denylist command policy, and
 * shell-free spawn with cwd isolation and a hard timeout.
 *
 * This package imports only `@webos/shared` (for the wire contract) and Node
 * builtins — it never touches browser APIs.
 */

export * from "./transport/server.js";
export * from "./transport/frame.js";
export * from "./transport/handshake.js";
export * from "./transport/heartbeat.js";
export * from "./security/token.js";
export * from "./security/command-policy.js";
export * from "./exec/runner.js";
export * from "./memory/summarize.js";
