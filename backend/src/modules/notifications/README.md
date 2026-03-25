# 通知服务模块详细设计

## 模块职责

- 统一处理 Webhook、短信、邮件通知任务。
- 负责签名、投递、重试、死信与投递日志。

## 核心表

- `notification.notification_tasks`
- `notification.notification_templates`
- `notification.notification_delivery_logs`
- `notification.notification_dead_letters`

## 核心接口

- `GET /admin/notifications/tasks`
- `GET /admin/notifications/tasks/:taskNo`
- `POST /admin/notifications/tasks/:taskNo/retry`
- `GET /admin/notifications/dead-letters`
- `POST /internal/notifications/webhook`

## 关键规则

- 通知使用订单快照中的回调配置。
- 投递失败必须进入重试或死信。

## 测试重点

- `mock://success` 会直接成功。
- `mock://fail` 会进入重试，最终转死信。
- 通知结果会回传订单服务。
