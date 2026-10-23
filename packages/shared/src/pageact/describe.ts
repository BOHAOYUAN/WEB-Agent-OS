/**
 * Human-readable wording for the PageAct contract.
 *
 * These are pure text mappings over contract values, and they live in
 * `@webos/shared` because four parties need the same sentence: the side
 * panel shows it to the user, the confirmation prompt and the audit trail
 * quote it, and a wording that differed between them would be a bug.
 */

import type { PageAction, PageDanger } from "../types/page-act.js";

/**
 * One-line Chinese summary of an action.
 *
 * The value is truncated: a confirmation dialog that pastes 1000 characters
 * of model text into the screen is not a confirmation, it is a wall.
 */
export function describeAction(action: PageAction): string {
  const short = (text: string, limit = 40): string =>
    text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  switch (action.kind) {
    case "click":
      return `点击 ${action.selector}`;
    case "fill":
      return `在 ${action.selector} 中填入「${short(action.value, 24)}」`;
    case "scroll":
      return action.to === "top" || action.to === "bottom"
        ? `滚动到${action.to === "top" ? "顶部" : "底部"}`
        : `滚动到 ${action.to.selector}`;
    case "extract":
      return `读取 ${action.selector} 的${action.as === "table" ? "表格" : "文本"}`;
    case "waitFor":
      return `等待 ${action.selector} 出现（${action.timeoutMs}ms）`;
    case "nextPage":
      return `翻页：点击 ${action.selector}`;
    case "export":
      return "把已抓取的数据导出为 CSV 下载";
    default:
      return "未知动作";
  }
}

/** Human wording for a danger kind. */
export function describeDanger(danger: PageDanger): string {
  switch (danger) {
    case "download":
      return "会触发文件下载";
    case "submit":
      return "会提交表单";
    case "credential":
      return "会写入密码或卡片信息";
    case "destructive":
      return "会删除或覆盖内容";
    default:
      return "存在未知风险";
  }
}
