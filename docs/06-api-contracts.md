# 06 API 契约

版本：v0.1  
日期：2026-06-14  
状态：MVP 基线

## 1. API 原则

1. 所有接口使用 JSON。
2. 所有写接口必须校验用户权限。
3. 异步任务返回 `task_id`，由任务查询接口轮询状态。
4. 所有响应携带 `request_id`。
5. 错误响应必须包含稳定 `code`、用户可见 `message` 和可选 `details`。
6. 接口实现必须对应需求编号，便于测试追踪。

基础路径：`/api/v1`。

## 2. 通用错误格式

```json
{
  "request_id": "req_01H...",
  "error": {
    "code": "PROFILE_GENERATION_FAILED",
    "message": "研究画像生成失败，请稍后重试或补充研究方向描述。",
    "details": {
      "retryable": true,
      "task_id": "task_01H..."
    }
  }
}
```

通用错误码：

| code | HTTP | 说明 |
| --- | --- | --- |
| UNAUTHORIZED | 401 | 未登录或会话过期 |
| FORBIDDEN | 403 | 无权限 |
| NOT_FOUND | 404 | 资源不存在 |
| VALIDATION_ERROR | 422 | 输入校验失败 |
| RATE_LIMITED | 429 | 请求过于频繁 |
| QUOTA_EXHAUSTED | 402 | 用户额度不足 |
| UPSTREAM_UNAVAILABLE | 503 | 数据源或模型服务不可用 |
| TASK_FAILED | 500 | 异步任务失败 |

## 3. 认证与用户

关联需求：`RR-MVP-001`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` | 注册 |
| POST | `/auth/login` | 登录 |
| POST | `/auth/logout` | 退出 |
| GET | `/me` | 当前用户 |

`GET /me` 响应：

```json
{
  "id": "usr_123",
  "email": "user@example.com",
  "display_name": "Researcher",
  "role": "user",
  "plan": "free",
  "quota_balance": 100
}
```

## 4. 研究项目

关联需求：`RR-MVP-002`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects` | 项目列表 |
| POST | `/projects` | 创建项目 |
| GET | `/projects/{project_id}` | 项目详情 |
| PATCH | `/projects/{project_id}` | 编辑项目 |
| POST | `/projects/{project_id}:archive` | 归档项目 |

创建项目请求：

```json
{
  "name": "脱木质素竹材热压材料研究",
  "discipline": "材料科学",
  "description": "关注高碘酸钠氧化和二胺改性后的力学与界面性能。"
}
```

## 5. 研究画像

关联需求：`RR-MVP-003` 至 `RR-MVP-008`、`RR-MVP-019`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/projects/{project_id}/profile:generate` | 生成画像草稿 |
| GET | `/projects/{project_id}/profile` | 获取当前画像 |
| PATCH | `/projects/{project_id}/profile` | 修改画像 |
| POST | `/projects/{project_id}/profile:confirm` | 确认画像 |
| GET | `/projects/{project_id}/profile/versions` | 画像版本列表 |
| GET | `/projects/{project_id}/diagnosis` | 首日诊断 |

生成画像请求：

```json
{
  "one_sentence": "我研究脱木质素竹片经过高碘酸钠氧化和二胺改性后的热压材料性能。",
  "foundation_paper_ids": ["paper_1", "paper_2"],
  "material_ids": ["mat_1"]
}
```

画像响应核心结构：

```json
{
  "id": "profile_1",
  "project_id": "proj_1",
  "version": 1,
  "status": "draft",
  "research_object": ["脱木质素竹片", "生物质材料"],
  "methods": ["高碘酸钠氧化", "二胺改性", "热压"],
  "materials": ["竹材", "纤维素基材料"],
  "metrics": ["力学性能", "界面结合", "热稳定性"],
  "keywords_zh": ["脱木质素竹材", "高碘酸钠氧化", "二胺改性"],
  "keywords_en": ["delignified bamboo", "sodium periodate oxidation", "diamine modification"],
  "exclusions": ["纯木塑复合材料", "无化学改性的竹材应用"],
  "confidence": 0.78
}
```

## 6. 文件上传

关联需求：`RR-MVP-004`、`RR-MVP-005`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/projects/{project_id}/uploads` | 上传基石论文或研究材料 |
| GET | `/projects/{project_id}/uploads` | 上传文件列表 |
| GET | `/uploads/{upload_id}` | 文件解析状态 |

上传文件类型：

- `foundation_paper`。
- `research_material`。

限制：

- MVP 支持 PDF、DOCX、TXT。
- 默认单文件上限 50 MB。
- 上传后异步解析。

## 7. 检索任务与数据源

