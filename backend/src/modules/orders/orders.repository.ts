import { generateBusinessNo, generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { parseJsonValue } from '@/lib/utils';
import { ordersSql } from '@/modules/orders/orders.sql';
import type { MainOrderStatus, OrderEventRecord, OrderRecord } from '@/modules/orders/orders.types';

export class OrdersRepository {
  private async lockOrderEventMutation(tx: typeof db, key: string): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  private mapOrder(row: OrderRecord): OrderRecord {
    return {
      ...row,
      salePrice: Number(row.salePrice),
      costPrice: Number(row.costPrice),
      channelSnapshotJson: parseJsonValue(row.channelSnapshotJson, {}),
      productSnapshotJson: parseJsonValue(row.productSnapshotJson, {}),
      callbackSnapshotJson: parseJsonValue(row.callbackSnapshotJson, {}),
      supplierRouteSnapshotJson: parseJsonValue(row.supplierRouteSnapshotJson, {}),
      riskSnapshotJson: parseJsonValue(row.riskSnapshotJson, {}),
      extJson: parseJsonValue(row.extJson, {}),
    };
  }

  private mapEvent(row: OrderEventRecord): OrderEventRecord {
    return {
      ...row,
      beforeStatusJson: parseJsonValue(row.beforeStatusJson, {}),
      afterStatusJson: parseJsonValue(row.afterStatusJson, {}),
      payloadJson: parseJsonValue(row.payloadJson, {}),
    };
  }

  async listOrders(): Promise<OrderRecord[]> {
    const rows = await db.unsafe<OrderRecord[]>(ordersSql.listOrders);
    return rows.map((row) => this.mapOrder(row));
  }

  async findByOrderNo(orderNo: string): Promise<OrderRecord | null> {
    const row = await first<OrderRecord>(db<OrderRecord[]>`
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
      WHERE order_no = ${orderNo}
      LIMIT 1
    `);

    return row ? this.mapOrder(row) : null;
  }

  async findByChannelOrder(channelId: string, channelOrderNo: string): Promise<OrderRecord | null> {
    const row = await first<OrderRecord>(db<OrderRecord[]>`
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
      WHERE channel_id = ${channelId}
        AND channel_order_no = ${channelOrderNo}
      LIMIT 1
    `);

    return row ? this.mapOrder(row) : null;
  }

  async createOrder(input: {
    channelOrderNo: string;
    channelId: string;
    parentChannelId?: string | null;
    productId: string;
    skuId: string;
    salePrice: number;
    costPrice: number;
    paymentMode: string;
    mainStatus: MainOrderStatus;
    paymentStatus: string;
    supplierStatus: string;
    notifyStatus: string;
    riskStatus: string;
    channelSnapshotJson: Record<string, unknown>;
    productSnapshotJson: Record<string, unknown>;
    callbackSnapshotJson: Record<string, unknown>;
    supplierRouteSnapshotJson: Record<string, unknown>;
    riskSnapshotJson: Record<string, unknown>;
    extJson: Record<string, unknown>;
    requestId: string;
  }): Promise<OrderRecord> {
    const orderNo = generateBusinessNo('order');
    const rows = await db<OrderRecord[]>`
      INSERT INTO ordering.orders (
        id,
        order_no,
        channel_order_no,
        channel_id,
        parent_channel_id,
        product_id,
        sku_id,
        sale_price,
        cost_price,
        currency,
        payment_mode,
        main_status,
        payment_status,
        supplier_status,
        notify_status,
        risk_status,
        channel_snapshot_json,
        product_snapshot_json,
        callback_snapshot_json,
        supplier_route_snapshot_json,
        risk_snapshot_json,
        ext_json,
        version,
        request_id,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${orderNo},
        ${input.channelOrderNo},
        ${input.channelId},
        ${input.parentChannelId ?? null},
        ${input.productId},
        ${input.skuId},
        ${input.salePrice},
        ${input.costPrice},
        'CNY',
        ${input.paymentMode},
        ${input.mainStatus},
        ${input.paymentStatus},
        ${input.supplierStatus},
        ${input.notifyStatus},
        ${input.riskStatus},
        ${JSON.stringify(input.channelSnapshotJson)},
        ${JSON.stringify(input.productSnapshotJson)},
        ${JSON.stringify(input.callbackSnapshotJson)},
        ${JSON.stringify(input.supplierRouteSnapshotJson)},
        ${JSON.stringify(input.riskSnapshotJson)},
        ${JSON.stringify(input.extJson)},
        1,
        ${input.requestId},
        NOW(),
        NOW()
      )
      RETURNING
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
    `;

    const order = rows[0];

    if (!order) {
      throw new Error('创建订单失败');
    }

    return this.mapOrder(order);
  }

  async updateStatuses(
    orderNo: string,
    update: {
      mainStatus?: MainOrderStatus;
      paymentStatus?: string;
      supplierStatus?: string;
      notifyStatus?: string;
      riskStatus?: string;
      paymentNo?: string | null;
      exceptionTag?: string | null;
      remark?: string | null;
      paidAt?: boolean;
      finishedAt?: boolean;
    },
  ): Promise<void> {
    const order = await this.findByOrderNo(orderNo);

    if (!order) {
      throw new Error('订单不存在');
    }

    await db`
      UPDATE ordering.orders
      SET
        main_status = ${update.mainStatus ?? order.mainStatus},
        payment_status = ${update.paymentStatus ?? order.paymentStatus},
        supplier_status = ${update.supplierStatus ?? order.supplierStatus},
        notify_status = ${update.notifyStatus ?? order.notifyStatus},
        risk_status = ${update.riskStatus ?? order.riskStatus},
        payment_no = COALESCE(${update.paymentNo ?? null}, payment_no),
        exception_tag = COALESCE(${update.exceptionTag ?? null}, exception_tag),
        remark = COALESCE(${update.remark ?? null}, remark),
        paid_at = CASE WHEN ${update.paidAt ?? false} THEN NOW() ELSE paid_at END,
        finished_at = CASE WHEN ${update.finishedAt ?? false} THEN NOW() ELSE finished_at END,
        version = version + 1,
        updated_at = NOW()
      WHERE order_no = ${orderNo}
    `;
  }

  async addEvent(input: {
    orderNo: string;
    eventType: string;
    sourceService: string;
    sourceNo?: string | null;
    beforeStatusJson: Record<string, unknown>;
    afterStatusJson: Record<string, unknown>;
    payloadJson: Record<string, unknown>;
    idempotencyKey: string;
    operator: string;
    requestId: string;
  }): Promise<void> {
    await db.begin(async (tx) => {
      await this.lockOrderEventMutation(tx, `order-event:${input.idempotencyKey}`);

      const existing = await first<{ id: string }>(tx<{ id: string }[]>`
        SELECT id
        FROM ordering.order_events
        WHERE idempotency_key = ${input.idempotencyKey}
        LIMIT 1
      `);

      if (existing) {
        return;
      }

      await tx`
        INSERT INTO ordering.order_events (
          id,
          order_no,
          event_type,
          source_service,
          source_no,
          before_status_json,
          after_status_json,
          payload_json,
          idempotency_key,
          operator,
          request_id,
          occurred_at
        )
        VALUES (
          ${generateId()},
          ${input.orderNo},
          ${input.eventType},
          ${input.sourceService},
          ${input.sourceNo ?? null},
          ${JSON.stringify(input.beforeStatusJson)},
          ${JSON.stringify(input.afterStatusJson)},
          ${JSON.stringify(input.payloadJson)},
          ${input.idempotencyKey},
          ${input.operator},
          ${input.requestId},
          NOW()
        )
      `;
    });
  }

  async listEvents(orderNo: string): Promise<OrderEventRecord[]> {
    const rows = await db.unsafe<OrderEventRecord[]>(ordersSql.listEvents, [orderNo]);
    return rows.map((row) => this.mapEvent(row));
  }

  async addRemark(orderNo: string, remark: string, operatorUserId: string | null): Promise<void> {
    await db`
      INSERT INTO ordering.order_remarks (id, order_no, remark, operator_user_id, created_at)
      VALUES (${generateId()}, ${orderNo}, ${remark}, ${operatorUserId}, NOW())
    `;
    await this.updateStatuses(orderNo, { remark });
  }
}
