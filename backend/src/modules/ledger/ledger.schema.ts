import { t } from 'elysia';

export const CreateProfitRuleBodySchema = t.Object({
  ruleName: t.String({ minLength: 1 }),
  channelId: t.Optional(t.String()),
  productId: t.Optional(t.String()),
  configJson: t.Record(t.String(), t.Unknown()),
});
