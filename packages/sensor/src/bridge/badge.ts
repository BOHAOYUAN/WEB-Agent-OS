/**
 * Minimal page-level status badge, rendered in a closed shadow root so the host
 * page's CSS cannot leak in. It is the first visual proof that the sensor is
 * injected; it never contains conversation content.
 */
export class SensorBadge {
  private host: HTMLDivElement | null = null;
  private label: HTMLSpanElement | null = null;
  private streams = 0;
  private state: "on" | "off" = "on";

  mount(): void {
    if (this.host) return;
    try {
      const host = document.createElement("div");
      host.setAttribute("data-webos-sensor", "badge");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText =
        "position:fixed;right:14px;bottom:14px;z-index:2147483647;pointer-events:none;user-select:none;";

      const shadow = host.attachShadow({ mode: "closed" });
      const box = document.createElement("div");
      box.style.cssText =
        "font:12px/1.4 ui-monospace,Consolas,monospace;color:#e6edf3;background:rgba(13,17,23,.88);" +
        "border:1px solid rgba(88,166,255,.45);border-radius:8px;padding:4px 8px;" +
        "box-shadow:0 2px 10px rgba(0,0,0,.35);white-space:nowrap;";

      const label = document.createElement("span");
      box.append(label);
      shadow.append(box);
      this.label = label;
      this.host = host;
      this.render();

      const attach = (): void => {
        if (!this.host || this.host.isConnected) return;
        if (document.documentElement) document.documentElement.appendChild(this.host);
      };
      if (document.documentElement) attach();
      else document.addEventListener("DOMContentLoaded", attach, { once: true });
    } catch {
      // The badge is optional; never break the page for it.
    }
  }

  setOnline(streams: number): void {
    this.state = "on";
    this.streams = streams;
    this.render();
  }

  setOffline(): void {
    this.state = "off";
    this.render();
  }

  setStreams(streams: number): void {
    this.streams = streams;
    this.render();
  }

  dispose(): void {
    this.host?.remove();
    this.host = null;
    this.label = null;
  }

  private render(): void {
    if (!this.label) return;
    const suffix = this.streams === 1 ? "stream" : "streams";
    this.label.textContent = `Web-OS Sensor · ${this.state} · ${this.streams} ${suffix}`;
  }
}
