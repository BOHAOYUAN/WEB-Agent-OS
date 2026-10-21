export type Channel = "thinking" | "answer";
export type Transport = "xhr" | "fetch";
export type EndReason =
  | "finished"
  | "incomplete"
  | "aborted"
  | "transport-closed"
  | "error";

export type SensorErrorCode =
  | "not-installed"
  | "unsupported-response-type"
  | "decode-error"
  | "protocol-frame-error"
  | "stream-too-large"
  | "bridge-rejected"
  | "extension-context-invalidated"
  | "tap-error";

export interface SensorStreamStartEvent {
  type: "sensor.stream.start";
  requestId: string;
  ts: number;
  transport: Transport;
  endpoint: string;
  thinkingEnabled: boolean;
}

export interface SensorStreamMetaEvent {
  type: "sensor.stream.meta";
  requestId: string;
  requestMessageId?: number | string;
  responseMessageId?: number | string;
}

export interface SensorTextDeltaEvent {
  type: "sensor.text.delta";
  requestId: string;
  channel: Channel;
  text: string;
}

export interface SensorStreamEndEvent {
  type: "sensor.stream.end";
  requestId: string;
  reason: EndReason;
  ts: number;
}

export interface SensorErrorEvent {
  type: "sensor.error";
  requestId?: string;
  code: SensorErrorCode;
  message: string;
  fatal: boolean;
}

export type SensorEvent =
  | SensorStreamStartEvent
  | SensorStreamMetaEvent
  | SensorTextDeltaEvent
  | SensorStreamEndEvent
  | SensorErrorEvent;

export interface StreamSummary {
  requestId: string;
  transport: Transport;
  thinkingEnabled: boolean;
  startedAt: number;
  endedAt?: number;
  endReason?: EndReason;
  thinkingChars: number;
  answerChars: number;
}
