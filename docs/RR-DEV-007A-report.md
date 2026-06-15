# RR-DEV-007A Phase 1 工作台 UI/交互返工验收报告

日期：2026-06-15

状态：通过

## 1. 任务结论

RR-DEV-007 试点因界面和交互体验被驳回后，本轮完成 RR-DEV-007A 返工：

- Phase 1 工作台改为桌面应用式 `100dvh` 布局，整页不滚动。
- “新增项目”只保留在左侧“我的项目”标题右侧的 `+` 按钮，中央不再重复出现新增项目入口。
- 冷启动三步改为弹窗/向导：新增项目 -> 一句话生成画像 -> 编辑并确认画像。
- 左侧导航和操作按钮改用 `lucide-react` 图标，不再使用标题首字或字母按钮。
- 未实现导航项显示“待开放”并禁用，不再伪装成可用功能。
- 页面提示改为顶部居中 toast，成功为绿色，失败/警告为红色，3 秒自动消失。
- “加入知识库”完整链路验证通过，成功后显示绿色 toast；模拟失败时显示红色 toast。
- 补充项目上下文恢复：刷新页面或切换已有项目后可读回当前画像、诊断、推荐、反馈、知识库和报告。

## 2. 主要改动

- `apps/web/components/phase-one-workbench.tsx`
  - 重构主工作台结构为左侧项目栏、顶部搜索/额度、中央推荐雷达、右侧辅助面板。
  - 新增 `ToastState`、`ActiveModal`、`NavItem` 内部 UI 类型。
  - 新增画像向导和画像编辑确认弹窗。
  - 新增项目上下文恢复逻辑，调用当前画像、诊断、推荐、反馈、知识库、报告接口。
  - 修复按钮入口重复、伪图标、未完成导航误导和错误提示常驻问题。
- `apps/web/app/globals.css`
  - 改为 `100dvh` 固定工作台布局，主页面禁止整页滚动。
  - 只允许推荐列表、右侧栏、知识库/消息列表等局部区域滚动。
  - 新增 toast、紧凑面板、待开放标签、真实图标按钮和弹窗样式。
- `apps/web/lib/api.ts`
  - 新增 `api.profile(projectId)`，用于恢复已有项目画像。
- `apps/web/package.json`、`package-lock.json`
  - 新增 `lucide-react` 作为前端图标库。

## 3. 自动验收

已通过：

```text
$env:UV_CACHE_DIR='.uv-cache'; uv run pytest
14 passed, 2 skipped

$env:UV_CACHE_DIR='.uv-cache'; uv run ruff check services/api
All checks passed!

npm run lint:web
passed

npx tsc --noEmit --project apps/web/tsconfig.json
passed

npm run build
passed
```

说明：

- `pytest` 的 2 个 skipped 为预期：live retrieval 与 PostgreSQL 实机测试需要显式环境变量。
- 本机 `uv` 默认用户缓存目录存在访问限制，验收时使用项目内 `.uv-cache`。
- `npm run build` 由用户在本机 PowerShell 补跑，两次均通过，最终包体显示 `/` 为 `12.2 kB`，First Load JS `115 kB`。

## 4. 浏览器验收

环境：

- Web：`http://127.0.0.1:3000`
- API：`http://127.0.0.1:8010`
- AI：mock
- Retrieval：mock
- Email：mock

视口验收：

```text
1366x768:
bodyScrollHeight = 768
htmlScrollHeight = 768
centralAddCount = 0
navTextIcons = svg x 8

1440x900:
bodyScrollHeight = 900
htmlScrollHeight = 900
centralAddCount = 0
navTextIcons = svg x 8
futureDisabledCount = 6
```

主流程已真实点击通过：

```text
左侧 + 新增项目
-> 一句话生成画像
-> 编辑并确认画像/生成诊断
-> 生成检索
-> 推荐反馈
-> 快速分析
-> 标准研读
-> 加入知识库
-> 搜索知识库
-> 生成日报
-> 生成周报
-> 查看并标记消息已读
```

错误 toast 验收：

- 使用 Playwright route 拦截知识库新增接口并模拟 500。
- 页面显示顶部红色 toast：`请求失败，请稍后重试。`
- 该 500 为刻意模拟失败，不计入正常链路 console error。

截图证据：

- `output/playwright/rr-dev-007a-project-modal.png`
- `output/playwright/rr-dev-007a-workbench-1440.png`
- `output/playwright/rr-dev-007a-restored-1440.png`
- `output/playwright/rr-dev-007a-workbench-normal-1440.png`

## 5. 验收过程中的环境修正

- 旧的 `127.0.0.1:3000` 前端进程曾返回 500，已重启到当前代码。
- 旧的 `127.0.0.1:8010` API 进程缺少 RR-DEV-005 邮件偏好/outbox 接口，已重启到当前代码。
- 浏览器验收必须使用 mock retrieval；默认 live retrieval 会访问外部数据源，不适合作为本地 UI 验收基线。

## 6. 仍处于边界内的限制

- 左侧“雷达探索、论文追踪、项目管理、知识库、消息中心、设置”仍为待开放入口，本轮只要求禁用和不误导。
- 移动端保证不崩坏，但本轮主要验收目标为桌面端试点视口。
- 本轮不接入真实模型、真实邮件、中文数据库、机构权限、移动 App 或 Phase 2 能力。
