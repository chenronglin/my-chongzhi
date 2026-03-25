import { t } from 'elysia';

export const CreateOrderBodySchema = t.Object({
  channelOrderNo: t.String({ minLength: 1 }),
  skuId: t.String({ minLength: 1 }),
  paymentMode: t.Union([t.Literal('ONLINE'), t.Literal('BALANCE'), t.Literal('FREE')]),
  ext: t.Optional(t.Record(t.String(), t.Unknown())),
});

export const RemarkBodySchema = t.Object({
  remark: t.String({ minLength: 1 }),
});

export const MarkExceptionBodySchema = t.Object({
  exceptionTag: t.String({ minLength: 1 }),
});
