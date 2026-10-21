# DeepSeek 网页端 completion 协议笔记

> 记录时间：2026-10-21（Asia/Shanghai）。只记录**协议事实**，不复制任何第三方源码。
> 来源：公开项目的协议观察 + 本机浏览器 DevTools 抓帧复核：
> - `cv-superding/dsh-webin`（公开 README 与探针记录，描述 XHR、裸增量帧、THINK/RESPONSE 归属）
> - `cv-superding/dsh-deepseek-web-login`（公开 README，描述 `/api/v0/chat/completion`、PoW、SSE 两套格式）
> - 本仓库 demo 使用同构的合成帧，不依赖上述项目代码。
>
> 我们**不实现** PoW、登录、Token 捕获、请求重放。页面自己负责这些。

## 请求

- 方法/路径：`POST /api/v0/chat/completion`
- 真实页面可能使用 **XHR**（不是 fetch）。
- 请求体字段（只读其中两个）：
  - `thinking_enabled`：布尔，决定是否存在 THINK 通道；
  - `search_enabled`：布尔，仅记录。
- 鉴权头（`Authorization`、`x-hif-*`、`x-ds-pow-response`）**不读取、不记录、不存储**。

## 响应帧

标准 SSE：`data: <json>\n\n`，以 `text/event-stream` 返回。

| 帧 | 语义 | 归一化处理 |
| --- | --- | --- |
| `{"v":{"response":{"fragments":[{type,content}]}}}` | 全量快照，可能重放 | 权威重建 fragment；按已发射长度只补后缀 |
| `{"p":"response/fragments","o":"APPEND","v":[{type,content}]}` | 新 fragment | 登记 THINK/RESPONSE，切 currentIndex，flush orphan |
| `{"p":"response/fragments/-1/content","o":"APPEND","v":"..."}` | 带路径增量，`-1`=最后一片 | 追加到对应 fragment，只发新增后缀 |
| `{"v":"..."}`，无 p/o/code/data | **裸文本增量（正文主体）** | 追加到 current fragment；thinking 开启且无类型时进 orphan buffer |
| `{"p":"response/status","v":"FINISHED"}` | 正常结束 | end(finished) |
| `{"p":"response/status","v":"INCOMPLETE"}` | 不完整结束 | end(incomplete) |
| `{"code":...,"msg":...}` / `{"data":{"biz_code":...}}` | 业务错误 | error(fatal) + end(error) |
| `{"p":"response","o":"BATCH","v":...}` | 批量未知 | 忽略并计数 |
| `data: [DONE]` | 结束哨兵 | end(finished) |
| 半帧/非法 JSON | 传输截断 | 非致命 error；流结束 flush |

## fragment 归属

- `type` 大小写不敏感；`THINK` → thinking，其余 → answer。
- `-1` 表示最后一个；类型表为空时视为 0。
- 快照会重建类型表；路径帧与裸增量共享 currentIndex。
- orphan buffer 只在 `thinking_enabled === true` 且尚无 fragment 类型时启用；类型首现时归属；流结束仍无类型则归 thinking。

## 待复核项

- 是否所有账号/模型档位都使用同一帧格式（A/B 或灰度可能不同）。
- 快照重放是否存在"变短"的情况（当前只下调已发射长度，不撤回 UI）。
- `thinking_enabled` 是否总是出现在请求体（未知时不做 orphan 缓冲）。
- 真实页面是否仍在 XHR 路径（若切到 fetch，桥接已兼容）。