关联需求：`RR-MVP-009` 至 `RR-MVP-015`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/projects/{project_id}/search-tasks:generate` | 生成检索任务 |
| GET | `/projects/{project_id}/search-tasks` | 检索任务列表 |
| POST | `/search-tasks/{task_id}:run` | 手动运行检索任务 |
| GET | `/search-tasks/{task_id}` | 检索任务详情 |
| GET | `/papers/{paper_id}` | 文献详情 |
| GET | `/papers/{paper_id}/versions` | 文献版本 |

SearchTask 示例：

```json
{
  "id": "task_1",
  "task_type": "exact",
  "query_text": "(delignified bamboo) AND (sodium periodate oxidation) AND (diamine)",
  "language": "en",
  "filters": {
    "year_from": 2021,
    "paper_types": ["journal_article", "preprint"],
    "open_access_only": false
  },
  "status": "pending"
}
```

## 8. 推荐

关联需求：`RR-MVP-016`、`RR-MVP-017`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects/{project_id}/recommendations` | 推荐列表 |
| GET | `/recommendations/{recommendation_id}` | 推荐详情 |
| POST | `/projects/{project_id}/recommendations:refresh` | 手动刷新推荐 |

推荐列表查询参数：

- `batch_date`。
- `channel`。
- `limit`。
- `cursor`。
- `open_access_only`。

推荐响应：

```json
{
  "items": [
    {
      "id": "rec_1",
      "paper": {
        "id": "paper_1",
        "title": "Periodate oxidation of cellulose...",
        "title_zh": "纤维素高碘酸盐氧化研究",
        "year": 2024,
        "journal": "Carbohydrate Polymers",
        "doi": "10.0000/example"
      },
      "score_total": 0.86,
      "rank": 1,
      "channel": "exact",
      "explanation": {
        "topic": "研究对象与竹材/纤维素基材料相近",
        "method": "命中高碘酸钠氧化",
        "usefulness": "可作为化学改性方法参考"
      },
      "fulltext_status": "open_access"
    }
  ],
  "next_cursor": null
}
```

## 9. 用户反馈与纠偏

关联需求：`RR-MVP-018`、`RR-MVP-019`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/recommendations/{recommendation_id}/feedback` | 提交推荐反馈 |
| GET | `/projects/{project_id}/feedback` | 项目反馈列表 |
| GET | `/projects/{project_id}/radar-settings` | 雷达纠偏设置 |
| PATCH | `/projects/{project_id}/radar-settings` | 更新纠偏设置 |

反馈请求：

```json
{
  "feedback_type": "method_useful",
  "note": "材料不同，但氧化方法可借鉴。"
}
```

## 10. AI 研读

关联需求：`RR-MVP-020`、`RR-MVP-021`、`RR-MVP-022`、`RR-MVP-035`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/papers/{paper_id}/analysis` | 创建分析任务 |
| GET | `/analysis/{analysis_id}` | 获取分析结果 |
| GET | `/papers/{paper_id}/analysis` | 文献分析列表 |

分析请求：

```json
{
  "project_id": "proj_1",
  "analysis_type": "quick",
  "input_scope": "abstract"
}
```

结论结构：

```json
{
  "claim": "该研究使用高碘酸盐氧化引入醛基。",
  "fact_level": "source_explicit",
  "evidence": {
    "paper_id": "paper_1",
    "section": "Abstract",
    "quote": "short evidence snippet",
    "traceable": true
  }
}
```

## 11. 知识库

关联需求：`RR-MVP-023`、`RR-MVP-024`、`RR-MVP-025`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects/{project_id}/knowledge` | 知识库列表 |
| POST | `/projects/{project_id}/knowledge` | 添加文献到知识库 |
| PATCH | `/knowledge/{item_id}` | 更新状态、标签、备注 |
| GET | `/projects/{project_id}/knowledge:search` | 搜索知识库 |

更新请求：

```json
{
  "status": "read_later",
  "tags": ["氧化改性", "方法参考"],
  "note": "后续比较醛基含量和力学性能。"
}
```

## 12. 报告与消息

关联需求：`RR-MVP-026` 至 `RR-MVP-029`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects/{project_id}/reports` | 报告列表 |
| GET | `/reports/{report_id}` | 报告详情 |
| POST | `/projects/{project_id}/reports:generate` | 手动生成报告 |
| GET | `/messages` | 站内消息 |
| POST | `/messages/{message_id}:read` | 标记已读 |

## 13. 成本、额度和审计

关联需求：`RR-MVP-030` 至 `RR-MVP-034`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/me/quota` | 当前用户额度 |
| GET | `/me/costs` | 用户成本记录 |
| GET | `/admin/costs` | 管理员成本统计 |
| GET | `/admin/audit-logs` | 审计日志 |
| GET | `/tasks/{task_id}` | 任务状态 |
| POST | `/tasks/{task_id}:retry` | 人工重试任务 |

任务状态响应：

```json
{
  "task_id": "task_1",
  "type": "daily_retrieval",
  "status": "failed",
  "retryable": true,
  "retry_count": 2,
  "error_code": "UPSTREAM_UNAVAILABLE",
  "message": "Semantic Scholar 暂时不可用，已使用其他数据源结果。"
}
```

