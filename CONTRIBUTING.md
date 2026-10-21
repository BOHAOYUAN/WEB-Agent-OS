# Contributing

## 代码来源纪律（硬性）

- **禁止**整段复制第三方项目代码、注释、文件结构。
- 允许阅读公开文档/协议描述，提取**协议事实**，然后从零实现并写自己的测试。
- 任何借鉴都要在 PR 描述里写清楚：来源、借鉴的是"事实/思路"还是代码；代码必须兼容本项目 MIT。
- 协议笔记放 `docs/protocol-deepseek.md`，标注日期与来源。

## 开发

```bash
npm ci
npm run verify
```

- 每个包只依赖 `@webos/shared`（apps 除外）；`npm run arch` 会拦截越界依赖和红线字符串。
- 新协议帧先加 fixture，再改归一化；测试必须覆盖任意 chunk 切分。
- 提交信息用 `feat:` / `fix:` / `docs:` / `test:` / `chore:`。

## 红线

见 README。涉及凭证、登录、PoW、请求重放的 PR 一律拒绝。
