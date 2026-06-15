# 03 用户流程

版本：v0.1  
日期：2026-06-14  
状态：MVP 基线

## 1. 流程总览

MVP 用户体验围绕一个主循环：

```mermaid
flowchart LR
  A["输入研究方向或上传材料"] --> B["生成研究画像"]
  B --> C["用户确认或纠偏"]
  C --> D["检索规划"]
  D --> E["多源检索"]
  E --> F["排重与标准化"]
  F --> G["个性化推荐"]
  G --> H["用户反馈"]
  H --> B
  G --> I["AI 快速分析"]
  I --> J["知识库沉淀"]
  J --> K["日报与周报"]
```

关联需求：`RR-MVP-003` 至 `RR-MVP-029`。

## 2. 冷启动流程

覆盖需求：`RR-MVP-002`、`RR-MVP-003`、`RR-MVP-004`、`RR-MVP-005`、`RR-MVP-006`、`RR-MVP-007`、`RR-MVP-008`。

```mermaid
sequenceDiagram
  actor User as 用户
  participant Web as Next.js Web
  participant API as FastAPI
  participant AI as AI Profile Worker
  participant DB as PostgreSQL
  participant Search as Retrieval Worker

  User->>Web: 创建研究项目
  Web->>API: POST /projects
  API->>DB: 保存项目
  User->>Web: 输入一句研究方向或上传材料
  Web->>API: POST /projects/{id}/profile:generate
  API->>AI: 创建画像生成任务
  AI->>DB: 写入画像草稿
  Web->>API: GET /projects/{id}/profile
  API-->>Web: 返回画像草稿
  User->>Web: 确认或修改画像
  Web->>API: PATCH /projects/{id}/profile
  API->>Search: 创建首日检索任务
  Search->>DB: 写入首批候选和推荐
  Web->>API: GET /projects/{id}/diagnosis
  API-->>Web: 返回首日诊断
```

关键体验要求：

- 用户不应先面对复杂问卷。
- 输入一句研究方向即可启动。
- 系统必须在首日返回可见结果，而不是等待第二天。
- 画像必须可编辑，不允许把 AI 判断变成不可修改结论。

失败处理：

- 如果 AI 画像失败，保留用户输入并允许重试。
- 如果数据源暂不可用，返回已有关键词和待执行任务状态。
- 如果首批推荐不足，明确说明数据不足并给出补充基石论文建议。

## 3. 每日推荐流程

覆盖需求：`RR-MVP-009`、`RR-MVP-010`、`RR-MVP-011`、`RR-MVP-012`、`RR-MVP-013`、`RR-MVP-014`、`RR-MVP-016`、`RR-MVP-017`。

```mermaid
flowchart TD
  A["读取已确认 ResearchProfile"] --> B["生成或更新 SearchTask"]
  B --> C["调用开放数据源 Adapter"]
  C --> D["SourceRecord 标准化"]
  D --> E["PaperVersion 候选"]
  E --> F["五层排重"]
  F --> G["计算推荐信号"]
  G --> H["个性化重排序"]
  H --> I["生成推荐解释"]
  I --> J["推荐列表"]
```

推荐列表展示字段：

- 中文题名。
- 原文题名。
- 作者和年份。
- 期刊或来源。
- DOI 或来源链接。
- 推荐等级。
- 推荐原因。
- 命中关键词和语义信号。
- 开放全文状态。
- 操作按钮：收藏、稍后阅读、不相关、方法可借鉴、标准研读。

失败处理：

- 某个数据源失败时，其他数据源继续运行。
- 单篇论文 AI 分析失败时，不影响推荐列表展示。
- 排重置信度不足时，保留候选并标记人工复核。

## 4. 反馈纠偏流程

覆盖需求：`RR-MVP-018`、`RR-MVP-019`。

