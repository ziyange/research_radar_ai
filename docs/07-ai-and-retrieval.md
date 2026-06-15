# 07 AI 与检索推荐

版本：v0.1  
日期：2026-06-14  
状态：MVP 基线

## 1. 设计原则

1. AI 用于理解和判断，确定性系统用于执行和记录。
2. 先用开放元数据和摘要筛选，再触发更昂贵的 AI 分析。
3. 每个 AI 输出必须结构化、可校验、可缓存。
4. 所有重要结论必须事实分级。
5. 推荐排序中，个体研究方向相关度必须高于全局热度。

## 2. 研究画像生成

关联需求：`RR-MVP-003`、`RR-MVP-006`、`RR-MVP-007`。

输入：

- 一句话研究方向。
- 1 至 3 篇基石论文。
- 开题报告、综述、计划或实验材料。
- 用户手动修正。

输出：

- 学科和细分领域。
- 研究对象。
- 研究问题。
- 研究目标。
- 方法。
- 材料。
- 试剂。
- 性能指标。
- 机理。
- 应用场景。
- 关注作者、机构、期刊。
- 中英文关键词。
- 同义词、缩写。
- 排除方向。
- 当前研究阶段。

结构化输出必须通过 JSON schema 校验。校验失败时进入重试，不得把非结构化自然语言直接写为正式画像。

## 3. 检索任务类型

关联需求：`RR-MVP-009`。

| 类型 | 目的 | 示例 |
| --- | --- | --- |
| exact | 找高度一致论文 | delignified bamboo AND sodium periodate oxidation AND diamine |
| expanded | 同义词、上下位概念扩展 | cellulose-based materials OR lignocellulosic biomass |
| method_transfer | 方法迁移 | periodate oxidation AND polymer network |
| citation_network | 基于基石论文引用网络 | cited_by、references、same_author |
| exploratory | 跨学科启发 | aldehyde-functionalized biopolymers AND hot pressing |

MVP 每个项目至少生成：

- 1 个精确检索任务。
- 1 个扩展检索任务。
- 1 个方法迁移检索任务。

引用网络检索可在基石论文有 DOI 或开放 ID 时启用。

## 4. 数据源适配器

关联需求：`RR-MVP-010`。

MVP 优先来源：

- OpenAlex。
- Crossref。
- Semantic Scholar。
- arXiv。

统一输出 SourceRecord 字段：

- 标题。
- 作者。
- 摘要。
- 关键词。
- DOI。
- 出版年份。
- 期刊或会议。
- 机构。
- 引用关系。
- 开放获取状态。
- 原文链接。
- 数据源标识。
- 许可信息。

适配器要求：

- 独立限流。
- 独立缓存。
- 独立重试。
- 独立熔断。
- 数据质量评分。
- 合规策略说明。

## 5. 排重与版本合并

关联需求：`RR-MVP-013`、`RR-MVP-014`。

五层排重：

1. 唯一标识：DOI、PMID、PMCID、arXiv ID、来源内部 ID。
2. 标准化标题：大小写、标点、空格、副标题、特殊字符归一化。
3. 作者、年份、期刊组合。
4. 标题与摘要语义相似度。
5. 全文特征或引用关系校验。

排重结果：

- 生成或关联 Paper 主实体。
- 保留所有 PaperVersion。
- 保留所有 SourceRecord。
- 记录合并置信度。
- 低置信度合并进入人工复核状态。

禁止行为：

- 不得因为重复而删除来源记录。
- 不得把同题综述和原始研究误合并。
- 不得把预印本和正式版差异覆盖丢失。

## 6. 推荐评分

关联需求：`RR-MVP-016`、`RR-MVP-017`。

推荐总分：

```text
score_total =
  0.30 * score_topic +
  0.20 * score_method +
  0.12 * score_material +
  0.10 * score_mechanism +
  0.08 * score_novelty +
  0.08 * score_quality +
  0.07 * score_user_preference +
  0.05 * score_heat
```

默认权重说明：

- 个体相关信号合计必须高于全局热度。
- `score_heat` 不得成为主要排序依据。
- 用户反馈可以调整权重，但需要有上下限。

推荐信号：

- 主题相关度。
- 方法相关度。
- 材料相关度。
- 机理相关度。
- 引用关系。
- 新颖度。
- 证据质量。
- 全局学术热度。
- 用户偏好。
- 时间衰减。

推荐解释必须包含：

- 命中的研究对象、方法、材料或性能。
- 与用户课题的关系。
- 推荐类型：高相关、方法可借鉴、背景引用、探索启发。
- 不确定性提示。

## 7. 用户反馈写回

关联需求：`RR-MVP-018`、`RR-MVP-019`。

反馈类型与影响：

| 反馈 | 影响 |
| --- | --- |
| very_relevant | 增强相似主题、材料、方法权重 |
| method_useful | 增强方法迁移通道 |
| background_citation | 增强背景引用标签，不一定提升精确通道 |
| irrelevant | 降低相似结果权重 |
| exclude_material | 加入排除材料 |
| exclude_application | 加入排除应用 |
| want_more | 增强对应标签、关键词或通道 |
| add_to_experiment | 增强实验计划相关信号 |
| add_to_writing | 增强写作证据相关信号 |

反馈写回限制：

- 单次反馈只轻微调整权重。
- 多次一致反馈才进入画像排除项。
- 用户必须能看到可编辑的纠偏结果。

## 8. AI 分析输出

关联需求：`RR-MVP-020`、`RR-MVP-021`、`RR-MVP-022`、`RR-MVP-035`。

事实分级枚举：

| 值 | 中文展示 | 说明 |
| --- | --- | --- |
| source_explicit | 原文明确说明 | 可追溯到摘要、正文或元数据 |
| ai_summary | AI 归纳 | 基于原文内容概括 |
| cross_paper_comparison | 多文献对比 | 基于多篇文献比较 |
| ai_inference | AI 推测 | 合理但未被原文直接证明 |
| research_inspiration | 研究启发 | 面向用户课题的启发或建议 |

输出约束：

- 不允许生成不存在的 DOI。
- 不允许把推测写成原文事实。
- 证据不足时必须标记 `traceable: false`。
- 引用原文片段必须短，且只用于定位证据。
- 标准研读必须记录输入范围：metadata、abstract 或 fulltext。

## 9. AI 评测集

关联需求：`RR-MVP-003`、`RR-MVP-016`、`RR-MVP-020`、`RR-MVP-035`。

MVP 评测集至少包含：

- 5 至 10 个种子研究方向。
- 每个方向 30 至 50 篇标注文献。
- 标签：高相关、方法可借鉴、背景引用、无关。
- 至少 20 条 AI 分析输出人工校验样本。
- 至少 20 条事实分级样本。

评测指标：

- 高相关论文 Top 10 命中率。
- 无关论文误推荐率。
- 方法迁移召回率。
- 推荐解释人工通过率。
- AI 事实分级准确率。
- 虚构来源数量必须为 0。

## 10. 成本策略

关联需求：`RR-MVP-030`、`RR-MVP-031`、`RR-MVP-032`。

成本优先级：

1. 元数据检索和规则过滤。
2. embedding 计算。
3. 快速 AI 分析。
4. 标准研读。
5. 全文深读，MVP 不默认开启。

缓存规则：

- 同一 Paper 的公共快速分析可复用。
- 同一项目、同一画像版本下的个性化解释可缓存。
- 用户修改画像后，旧推荐解释保留但新推荐必须绑定新画像版本。

