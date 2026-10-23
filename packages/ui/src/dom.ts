/**
 * Minimal DOM helpers for the side panel.
 *
 * `el()` exists so panel code can build nodes without ever touching
 * `innerHTML`: every piece of model output reaches the DOM as `textContent`,
 * which is the red line that keeps untrusted artifact code as text instead of
 * markup. It was copy-pasted into three components before this module existed;
 * one copy means one place to keep that promise.
 */

/**
 * Create an element.
 *
 * `text` is assigned via `textContent` — never `innerHTML`. `className` is
 * omitted entirely when not provided, so the element keeps the default
 * `class` attribute rather than an empty one.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
