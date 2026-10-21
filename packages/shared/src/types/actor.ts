/**
 * Actor layer contract — intentionally type-only in step 1.
 * The local bridge (Node.js/Python) is implemented in a later phase.
 */
export const ACTOR_PROTOCOL_VERSION = 1 as const;

export interface ActorCommand {
  v: typeof ACTOR_PROTOCOL_VERSION;
  id: string;
  kind: "exec";
  runtime: "node" | "python";
  code: string;
  timeoutMs: number;
}

export type ActorResult =
  | { v: typeof ACTOR_PROTOCOL_VERSION; id: string; ok: true; stdout: string; stderr: string; exitCode: number }
  | { v: typeof ACTOR_PROTOCOL_VERSION; id: string; ok: false; code: "denied" | "timeout" | "spawn-failed"; message: string };

export interface ActorTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(command: ActorCommand): Promise<ActorResult>;
}
