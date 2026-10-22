# 发布前清单（从“能跑”到“能公开”）

> 结论先行：**代码可以公开，但先跑完第 2/3 节**。仓库目前没有 remote，历史里还留着一个已作废的本地 token。

## 1. 门禁复现（每次发布前重跑）

~~~powershell
cd <仓库根目录>
npm ci
npm run verify      # 期望：248 passed / 6 skipped / 31 files passed + 1 skipped，build 通过
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

判定：前两条必须 0 命中（`git grep` 无匹配时退出码为 1，属正常）；第三条目前会命中旧 token，按第 3 节清零。
`scripts/autostart.ps1` 里出现的 `WebOSLocal-` 只是新 token 的前缀拼接，不是密钥。

## 3. 历史里的旧 token（可选，但建议在首次 push 前做）

现状：2026-10-22 生成的那个旧 token 仍留在 git 历史里（`git log -p | Select-String WebOSLocal` 能命中；HEAD 已无）。
`%LOCALAPPDATA%\WebOSAgent\token.txt` 生成），没有真实风险，但会让 secret scanner 报警、观感差。

已在本机验证过的清理流程（22 个提交、0.7 秒、清理后历史与 HEAD 均为 0 命中）：

~~~powershell
python -m pip install --user git-filter-repo
$tmp = Join-Path $env:TEMP 'webos-scrub-test'
git clone --no-local <仓库根目录> $tmp          # 先在副本上确认结果
Push-Location $tmp
Set-Content replacements.txt (<旧 token> + '==>***REDACTED***')   # 旧值从 git log 里复制，别写回仓库
python -m git_filter_repo --replace-text replacements.txt --force
git log --all -p | Select-String 'WebOSLocal'   # 期望 0 条
Pop-Location
~~~

确认无误后对真实仓库重复：**先打备份 bundle**（`git bundle create ..\webos-backup.bundle --all`），再在仓库里执行同样三条命令。
代价：所有提交 hash 变化（文档已改为引用提交标题，不再引用短 hash，故不受影响）。

## 4. 截图与文档审查

- [ ] `docs/captures/*.png` 逐张看过：目前 3 张都只有侧边栏 UI，无账号、邮箱、真实对话内容（本轮已人工确认）
- [ ] 新增截图命名为 `real-*.png` 时，确认浏览器标签栏/头像已打码
- [ ] README 的 Quickstart 在一台“干净目录”里走过一遍（clone → npm ci → verify → 加载 dist）
- [ ] `docs/roadmap.md`、`docs/stage2-acceptance-report.md` 状态与代码一致（本轮已刷新）

## 5. 仓库元数据（GitHub 上）

- [ ] About：一句话定位 + topics（chrome-extension, ai-agent, browser-automation, typescript, mv3）
- [ ] LICENSE：MIT（已在仓库里）
- [ ] SECURITY.md：补一个真实可用的联系方式（当前写“维护者邮箱”，发布前填）
- [ ] README 顶部 TODO(badges) 在 CI 首绿后替换为 badge + demo GIF
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
