# RR-DEV-007B 工作台信息架构与运行时修复报告

## 目标

本轮承接用户对 RR-DEV-007A 的追加驳回意见，修复 Phase 1 工作台仍存在的信息架构不清、入口重复、空项目状态不正确，以及浏览器运行时报错问题。

## 用户问题与处理

1. 顶部搜索用途不清晰  
   - 已移除全局顶栏搜索。
   - 搜索/筛选能力仅保留在当前项目的“项目推荐列表”面板内，语义为筛选推荐与知识库，不再伪装为全站搜索。

2. “推荐雷达”和导航栏“雷达探索”容易重复  
   - 中央主面板从“推荐雷达”改为“项目推荐列表”。
   - “雷达探索”保留为未来一级模块，当前禁用并标记“待开放”。
   - Phase 1 工作台只展示当前项目内的推荐闭环，不再和未来探索模块抢概念。

3. “项目管理”和“我的项目”重复  
   - 左侧一级导航移除“项目管理”。
   - 左侧项目区改名为“当前项目”，并在视觉上挂在“研究工作台”之下。
   - 信息架构定义为：导航栏是一级产品模块，当前项目是“研究工作台”下的二级上下文。

4. 空项目状态错误  
   - 不再自动弹出新增项目弹窗。
   - 无项目时中央显示空状态：“当前没有项目”，提示用户使用左侧“当前项目”旁的加号添加课题。
   - 中央区域不显示伪造的“尚未选择项目”工作台内容。

5. 功能入口重复  
   - 新增项目入口只保留左侧“当前项目”旁的 `+`。
   - 中央主区不再出现“新增项目/创建研究项目”入口。

6. `__webpack_modules__[moduleId] is not a function`  
   - 验收中复现到客户端 hydration 失效，相关资源表现为 Next dev chunk 404。
   - 根因判断为 dev server 与 `next build` 共用 `.next` 目录后，浏览器拿到的 HTML 与实际 chunk 不一致。
   - 已新增 `apps/web/scripts/clean-next-cache.mjs`，并将 `apps/web` 的 `dev` 脚本改为先清理 Next dev/build 产物再启动。
   - Windows 下如 `.next` 被其它进程锁定，脚本会重试并给出警告，不会直接中断开发服务。

## 修改文件

- `apps/web/components/phase-one-workbench.tsx`
  - 调整导航命名与禁用状态。
  - 移除“项目管理”一级入口。
  - 新增空项目工作区。
  - 移除顶部全局搜索，新增项目内筛选。
  - 将“推荐雷达”改为“项目推荐列表”。
  - 为紧凑报告按钮补充 `aria-label="生成日报"` 与 `aria-label="生成周报"`。

- `apps/web/app/globals.css`
  - 补充“研究工作台/当前项目”的层级样式。
  - 新增顶部上下文标题、空项目卡片、项目内筛选控件样式。
  - 保持桌面工作台整页不滚动，列表与面板内部滚动。

- `apps/web/package.json`
  - `dev` 脚本改为 `node scripts/clean-next-cache.mjs && next dev`。

- `apps/web/scripts/clean-next-cache.mjs`
  - 新增 Next dev/build 缓存清理脚本，降低 build 后继续 dev 时的 stale chunk 风险。

## 浏览器验收

环境：

- URL：`http://127.0.0.1:3000`
- API：`http://127.0.0.1:8010`
- 视口：`1440x900`
- 数据库：mock / memory
- Browser plugin：不可用，使用 Playwright Chromium fallback

空项目态验收结果：

- 页面标题为“研知雷达 Research Radar AI”。
- 页面显示“当前没有项目”。
- 页面显示“请使用左侧‘当前项目’旁的加号添加课题。”
- 顶栏输入框数量为 0。
- 项目推荐列表筛选框数量为 0。
- 不显示“项目管理”。
- “雷达探索”为禁用待开放。
- 中央区域新增项目入口数量为 0。
- 无 Next error overlay。
- 无整页滚动。

完整主流程验收路径：

创建项目 -> 一句话生成画像 -> 编辑/确认画像 -> 生成诊断 -> 生成检索 -> 获取推荐 -> 高度相关反馈 -> 快速分析 -> 标准研读 -> 加入知识库 -> 搜索知识库 -> 生成日报 -> 生成周报。

主流程验收结果：

- 控制台无 React error、hydration error、未捕获 promise error。
- 网络无 chunk 404 或 API 失败。
- `加入知识库` 成功返回绿色 toast：“论文已加入知识库。”
- `标准研读` 成功返回绿色 toast：“标准研读已完成并记录成本。”
- 工作台面包屑显示“研究工作台 / 当前项目”。
- 中央主面板显示“项目推荐列表”。
- 顶栏输入框数量为 0。
- 项目内筛选框数量为 1。
- 不显示“项目管理”。
- 中央区域新增项目入口数量为 0。
- 无 Next error overlay。
- 无整页滚动。

截图：

- `output/playwright/rr-dev-007b-empty-state.png`
- `output/playwright/rr-dev-007b-workspace.png`

## 自动验收命令

- `uv run pytest`：14 passed, 2 skipped
- `uv run ruff check services/api`：passed
- `npm run lint:web`：passed
- `npx tsc --noEmit --project apps/web/tsconfig.json`：passed
- `npm run build`：passed，由用户在 PowerShell 中补跑确认

## 结论

RR-DEV-007B 验收通过。本轮没有扩大 Phase 1 范围，没有进入 Phase 2，也没有接入真实模型、真实邮件、中文数据库或机构能力。