```mermaid
flowchart LR
  A["用户反馈"] --> B["写入 UserFeedback"]
  B --> C["更新论文级行为信号"]
  B --> D["更新用户画像偏好"]
  D --> E["生成画像新版本"]
  E --> F["影响下一批检索和推荐"]
```

反馈类型：

- 非常相关。
- 方法可借鉴。
- 适合背景引用。
- 与方向无关。
- 不关注这种材料。
- 不关注这种应用。
- 希望增加此类论文。
- 加入实验计划。
- 加入写作证据库。

纠偏控制台必须展示：

- 当前重点：对象、方法、材料、机理、性能、应用。
- 当前扩展范围：上位概念、相似材料、可迁移方法、相关学科。
- 当前排除范围：用户明确不关注的材料、应用、方法或时间范围。
- 快捷调节：少推荐某类应用、增加方法论文、增加综述、只看近三年、增加高被引基础论文、只看可获取全文、扩大或缩小材料范围。

## 5. AI 研读流程

覆盖需求：`RR-MVP-020`、`RR-MVP-021`、`RR-MVP-022`、`RR-MVP-030`、`RR-MVP-031`、`RR-MVP-035`。

```mermaid
sequenceDiagram
  actor User as 用户
  participant Web as Web
  participant API as API
  participant AI as AI Analysis Worker
  participant DB as DB
  participant Cost as Cost Ledger

  User->>Web: 点击快速分析或标准研读
  Web->>API: POST /papers/{id}/analysis
  API->>Cost: 预估额度
  API->>AI: 创建分析任务
  AI->>DB: 读取论文和画像
  AI->>AI: 生成结构化分析
  AI->>AI: 校验事实分级和来源
  AI->>DB: 保存 PaperAnalysis
  AI->>Cost: 记录实际成本
  Web->>API: GET /analysis/{id}
  API-->>Web: 返回分析结果
```

快速分析输出：

- 中文题名。
- 一句话结论。
- 中文摘要。
- 相关原因。
- 推荐等级。
- 是否值得深读。

标准研读输出：

- 文献信息。
- 研究背景。
- 研究问题。
- 研究对象。
- 研究方法。
- 核心结果。
- 创新点。
- 局限性。
- 与用户课题共同点。
- 可借鉴内容。
- 不适用内容。
- 下一步阅读建议。

每条关键结论必须带事实分级：

- 原文明确说明。
- AI 归纳。
- 多文献对比。
- AI 推测。
- 研究启发。

## 6. 知识库流程

覆盖需求：`RR-MVP-023`、`RR-MVP-024`、`RR-MVP-025`。

```mermaid
flowchart LR
  A["推荐或研读结果"] --> B["收藏/已读/稍后阅读/不相关"]
  B --> C["KnowledgeItem"]
  C --> D["标签和备注"]
  C --> E["项目分类"]
  C --> F["搜索索引"]
```

MVP 知识库页面：

- 我的研究项目。
- 收藏论文。
- 稍后阅读。
- 已读论文。
- 不相关论文。
- 标签筛选。
- 搜索。
- 论文分析报告。

MVP 不实现：

- 复杂 Wiki 编辑。
- 完整知识图谱。
- 冲突结论库。
- 参数数据库。

## 7. 推送流程

覆盖需求：`RR-MVP-026`、`RR-MVP-027`、`RR-MVP-028`、`RR-MVP-029`。

```mermaid
flowchart TD
  A["每日检索和推荐完成"] --> B["生成 RadarReport"]
  B --> C["写入 Web 消息中心"]
  B --> D["发送邮件"]
  D --> E["记录发送和打开状态"]
  C --> F["用户反馈"]
  F --> G["更新推荐权重"]
```

日报必须包含：

- 今日新论文数。
- 排重后数量。
- 高相关论文。
- 建议深读论文。
- 方法启发论文。
- 核心作者动态。

周报必须包含：

- 本周高价值论文。
- 热点变化。
- 新方法。
- 知识库增长。
- 待阅读论文。
- 下周建议。

