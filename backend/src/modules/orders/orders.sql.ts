export const ordersSql = {
  listOrders: `
    SELECT
      id,
      order_no AS "orderNo",
      channel_order_no AS "channelOrderNo",
      channel_id AS "channelId",
      parent_channel_id AS "parentChannelId",
      product_id AS "productId",
      sku_id AS "skuId",
      sale_price AS "salePrice",
      cost_price AS "costPrice",
      currency,
      payment_mode AS "paymentMode",
      payment_no AS "paymentNo",
      main_status AS "mainStatus",
      payment_status AS "paymentStatus",
      supplier_status AS "supplierStatus",
      notify_status AS "notifyStatus",
      risk_status AS "riskStatus",
      channel_snapshot_json AS "channelSnapshotJson",
      product_snapshot_json AS "productSnapshotJson",
      callback_snapshot_json AS "callbackSnapshotJson",
      supplier_route_snapshot_json AS "supplierRouteSnapshotJson",
      risk_snapshot_json AS "riskSnapshotJson",
      ext_json AS "extJson",
      exception_tag AS "exceptionTag",
      remark,
      version,
      request_id AS "requestId",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      paid_at AS "paidAt",
      finished_at AS "finishedAt"
    FROM ordering.orders
    ORDER BY created_at DESC
  `,
  listEvents: `
    SELECT
      id,
      order_no AS "orderNo",
      event_type AS "eventType",
      source_service AS "sourceService",
      source_no AS "sourceNo",
      before_status_json AS "beforeStatusJson",
      after_status_json AS "afterStatusJson",
      payload_json AS "payloadJson",
      idempotency_key AS "idempotencyKey",
      operator,
      request_id AS "requestId",
      occurred_at AS "occurredAt"
    FROM ordering.order_events
    WHERE order_no = $1
    ORDER BY occurred_at ASC
  `,
} as const;
