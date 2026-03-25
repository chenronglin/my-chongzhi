export const paymentsSql = {
  listChannels: `
    SELECT
      id,
      channel_code AS "channelCode",
      channel_name AS "channelName",
      provider_type AS "providerType",
      config_json AS "configJson",
      status
    FROM payment.payment_channels
    ORDER BY created_at DESC
  `,
  listOrders: `
    SELECT
      id,
      payment_no AS "paymentNo",
      order_no AS "orderNo",
      channel_id AS "channelId",
      payment_channel_code AS "paymentChannelCode",
      pay_amount AS "payAmount",
      currency,
      status,
      payment_mode AS "paymentMode",
      third_trade_no AS "thirdTradeNo",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      paid_at AS "paidAt"
    FROM payment.payment_orders
    ORDER BY created_at DESC
  `,
} as const;
