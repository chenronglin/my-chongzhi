# 支付服务模块详细设计

## 模块职责

- 维护支付通道、支付单、支付回调与退款记录。
- 为订单服务提供余额支付与模拟第三方支付能力。

## 核心表

- `payment.payment_channels`
- `payment.payment_orders`
- `payment.payment_callback_logs`
- `payment.payment_refunds`

## 核心接口

- `GET /admin/payment-channels`
- `GET /admin/payment-orders`
- `POST /internal/payments/create`
- `POST /internal/payments/balance-pay`
- `POST /internal/payments/refund`
- `POST /callbacks/payments/mock`

## 关键规则

- 一张支付单只允许一个有效成功结果。
- 支付回调必须先验状态、再幂等、后发布事件。

## 测试重点

- 余额支付成功会直接推进订单。
- 第三方回调重复到达不会重复推进订单。
- 退款成功会发布退款成功事件。
