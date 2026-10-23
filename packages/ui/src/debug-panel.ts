import type { SensorEvent, UiMessage, UiSessionSnapshot } from "@webos/shared";
import { el } from "./dom.js";

export interface DebugPanelOptions {
  onDump: () => Promise<unknown | null>;
  onClear: () => void;
  onToggleInject?: (enabled: boolean) => void;
  injectEnabled?: boolean;
}

export interface DebugPanel {
  apply(message: UiMessage): void;
  clear(): void;
  setInjectEnabled(enabled: boolean): void;
  dispose(): void;
}

interface SessionState {
  tabId: number;
  pageSessionId: string;
  events: SensorEvent[];
  updatedAt: number;
}

const MAX_RENDERED_EVENTS = 200;

function time(value: number): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function deltaText(event: Extract<SensorEvent, { type: "sensor.text.delta" }>): string {
  return `[${event.channel}] ${event.text}`;
}

export function mountDebugPanel(root: HTMLElement, options: DebugPanelOptions): DebugPanel {
  const sessions = new Map<string, SessionState>();
  const openSessions = new Set<string>();
  const header = el("header", "ws-header");
  const title = el("div", "ws-title", "Web-OS-Agent · Sensor Debug");
  const subtitle = el("div", "ws-subtitle", "只读观察 · 原始帧导出仅开发构建");
  const titleBox = el("div", "ws-titlebox");
  titleBox.append(title, subtitle);
  const actions = el("div", "ws-actions");
  const dumpButton = el("button", "ws-button", "导出原始帧");
  const clearButton = el("button", "ws-button ws-button-ghost", "清空");
  actions.append(dumpButton, clearButton);
  header.append(titleBox, actions);

  let injectToggle: HTMLInputElement | null = null;
  if (options.onToggleInject) {
    const label = el("label", "ws-toggle-label");
    injectToggle = el("input", "ws-toggle");
    injectToggle.type = "checkbox";
    injectToggle.checked = options.injectEnabled ?? false;
    injectToggle.addEventListener("change", () => {
      options.onToggleInject?.(injectToggle?.checked ?? false);
    });
    label.append(injectToggle, document.createTextNode("人设注入（下一轮生效）"));
    actions.prepend(label);
  }

  const status = el("div", "ws-status", "等待页面流…");
  const list = el("div", "ws-sessions");
  root.replaceChildren(header, status, list);

  let renderTimer: number | null = null;
  let disposed = false;

  const scheduleRender = (): void => {
    if (disposed || renderTimer !== null) return;
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      render();
    }, 80);
  };

  const setStatus = (text: string, kind: "idle" | "ok" | "warn" = "idle"): void => {
    status.textContent = text;
    status.dataset.kind = kind;
  };

  const sessionKey = (tabId: number, pageSessionId: string): string => `${tabId}:${pageSessionId}`;

  const upsert = (tabId: number, pageSessionId: string, events: SensorEvent[], updatedAt: number): void => {
    const key = sessionKey(tabId, pageSessionId);
    const existing = sessions.get(key);
    if (existing) {
      existing.events.push(...events);
      if (existing.events.length > 4000) existing.events.splice(0, existing.events.length - 4000);
      existing.updatedAt = updatedAt;
    } else {
      sessions.set(key, { tabId, pageSessionId, events: [...events], updatedAt });
    }
  };

  const applySnapshot = (snapshot: UiSessionSnapshot[]): void => {
    sessions.clear();
    for (const session of snapshot) {
      sessions.set(sessionKey(session.tabId, session.pageSessionId), {
        tabId: session.tabId,
        pageSessionId: session.pageSessionId,
        events: [...session.events],
        updatedAt: session.updatedAt,
      });
    }
    scheduleRender();
  };

  const apply = (message: UiMessage): void => {
    if (disposed) return;
    if (message.kind === "webos/ui.snapshot") {
      applySnapshot(message.sessions);
      setStatus(`已连接 · ${message.sessions.length} 个页面会话`, "ok");
      return;
    }
    if (message.kind === "webos/ui.batch") {
      upsert(message.tabId, message.batch.pageSessionId, message.batch.events, Date.now());
      setStatus(`已连接 · ${sessions.size} 个页面会话`, "ok");
      scheduleRender();
    }
  };

  const render = (): void => {
    if (disposed) return;
    const ordered = [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    list.replaceChildren();
    if (ordered.length === 0) {
      list.append(el("div", "ws-empty", "还没有收到 completion 流。打开 chat.deepseek.com 并发送一条消息。"));
      return;
    }

    for (const session of ordered) {
      const key = sessionKey(session.tabId, session.pageSessionId);
      const card = el("section", "ws-card");
      const start = session.events.find((event) => event.type === "sensor.stream.start");
      const end = [...session.events].reverse().find((event) => event.type === "sensor.stream.end");
      const errors = session.events.filter((event) => event.type === "sensor.error");
      const answerChars = session.events.reduce(
        (sum, event) => (event.type === "sensor.text.delta" && event.channel === "answer" ? sum + event.text.length : sum),
        0,
      );
      const thinkingChars = session.events.reduce(
        (sum, event) => (event.type === "sensor.text.delta" && event.channel === "thinking" ? sum + event.text.length : sum),
        0,
      );

      const cardHeader = el("div", "ws-card-header");
      const cardTitle = el("div", "ws-card-title");
      cardTitle.append(
        el("span", "ws-tag", `tab ${session.tabId}`),
        el("span", "ws-mono", shortId(session.pageSessionId)),
        el("span", "ws-tag", start?.type === "sensor.stream.start" ? start.transport : "unknown"),
        el("span", "ws-tag", start?.type === "sensor.stream.start" && start.thinkingEnabled ? "thinking on" : "thinking off"),
      );
      const stateBadge = el(
        "span",
        `ws-state ${end ? (end.reason === "finished" ? "ws-state-ok" : "ws-state-warn") : "ws-state-live"}`,
        end ? end.reason : start ? "streaming" : "unknown",
      );
      cardHeader.append(cardTitle, stateBadge);

      const metrics = el(
        "div",
        "ws-metrics",
        `answer ${answerChars} chars · thinking ${thinkingChars} chars · ${session.events.length} events` +
          (errors.length > 0 ? ` · ${errors.length} error(s)` : ""),
      );

      const details = el("details", "ws-details");
      details.open = openSessions.has(key);
      details.addEventListener("toggle", () => {
        if (details.open) openSessions.add(key);
        else openSessions.delete(key);
      });
      const summary = el("summary", "ws-summary", `查看事件（最近 ${Math.min(session.events.length, MAX_RENDERED_EVENTS)} 条）`);
      const eventList = el("div", "ws-events");
      for (const event of session.events.slice(-MAX_RENDERED_EVENTS)) {
        const row = el("div", `ws-event ws-event-${event.type.replaceAll(".", "-")}`);
        const stamp = el("span", "ws-event-time", time("ts" in event ? event.ts : Date.now()));
        const type = el("span", "ws-event-type", event.type.replace("sensor.", ""));
        const detail = el("span", "ws-event-detail");
        if (event.type === "sensor.text.delta") detail.textContent = deltaText(event);
        else if (event.type === "sensor.stream.start")
          detail.textContent = `${event.transport} ${event.endpoint} thinking=${String(event.thinkingEnabled)}`;
        else if (event.type === "sensor.stream.meta")
          detail.textContent = `request=${String(event.requestMessageId ?? "-")} response=${String(event.responseMessageId ?? "-")}`;
        else if (event.type === "sensor.stream.end") detail.textContent = event.reason;
        else if (event.type === "sensor.user.prompt") detail.textContent = `用户：${event.text}`;
        else detail.textContent = `${event.code}${event.fatal ? " (fatal)" : ""} ${event.message}`;
        row.append(stamp, type, detail);
        eventList.append(row);
      }
      details.append(summary, eventList);
      card.append(cardHeader, metrics, details);
      list.append(card);
    }
  };

  dumpButton.addEventListener("click", () => {
    dumpButton.disabled = true;
    setStatus("正在导出原始帧…");
    void (async () => {
      try {
        const payload = await options.onDump();
        if (payload === null) {
          setStatus("没有可导出的数据（需要开发构建且捕获到流）", "warn");
          return;
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `webos-sensor-capture-${Date.now()}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setStatus("原始帧已导出：请检查其中是否含敏感内容后再提交", "ok");
      } catch (error) {
        setStatus(`导出失败：${error instanceof Error ? error.message : String(error)}`, "warn");
      } finally {
        dumpButton.disabled = false;
      }
    })();
  });

  clearButton.addEventListener("click", () => {
    sessions.clear();
    openSessions.clear();
    render();
    options.onClear();
    setStatus("已清空本地调试视图", "idle");
  });

  render();

  return {
    apply,
    clear(): void {
      sessions.clear();
      openSessions.clear();
      render();
    },
    setInjectEnabled(enabled: boolean): void {
      if (injectToggle) injectToggle.checked = enabled;
    },
    dispose(): void {
      disposed = true;
      if (renderTimer !== null) clearTimeout(renderTimer);
      root.replaceChildren();
    },
  };
}
