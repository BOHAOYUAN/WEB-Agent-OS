# 发布前清单（从“能跑”到“能公开”）

> 结论先行：**代码可以公开，但先跑完第 2/3 节**。仓库目前没有 remote，历史里还留着一个已作废的本地 token。

## 1. 门禁复现（每次发布前重跑）

~~~powershell
cd <仓库根目录>
npm ci
npm run verify      # 期望：全部通过（2026-10-23 实测：430 passed / 6 skipped / 48 files passed + 1 skipped），build 通过
git status --porcelain   # 期望：空
~~~

`npm run verify` 里已经包含 typecheck、lint、arch 红线扫描、单测、构建；CI（.github/workflows/verify.yml）跑同一条命令。

## 2. 密钥与机器信息扫描

~~~powershell
# 代码树里不应出现真实 token / 私钥
git grep -nE 'WebOSLocal-[0-9a-f]{8,}|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}' -- '*.ps1' '*.vbs' '*.ts' '*.mjs' '*.json' '*.md' '*.yml'

# 不应出现本机绝对路径（文档里的 <仓库根目录> 占位不算）
git grep -nE 'E:\project|C:\Users' -- '*.ps1' '*.vbs' '*.ts' '*.mjs' '*.json' '*.md' '*.yml'

# 历史里是否还有旧 token
git log --all -p | Select-String 'WebOSLocal'
~~~

判定：三条都必须 0 命中。2026-10-22 已全部清零：历史里没有旧 token，也没有个人邮箱。
`scripts/autostart.ps1` 里出现的 `WebOSLocal-` 只是新 token 的前缀拼接，不是密钥。

### 2.1 依赖审计（CI 硬门禁）

CI 对**出货依赖树**设门禁：`npm audit --omit=dev --audit-level=high`。本地复现要显式指定官方源——npmmirror 未实现 audit 端点：

~~~powershell
npm audit --omit=dev --registry=https://registry.npmjs.org --audit-level=high
~~~

`--omit=dev` 恰好等于「会被编译进产物的那批库」——前提是 `react` / `react-dom` 在 `dependencies` 里（它们**确实**被打包进 `dist/artifact-runtime-*.js`），`sucrase` 打包进 `dist/artifact-sucrase.js`：

| 包 | 去向 | 审计结果 |
|---|---|---|
| react / react-dom | `dist/artifact-runtime-*.js`（懒加载 chunk） | 0 告警 |
| sucrase | `dist/artifact-sucrase.js`（懒加载 chunk） | 0 告警 |

**开发工具链的已知告警（只报告、不阻断）**——`npm audit` 全量口径实测 6 个，全部不在产物里：

| 包 | severity | 问题 | 为什么不阻断 |
|---|---|---|---|
| vitest | critical | Vitest UI server 监听时的任意文件读 | 测试期依赖，不进产物 |
| tinypool | critical | worker options 原型污染 → RCE | vitest 的传递依赖 |
| vite | high | 依赖优化 `.map` 路径穿越 | vitest 的传递依赖 |
| esbuild | moderate | 开发服务器可被任意网站发请求 | 本项目只用 build API，从不 serve |
| @vitest/mocker / vite-node | moderate | 同链 | 同上 |

处置：暂不升级 vitest——升到 5.x 是破坏性变更，收益仅限开发期。
**风险窗口**：CI 会在不可信 PR 上跑 vitest，届时「路径穿越 + 任意文件读」是真实攻击面（能读到 runner 上的文件）。因此**私有仓库 + 限制 PR 来源**比升级 vitest 更实际；若将来要开公开 PR，应先升级 vitest。

## 3. 历史卫生（2026-10-22 已完成）

状态：**已完成**。旧 token 与个人 gmail 都已从全部历史移除，所有提交作者统一为 `BOHAOYUAN <BOHAOYUAN@users.noreply.github.com>`；
重写前的完整备份放在仓库外：`E:\project\webos-agent-backup-20261022.bundle`（`git bundle create --all`，可用 `git clone <bundle>` 恢复）。
代价是所有提交 hash 变化；文档已不引用短 hash，因此没有失效引用。仓库本地 `user.email` 也改成了 noreply。

以后万一再泄漏（例如误提交了新 token），照这个流程再来一次：

~~~powershell
python -m pip install --user git-filter-repo
git bundle create ..\webos-backup.bundle --all
Set-Content replacements.txt (<泄漏值> + '==>***REDACTED***')
python -m git_filter_repo --replace-text replacements.txt --force
git log --all -p | Select-String '<泄漏值>'   # 期望 0 条
~~~

## 4. 截图与文档审查

- [x] `docs/captures/*.png` 逐张看过：目前 3 张都只有侧边栏 UI，无账号、邮箱、真实对话内容（2026-10-22 已人工确认）
- [ ] 新增截图命名为 `real-*.png` 时，确认浏览器标签栏/头像已打码
- [x] 干净目录 clone → `npm ci` → `npm run verify` 已通过（2026-10-22，28 个提交）；「加载 dist 扩展」一步仍需人工在干净浏览器里做
- [x] `docs/roadmap.md`、`docs/stage2-acceptance-report.md` 状态与代码一致（2026-10-22 已刷新）

## 5. 仓库元数据（GitHub 上）

- [ ] About：一句话定位 + topics（chrome-extension, ai-agent, browser-automation, typescript, mv3）
- [ ] LICENSE：MIT（已在仓库里）
- [x] SECURITY.md：已改为 GitHub Private vulnerability reporting（不再写邮箱）
- [ ] README 顶部已有 version / license / tests 三个 badge；CI badge 的占位注释在公开后换成真实链接
- [ ] 把 `.github/ISSUE_TEMPLATE/config.yml` 里的 `OWNER` 换成真实 GitHub owner
- [ ] .github/workflows/verify.yml 首次 push 后必须绿

## 6. 发布步骤

~~~powershell
# 二选一：装了 gh 就直接建；否则网页建空仓库再 add remote
gh repo create Web-OS-Agent --public --source . --remote origin --push
# 或：git remote add origin git@github.com:<user>/Web-OS-Agent.git; git push -u origin main
git tag -a v0.1.0 -m 'v0.1.0: sensor/router/actor/memory/artifacts'
git push origin v0.1.0
~~~

## 7. 发布后 24 小时

- [ ] 用另一台机器/新目录 `git clone` → `npm ci` → `npm run verify` 全绿
- [ ] 按 README Quickstart 从零装一次扩展（不要复用已有 profile）
- [ ] Issue 模板/行为准则按需补（可选）

## 8. 永远不要公开

- 真实对话内容、Cookie / Authorization / PoW 头、任何账号截图；
- `%LOCALAPPDATA%\WebOSAgent\` 下的任何文件（token.txt / extension-id.txt / autostart.log）；
- 本机绝对路径、个人目录截图、VPS/代理配置。