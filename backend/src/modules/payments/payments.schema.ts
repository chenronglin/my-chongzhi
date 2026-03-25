import { t } from 'elysia';

export const CreatePaymentBodySchema = t.Object({
  orderNo: t.String(),
  channelId: t.String(),
  amount: t.Number({ minimum: 0 }),
  paymentMode: t.Union([t.Literal('ONLINE'), t.Literal('BALANCE'), t.Literal('FREE')]),
});

export const RefundBodySchema = t.Object({
  orderNo: t.String(),
  refundNo: t.String(),
  reason: t.Optional(t.String()),
});

export const MockPaymentCallbackBodySchema = t.Object({
  paymentNo: t.String(),
  status: t.Union([t.Literal('SUCCESS'), t.Literal('FAIL')]),
  thirdTradeNo: t.Optional(t.String()),
});
