# 架构（Step 1）

## 模块与依赖

```text
shared  ← sensor, router, actor, ui, apps
sensor  ✗→ router/actor/ui
router  ✗→ sensor/actor/ui
actor   ✗→ sensor/router/ui
ui      ✗→ sensor/router/actor
apps    → 唯一组装层
```

`packages/shared` 是唯一契约层，只允许纯类型和纯函数，不允许 `chrome.*`、DOM、Node API。跨层通信只使用 `shared` 中声明的消息类型。`scripts/arch-check.mjs` 会强制检查。

## 数据流

1. **sensor-main（MAIN world，document_start）**
   - patch `XMLHttpRequest.prototype.open/send` 与 `window.fetch`；
   - 只识别 `/api/v0/chat/completion`；
   - 请求体只提取 `thinking_enabled` / `search_enabled`；
   - 把原始文本 chunk 通过 `window.postMessage` 发给 bridge。
2. **sensor-bridge（ISOLATED world，页面级生命周期）**
   - 校验 envelope（源、同源、nonce、pageSessionId、schema）；
   - `SseDecoder` 分帧；
   - `DeepSeekNormalizer` 把快照/路径增量/裸增量归一成 `sensor.text.delta`；
   - `coalesceEvents` 合并后每 32ms 批量发往 Service Worker；
   - 维护原始帧环形缓冲（仅 dev 构建可导出）。
3. **background（MV3 Service Worker）**
   - 校验 sender tab/url；
   - 按 tab 维护环形缓冲（4000 事件 / 1.5M 字符）；
   - 通过 port 广播给侧边栏；
   - `chrome.storage.session` 防 SW 回收丢状态；
   - **Router 的挂载点**（Step 1 不启用）。
4. **sidepanel**
   - 只读调试视图；文本全部用 `textContent` 渲染，避免 XSS；
   - 支持原始帧导出。

## 关键决策

| 决策 | 原因 |
| --- | --- |
| MAIN world + `document_start` | 页面首个 completion 请求之前装上钩子；解决"注入太晚抓不到"的时序问题 |
| 归一化放 bridge，不放 SW | bridge 与页面同生命周期；SW 会被回收，长流状态会丢 |
| XHR 为主、fetch 为辅 | 真实 DeepSeek 页面使用 XHR；fetch 用于兼容/未来站点 |
| 只读 | Step 1 不引入请求改写风险；Router 阶段再带开关做 |
| 快照按"已发射长度"补后缀 | 服务端会重放快照，直接 append 会重复吐字 |
| 未知帧忽略 + 计数 | 协议漂移时优先保证页面不崩、流不断 |
