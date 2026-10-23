/**
 * Explaining a code-only render plan to the user.
 *
 * Both the artifact list and the canvas have to say WHY an artifact is shown
 * as read-only code instead of being rendered, and the wording used to live in
 * each of them — where it had already drifted: the list said "只读代码，不执行"
 * while the canvas said "该语言不支持渲染". One sentence, one place.
 *
 * The text is derived from the plan's `reason` — a fixed enum — never from
 * the artifact's content, so model output can never reach this string.
 */

import type { ArtifactRenderPlan } from "@webos/shared";

/**
 * The user-facing explanation for a render plan.
 *
 * For a `code` plan this is the reason it was downgraded ("代码过大…" /
 * "JSX 运行时未加载…" / "该语言不支持渲染…"). A `render` plan needs no
 * explanation, so it yields an empty string — callers show this only when the
 * plan is code-only.
 */
export function describeRenderPlan(plan: ArtifactRenderPlan): string {
  if (plan.kind === "render") return "";
  switch (plan.reason) {
    case "too-large":
      return "代码过大，仅展示代码";
    case "react-runtime-missing":
      return "JSX 运行时未加载，仅展示代码";
    case "unsupported-language":
      return "该语言不支持渲染，仅展示代码";
    default:
      // `truncated` is only ever set together with "too-large", but the flag is
      // what the size cap actually reports — keep it authoritative.
      return plan.truncated ? "代码过大，仅展示代码" : "仅展示代码";
  }
}
