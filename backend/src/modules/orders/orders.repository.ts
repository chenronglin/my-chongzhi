import { generateBusinessNo, generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { parseJsonValue } from '@/lib/utils';
import { ordersSql } from '@/modules/orders/orders.sql';
import type {
  MainOrderStatus,
  OrderEventRecord,
  OrderMonitorStatus,
  OrderNotifyStatus,
  OrderRecord,
  OrderRefundStatus,
  RequestedProductType,
  SupplierOrderStatus,
} from '@/modules/orders/orders.types';

const ORDER_META_KEY = '__orderMeta';

interface PersistedOrderMeta {
  parentChannelId: string | null;
  requestedProductType: RequestedProductType;
  refundStatus: OrderRefundStatus;
  monitorStatus: OrderMonitorStatus;
  exceptionTag: string | null;
  remark: string | null;
  warningDeadlineAt: string | null;
  expireDeadlineAt: string | null;
  channelSnapshotJson: Record<string, unknown>;
  productSnapshotJson: Record<string, unknown>;
  callbackSnapshotJson: Record<string, unknown>;
  supplierRouteSnapshotJson: Record<string, unknown>;
  riskSnapshotJson: Record<string, unknown>;
}

type OrderRow = Omit<
  OrderRecord,
  | 'parentChannelId'
  | 'requestedProductType'
  | 'refundStatus'
  | 'monitorStatus'
  | 'exceptionTag'
  | 'remark'
  | 'warningDeadlineAt'
  | 'expireDeadlineAt'
  | 'channelSnapshotJson'
  | 'productSnapshotJson'
  | 'callbackSnapshotJson'
  | 'supplierRouteSnapshotJson'
  | 'riskSnapshotJson'
> & {
  callbackUrl: string | null;
};

export class OrdersRepository {
  private parsePersistedExt(input: unknown): {
    userExt: Record<string, unknown>;
    meta: PersistedOrderMeta;
  } {
    const extJson = parseJsonValue<Record<string, unknown>>(input, {});
    const metaSource = parseJsonValue<Partial<PersistedOrderMeta>>(extJson[ORDER_META_KEY], {});
    const { [ORDER_META_KEY]: _discarded, ...userExt } = extJson;

    return {
      userExt,
      meta: {
        parentChannelId:
          typeof metaSource.parentChannelId === 'string' ? metaSource.parentChannelId : null,
        requestedProductType: metaSource.requestedProductType === 'FAST' ? 'FAST' : 'MIXED',
        refundStatus: this.parseRefundStatus(metaSource.refundStatus),
        monitorStatus: this.parseMonitorStatus(metaSource.monitorStatus),
        exceptionTag: typeof metaSource.exceptionTag === 'string' ? metaSource.exceptionTag : null,
        remark: typeof metaSource.remark === 'string' ? metaSource.remark : null,
        warningDeadlineAt:
          typeof metaSource.warningDeadlineAt === 'string' ? metaSource.warningDeadlineAt : null,
        expireDeadlineAt:
          typeof metaSource.expireDeadlineAt === 'string' ? metaSource.expireDeadlineAt : null,
        channelSnapshotJson: parseJsonValue(metaSource.channelSnapshotJson, {}),
        productSnapshotJson: parseJsonValue(metaSource.productSnapshotJson, {}),
        callbackSnapshotJson: parseJsonValue(metaSource.callbackSnapshotJson, {}),
        supplierRouteSnapshotJson: parseJsonValue(metaSource.supplierRouteSnapshotJson, {}),
        riskSnapshotJson: parseJsonValue(metaSource.riskSnapshotJson, {}),
      },
    };
  }

  private serializePersistedExt(
    order: Pick<
      OrderRecord,
      | 'extJson'
      | 'parentChannelId'
      | 'requestedProductType'
      | 'refundStatus'
      | 'monitorStatus'
      | 'exceptionTag'
      | 'remark'
      | 'warningDeadlineAt'
      | 'expireDeadlineAt'
      | 'channelSnapshotJson'
      | 'productSnapshotJson'
      | 'callbackSnapshotJson'
      | 'supplierRouteSnapshotJson'
      | 'riskSnapshotJson'
    >,
  ) {
    return {
      ...order.extJson,
      [ORDER_META_KEY]: {
        parentChannelId: order.parentChannelId,
        requestedProductType: order.requestedProductType,
        refundStatus: order.refundStatus,
        monitorStatus: order.monitorStatus,
        exceptionTag: order.exceptionTag,
        remark: order.remark,
        warningDeadlineAt: order.warningDeadlineAt,
        expireDeadlineAt: order.expireDeadlineAt,
        channelSnapshotJson: order.channelSnapshotJson,
        productSnapshotJson: order.productSnapshotJson,
        callbackSnapshotJson: order.callbackSnapshotJson,
        supplierRouteSnapshotJson: order.supplierRouteSnapshotJson,
        riskSnapshotJson: order.riskSnapshotJson,
      } satisfies PersistedOrderMeta,
    };
  }

  private parseRefundStatus(value: unknown): OrderRefundStatus {
    return value === 'PENDING' || value === 'SUCCESS' || value === 'FAIL' ? value : 'NONE';
  }

  private parseMonitorStatus(value: unknown): OrderMonitorStatus {
    return value === 'TIMEOUT_WARNING' ||
      value === 'MANUAL_FOLLOWING' ||
      value === 'LATE_CALLBACK_EXCEPTION'
      ? value
      : 'NORMAL';
  }

  private mapOrder(row: OrderRow): OrderRecord {
    const persisted = this.parsePersistedExt(row.extJson);
    const { callbackUrl: _callbackUrl, ...baseRow } = row;

    return {
      ...baseRow,
      salePrice: Number(baseRow.salePrice),
      purchasePrice: Number(baseRow.purchasePrice),
      faceValue: Number(baseRow.faceValue),
      parentChannelId: persisted.meta.parentChannelId,
      requestedProductType: persisted.meta.requestedProductType,
      refundStatus: persisted.meta.refundStatus,
      monitorStatus: persisted.meta.monitorStatus,
      exceptionTag: persisted.meta.exceptionTag,
      remark: persisted.meta.remark,
      channelSnapshotJson: persisted.meta.channelSnapshotJson,
      productSnapshotJson: persisted.meta.productSnapshotJson,
      callbackSnapshotJson: persisted.meta.callbackSnapshotJson,
      supplierRouteSnapshotJson: persisted.meta.supplierRouteSnapshotJson,
      riskSnapshotJson: persisted.meta.riskSnapshotJson,
      extJson: persisted.userExt,
      warningDeadlineAt: persisted.meta.warningDeadlineAt,
      expireDeadlineAt: persisted.meta.expireDeadlineAt,
    };
  }

  private mapEvent(row: OrderEventRecord): OrderEventRecord {
    return {
      ...row,
      idempotencyKey: row.idempotencyKey ?? null,
      beforeStatusJson: parseJsonValue(row.beforeStatusJson, {}),
      afterStatusJson: parseJsonValue(row.afterStatusJson, {}),
      payloadJson: parseJsonValue(row.payloadJson, {}),
    };
  }

  async listOrders(): Promise<OrderRecord[]> {
    const rows = await db.unsafe<OrderRow[]>(ordersSql.listOrders);
    return rows.map((row) => this.mapOrder(row));
  }

  async findByOrderNo(orderNo: string): Promise<OrderRecord | null> {
    const row = await first<OrderRow>(db<OrderRow[]>`
      SELECT
        id,
        order_no AS "orderNo",
        channel_order_no AS "channelOrderNo",
        channel_id AS "channelId",
        mobile_number AS "mobile",
        province_name AS "province",
        isp_code AS "ispName",
        face_value AS "faceValue",
        product_id AS "matchedProductId",
        sale_price AS "salePrice",
        cost_price AS "purchasePrice",
        currency,
        main_status AS "mainStatus",
        supplier_status AS "supplierStatus",
        notify_status AS "notifyStatus",
        callback_url AS "callbackUrl",
        ext_json AS "extJson",
        version,
        request_id AS "requestId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        finished_at AS "finishedAt"
      FROM ordering.orders
      WHERE order_no = ${orderNo}
      LIMIT 1
    `);

    return row ? this.mapOrder(row) : null;
  }

  async findByChannelOrder(channelId: string, channelOrderNo: string): Promise<OrderRecord | null> {
    const row = await first<OrderRow>(db<OrderRow[]>`
      SELECT
        id,
        order_no AS "orderNo",
        channel_order_no AS "channelOrderNo",
        channel_id AS "channelId",
        mobile_number AS "mobile",
        province_name AS "province",
        isp_code AS "ispName",
        face_value AS "faceValue",
        product_id AS "matchedProductId",
        sale_price AS "salePrice",
        cost_price AS "purchasePrice",
        currency,
        main_status AS "mainStatus",
        supplier_status AS "supplierStatus",
        notify_status AS "notifyStatus",
        callback_url AS "callbackUrl",
        ext_json AS "extJson",
        version,
        request_id AS "requestId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
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
    mobile: string;
    province: string;
    ispName: string;
    faceValue: number;
    requestedProductType: RequestedProductType;
    matchedProductId: string;
    salePrice: number;
    purchasePrice: number;
    mainStatus: MainOrderStatus;
    supplierStatus: SupplierOrderStatus;
    notifyStatus: OrderNotifyStatus;
    refundStatus: OrderRefundStatus;
    monitorStatus: OrderMonitorStatus;
    warningDeadlineAt: Date;
    expireDeadlineAt: Date;
    channelSnapshotJson: Record<string, unknown>;
    productSnapshotJson: Record<string, unknown>;
    callbackSnapshotJson: Record<string, unknown>;
    supplierRouteSnapshotJson: Record<string, unknown>;
    riskSnapshotJson: Record<string, unknown>;
    extJson: Record<string, unknown>;
    requestId: string;
  }): Promise<OrderRecord> {
    const orderNo = generateBusinessNo('order');
    const persistedExtJson = this.serializePersistedExt({
      extJson: input.extJson,
      parentChannelId: input.parentChannelId ?? null,
      requestedProductType: input.requestedProductType,
      refundStatus: input.refundStatus,
      monitorStatus: input.monitorStatus,
      exceptionTag: null,
      remark: null,
      warningDeadlineAt: input.warningDeadlineAt.toISOString(),
      expireDeadlineAt: input.expireDeadlineAt.toISOString(),
      channelSnapshotJson: input.channelSnapshotJson,
      productSnapshotJson: input.productSnapshotJson,
      callbackSnapshotJson: input.callbackSnapshotJson,
      supplierRouteSnapshotJson: input.supplierRouteSnapshotJson,
      riskSnapshotJson: input.riskSnapshotJson,
    });
    const callbackConfig = parseJsonValue<Record<string, unknown>>(
      input.callbackSnapshotJson.callbackConfig,
      {},
    );
    const rows = await db<OrderRow[]>`
      INSERT INTO ordering.orders (
        id,
        order_no,
        channel_order_no,
        channel_id,
        product_id,
        mobile_number,
        province_name,
        isp_code,
        face_value,
        sale_price,
        cost_price,
        currency,
        payment_mode,
        main_status,
        payment_status,
        supplier_status,
        notify_status,
        risk_status,
        callback_url,
        request_id,
        ext_json,
        version,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${orderNo},
        ${input.channelOrderNo},
        ${input.channelId},
        ${input.matchedProductId},
        ${input.mobile},
        ${input.province},
        ${input.ispName},
        ${input.faceValue},
        ${input.salePrice},
        ${input.purchasePrice},
        'CNY',
        'BALANCE',
        ${input.mainStatus},
        'PAID',
        ${input.supplierStatus},
        ${input.notifyStatus},
        'PASS',
        ${typeof callbackConfig.callbackUrl === 'string' ? callbackConfig.callbackUrl : null},
        ${input.requestId},
        ${JSON.stringify(persistedExtJson)},
        1,
        NOW(),
        NOW()
      )
      RETURNING
        id,
        order_no AS "orderNo",
        channel_order_no AS "channelOrderNo",
        channel_id AS "channelId",
        mobile_number AS "mobile",
        province_name AS "province",
        isp_code AS "ispName",
        face_value AS "faceValue",
        product_id AS "matchedProductId",
        sale_price AS "salePrice",
        cost_price AS "purchasePrice",
        currency,
        main_status AS "mainStatus",
        supplier_status AS "supplierStatus",
        notify_status AS "notifyStatus",
        callback_url AS "callbackUrl",
        ext_json AS "extJson",
        version,
        request_id AS "requestId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
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
      supplierStatus?: SupplierOrderStatus;
      notifyStatus?: OrderNotifyStatus;
      refundStatus?: OrderRefundStatus;
      monitorStatus?: OrderMonitorStatus;
      exceptionTag?: string | null;
      remark?: string | null;
      finishedAt?: boolean;
    },
  ): Promise<void> {
    const order = await this.findByOrderNo(orderNo);

    if (!order) {
      throw new Error('订单不存在');
    }

    const extJson = this.serializePersistedExt({
      extJson: order.extJson,
      parentChannelId: order.parentChannelId,
      requestedProductType: order.requestedProductType,
      refundStatus: update.refundStatus ?? order.refundStatus,
      monitorStatus: update.monitorStatus ?? order.monitorStatus,
      exceptionTag: update.exceptionTag ?? order.exceptionTag,
      remark: update.remark ?? order.remark,
      warningDeadlineAt: order.warningDeadlineAt,
      expireDeadlineAt: order.expireDeadlineAt,
      channelSnapshotJson: order.channelSnapshotJson,
      productSnapshotJson: order.productSnapshotJson,
      callbackSnapshotJson: order.callbackSnapshotJson,
      supplierRouteSnapshotJson: order.supplierRouteSnapshotJson,
      riskSnapshotJson: order.riskSnapshotJson,
    });

    await db`
      UPDATE ordering.orders
      SET
        main_status = ${update.mainStatus ?? order.mainStatus},
        supplier_status = ${update.supplierStatus ?? order.supplierStatus},
        notify_status = ${update.notifyStatus ?? order.notifyStatus},
        ext_json = ${JSON.stringify(extJson)},
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
    await db`
      INSERT INTO ordering.order_events (
        id,
        order_no,
        event_type,
        source_service,
        source_no,
        before_status_json,
        after_status_json,
        payload_json,
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
        ${input.operator},
        ${input.requestId},
        NOW()
      )
    `;
  }

  async listEvents(orderNo: string): Promise<OrderEventRecord[]> {
    const rows = await db.unsafe<OrderEventRecord[]>(ordersSql.listEvents, [orderNo]);
    return rows.map((row) => this.mapEvent(row));
  }

  async deleteOrder(orderNo: string): Promise<void> {
    await db.begin(async (tx) => {
      await tx`
        DELETE FROM ordering.order_events
        WHERE order_no = ${orderNo}
      `;
      await tx`
        DELETE FROM ordering.orders
        WHERE order_no = ${orderNo}
      `;
    });
  }

  async addRemark(orderNo: string, remark: string, _operatorUserId: string | null): Promise<void> {
    await this.updateStatuses(orderNo, { remark });
  }
}
