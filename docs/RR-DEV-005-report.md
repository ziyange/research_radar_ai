# RR-DEV-005 报告、站内消息与邮件推送验收

## Scope

- 覆盖 `RR-MVP-026` 至 `RR-MVP-029`。
- 日报生成后包含新增论文、排重数、高相关论文、建议深读和方法启发。
- 周报生成后包含高价值论文、趋势、知识库增长、反馈变化和下周建议。
- 报告生成同时发布站内消息，消息可查看并标记已读。
- 邮件推送当前处于 MVP dev/mock outbox 边界：不接真实 SMTP 或第三方邮件服务，但记录收件人、报告 ID、发送状态、失败原因和退订状态。

## API Additions

- `GET /api/v1/me/email-preference`
- `POST /api/v1/me/email:unsubscribe`
- `POST /api/v1/me/email:subscribe`
- `GET /api/v1/me/email-outbox`

`POST /api/v1/projects/{project_id}/reports:generate?report_type=daily` 和 `weekly` 保持原路径，并在生成报告后同步创建站内消息与 mock 邮件 outbox 记录。

## Email Boundary

真实邮件服务未接入，仍在 MVP dev/mock 边界内。后端已预留配置：

- `EMAIL_PROVIDER=mock|smtp|api`
- `EMAIL_FROM`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_USE_TLS`
- `EMAIL_MOCK_FORCE_FAILURE`

mock 规则：普通邮箱写入 `sent` 状态；邮箱地址包含 `fail` 或开启 `EMAIL_MOCK_FORCE_FAILURE` 时写入 `failed` 状态和失败原因。用户退订后不再生成 email outbox 任务，但仍生成报告和站内消息。

## Verification

- 新增 `services/api/tests/test_reports_notifications.py` 覆盖日报、周报、邮件失败、退订和站内消息已读。
- 前端工作台新增日报/周报查看、邮件 outbox 状态展示和退订入口。
