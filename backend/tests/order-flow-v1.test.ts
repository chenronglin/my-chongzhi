import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildApp } from '@/app';
import { runSeed } from '@/database/seeds/0001_base.seed';
import { buildOpenApiCanonicalString, encryptText, signOpenApiPayload } from '@/lib/security';
import { db, executeFile } from '@/lib/sql';
import { stableStringify } from '@/lib/utils';
import { OrdersRepository } from '@/modules/orders/orders.repository';
import { acquireIntegrationTestLock, releaseIntegrationTestLock } from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>>;
const migrationFile = join(import.meta.dir, '../src/database/migrations/0001_init_schemas.sql');

function buildSignedHeaders(input: {
  path: string;
  method?: string;
  body?: Record<string, unknown>;
  accessKey?: string;
  secretKey?: string;
}) {
  const timestamp = String(Date.now());
  const nonce = `nonce-${Date.now()}`;
  const method = input.method ?? 'POST';
  const bodyText = input.body ? stableStringify(input.body) : '';
  const canonical = buildOpenApiCanonicalString({
    method,
    path: input.path,
    timestamp,
    nonce,
    body: bodyText,
  });

  return {
    ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
    AccessKey: input.accessKey ?? 'demo-access-key',
    Sign: signOpenApiPayload(input.secretKey ?? 'demo-secret-key', canonical),
    Timestamp: timestamp,
    Nonce: nonce,
  };
}

async function readResponseJson(response: Response) {
  const text = await response.text();

  try {
    return JSON.parse(text) as {
      code: number;
      message: string;
      data: Record<string, any>;
      requestId: string;
    };
  } catch (error) {
    throw new Error(
      `Failed to parse JSON response (status ${response.status}): ${text || '<empty>'}`,
      { cause: error },
    );
  }
}

async function getOrderLedgerEntries(orderNo: string) {
  return db<
    {
      actionType: string;
      direction: string;
      amount: string;
      referenceNo: string;
    }[]
  >`
    SELECT
      action_type AS "actionType",
      direction,
      amount::text AS amount,
      reference_no AS "referenceNo"
    FROM ledger.account_ledgers
    WHERE order_no = ${orderNo}
    ORDER BY created_at ASC, id ASC
  `;
}

async function getOrderByChannelOrder(channelId: string, channelOrderNo: string) {
  return db<
    {
      orderNo: string;
      mainStatus: string;
    }[]
  >`
    SELECT
      order_no AS "orderNo",
      main_status AS "mainStatus"
    FROM ordering.orders
    WHERE channel_id = ${channelId}
      AND channel_order_no = ${channelOrderNo}
    LIMIT 1
  `;
}

async function getStoredOrderState(orderNo: string) {
  return db<
    {
      refundStatus: string;
      monitorStatus: string;
      requestedProductType: string;
      warningDeadlineAt: string | null;
      expireDeadlineAt: string | null;
      channelSnapshotJson: Record<string, unknown>;
      productSnapshotJson: Record<string, unknown>;
      callbackSnapshotJson: Record<string, unknown>;
      supplierRouteSnapshotJson: Record<string, unknown>;
      riskSnapshotJson: Record<string, unknown>;
      extJson: Record<string, unknown>;
    }[]
  >`
    SELECT
      refund_status AS "refundStatus",
      monitor_status AS "monitorStatus",
      requested_product_type AS "requestedProductType",
      channel_snapshot_json AS "channelSnapshotJson",
      product_snapshot_json AS "productSnapshotJson",
      callback_snapshot_json AS "callbackSnapshotJson",
      supplier_route_snapshot_json AS "supplierRouteSnapshotJson",
      risk_snapshot_json AS "riskSnapshotJson",
      warning_deadline_at::text AS "warningDeadlineAt",
      expire_deadline_at::text AS "expireDeadlineAt",
      ext_json AS "extJson"
    FROM ordering.orders
    WHERE order_no = ${orderNo}
    LIMIT 1
  `;
}

function normalizeJsonLike(input: unknown) {
  if (typeof input === 'string') {
    return JSON.parse(input) as Record<string, unknown>;
  }

  return (input ?? {}) as Record<string, unknown>;
}

async function getDemoChannelId() {
  const rows = await db<{ id: string }[]>`
    SELECT id
    FROM channel.channels
    WHERE channel_code = 'demo-channel'
    LIMIT 1
  `;

  return rows[0]?.id ?? null;
}

async function setChannelBalance(channelId: string, amount: number) {
  await db`
    UPDATE ledger.accounts
    SET
      available_balance = ${amount},
      updated_at = NOW()
    WHERE owner_type = 'CHANNEL'
      AND owner_id = ${channelId}
  `;
}

async function seedSecondChannel() {
  const secret = encryptText('other-secret-key');

  await db`
    INSERT INTO channel.channels (
      id,
      channel_code,
      channel_name,
      channel_type,
      status,
      settlement_mode
    )
    VALUES (
      'itest-channel-other',
      'other-channel',
      '第二渠道',
      'API',
      'ACTIVE',
      'PREPAID'
    )
    ON CONFLICT (channel_code) DO NOTHING
  `;
  await db`
    INSERT INTO channel.channel_api_credentials (
      id,
      channel_id,
      access_key,
      secret_key_encrypted,
      sign_algorithm,
      status
    )
    VALUES (
      'itest-channel-credential-other',
      'itest-channel-other',
      'other-access-key',
      ${secret},
      'HMAC_SHA256',
      'ACTIVE'
    )
    ON CONFLICT (access_key) DO NOTHING
  `;
}

async function findSupplierOrder(orderNo: string) {
  return db<
    {
      supplierId: string;
      supplierOrderNo: string;
      standardStatus: string;
    }[]
  >`
    SELECT
      supplier_id AS "supplierId",
      supplier_order_no AS "supplierOrderNo",
      standard_status AS "standardStatus"
    FROM supplier.supplier_orders
    WHERE order_no = ${orderNo}
    LIMIT 1
  `;
}

async function resetTestStateV1() {
  await db`
    TRUNCATE TABLE
      worker.worker_job_attempts,
      worker.worker_dead_letters,
      worker.worker_jobs,
      notification.notification_delivery_logs,
      notification.notification_dead_letters,
      notification.notification_tasks,
      supplier.supplier_callback_logs,
      supplier.supplier_orders,
      supplier.supplier_request_logs,
      ordering.order_events,
      ordering.orders,
      ledger.account_ledgers
  `;

  await runSeed(db);
  await seedSecondChannel();
}

async function rebuildManagedSchemas() {
  await db.unsafe(`
    DROP SCHEMA IF EXISTS iam CASCADE;
    DROP SCHEMA IF EXISTS channel CASCADE;
    DROP SCHEMA IF EXISTS product CASCADE;
    DROP SCHEMA IF EXISTS ordering CASCADE;
    DROP SCHEMA IF EXISTS supplier CASCADE;
    DROP SCHEMA IF EXISTS ledger CASCADE;
    DROP SCHEMA IF EXISTS risk CASCADE;
    DROP SCHEMA IF EXISTS notification CASCADE;
    DROP SCHEMA IF EXISTS worker CASCADE;
    DROP TABLE IF EXISTS public.app_migrations;
  `);

  await executeFile(migrationFile);
}

async function processWorkerRound() {
  await db`
    UPDATE worker.worker_jobs
    SET
      next_run_at = NOW(),
      updated_at = NOW()
    WHERE status IN ('READY', 'RETRY_WAIT')
  `;
  await runtime.services.worker.processReadyJobs();
}

beforeAll(async () => {
  await acquireIntegrationTestLock();
  await rebuildManagedSchemas();
  await runSeed(db);
  await seedSecondChannel();
  runtime = await buildApp({
    startWorkerScheduler: false,
  });
});

beforeEach(async () => {
  await resetTestStateV1();
});

afterAll(() => {
  runtime?.stop();
  return releaseIntegrationTestLock();
});

describe.serial('V1 ISP 充值下单链路', () => {
  test('开放接口使用 mobile + faceValue + product_type 创建订单并走余额扣款', async () => {
    const body = {
      channelOrderNo: `itest-v1-${Date.now()}`,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
    };

    const response = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const json = await readResponseJson(response);

    expect(response.status).toBe(200);
    expect(json.code).toBe(0);
    expect(json.data.orderNo).toBeTruthy();
    expect(json.data.matchedProductId).toBeTruthy();
    expect(json.data.mainStatus).toBe('CREATED');

    const orderNo = String(json.data.orderNo);
    const ledgerEntries = await getOrderLedgerEntries(orderNo);
    const storedRows = await getStoredOrderState(orderNo);
    const storedOrder = storedRows[0];

    expect(ledgerEntries).toHaveLength(2);
    expect(ledgerEntries.map((entry) => entry.direction)).toEqual(['DEBIT', 'CREDIT']);
    expect(ledgerEntries.every((entry) => Number(entry.amount) > 0)).toBe(true);
    expect(ledgerEntries.every((entry) => entry.referenceNo)).toBe(true);
    expect(storedOrder).toMatchObject({
      refundStatus: 'NONE',
      monitorStatus: 'NORMAL',
      requestedProductType: 'MIXED',
    });
    expect(storedOrder?.warningDeadlineAt).toBeTruthy();
    expect(storedOrder?.expireDeadlineAt).toBeTruthy();
    expect(storedOrder?.channelSnapshotJson).toBeTruthy();
    expect(storedOrder?.productSnapshotJson).toBeTruthy();
    expect(storedOrder?.callbackSnapshotJson).toBeTruthy();
    expect(storedOrder?.supplierRouteSnapshotJson).toBeTruthy();
    expect(storedOrder?.riskSnapshotJson).toBeTruthy();
    expect(normalizeJsonLike(storedOrder?.extJson)).toEqual({});
  });

  test('创建订单后处理 supplier.submit 不会因缺少供应商订单表而失败', async () => {
    const body = {
      channelOrderNo: `itest-worker-${Date.now()}`,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
    };

    const response = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const json = await readResponseJson(response);
    const orderNo = String(json.data.orderNo);

    await processWorkerRound();

    const supplierOrders = await findSupplierOrder(orderNo);
    const order = await runtime.services.orders.getOrderByNo(orderNo);

    expect(supplierOrders).toHaveLength(1);
    expect(supplierOrders[0]).toMatchObject({
      standardStatus: 'ACCEPTED',
    });
    expect(order.mainStatus).toBe('PROCESSING');
    expect(order.supplierStatus).toBe('ACCEPTED');
  });

  test('完整成功链路会进入 SUCCESS 并完成通知', async () => {
    const body = {
      channelOrderNo: `itest-success-${Date.now()}`,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
    };

    const response = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const json = await readResponseJson(response);
    const orderNo = String(json.data.orderNo);

    await processWorkerRound();
    await processWorkerRound();
    await processWorkerRound();

    const order = await runtime.services.orders.getOrderByNo(orderNo);
    const ledgerEntries = await getOrderLedgerEntries(orderNo);

    expect(order.mainStatus).toBe('SUCCESS');
    expect(order.supplierStatus).toBe('SUCCESS');
    expect(order.notifyStatus).toBe('SUCCESS');
    expect(ledgerEntries.map((entry) => entry.actionType)).toContain('ORDER_PROFIT');
  });

  test('供应商失败后会退款并进入 REFUNDED', async () => {
    const body = {
      channelOrderNo: `itest-refund-${Date.now()}`,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
      ext: {
        scenario: 'SUPPLIER_FAIL',
      },
    };

    const response = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const json = await readResponseJson(response);
    const orderNo = String(json.data.orderNo);

    await processWorkerRound();
    await processWorkerRound();
    await processWorkerRound();

    const order = await runtime.services.orders.getOrderByNo(orderNo);
    const ledgerEntries = await getOrderLedgerEntries(orderNo);

    expect(order.mainStatus).toBe('REFUNDED');
    expect(order.refundStatus).toBe('SUCCESS');
    expect(order.notifyStatus).toBe('SUCCESS');
    expect(ledgerEntries.map((entry) => entry.actionType)).toContain('ORDER_REFUND');
  });

  test('余额不足时不会留下脏订单，补足余额后可用同渠道单号重试', async () => {
    const channelId = await getDemoChannelId();
    const channelOrderNo = `itest-balance-${Date.now()}`;

    expect(channelId).toBeTruthy();

    await setChannelBalance(String(channelId), 0);

    const body = {
      channelOrderNo,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
    };

    const firstResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const firstText = await firstResponse.text();
    const firstLookup = await getOrderByChannelOrder(String(channelId), channelOrderNo);

    expect(firstResponse.status).toBe(400);
    expect(firstText).toContain('渠道余额不足');
    expect(firstLookup).toHaveLength(0);

    await setChannelBalance(String(channelId), 10000);

    const secondResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const secondJson = await readResponseJson(secondResponse);

    expect(secondResponse.status).toBe(200);
    expect(secondJson.code).toBe(0);
    expect(secondJson.data.orderNo).toBeTruthy();
  });

  test('开放接口订单读取会限制在认证渠道内', async () => {
    const body = {
      channelOrderNo: `itest-scope-${Date.now()}`,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
    };

    const createResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const createJson = await readResponseJson(createResponse);
    const orderNo = String(createJson.data.orderNo);

    const getOrderResponse = await runtime.app.handle(
      new Request(`http://localhost/open-api/orders/${orderNo}`, {
        method: 'GET',
        headers: buildSignedHeaders({
          path: `/open-api/orders/${orderNo}`,
          method: 'GET',
          accessKey: 'other-access-key',
          secretKey: 'other-secret-key',
        }),
      }),
    );
    const getEventsResponse = await runtime.app.handle(
      new Request(`http://localhost/open-api/orders/${orderNo}/events`, {
        method: 'GET',
        headers: buildSignedHeaders({
          path: `/open-api/orders/${orderNo}/events`,
          method: 'GET',
          accessKey: 'other-access-key',
          secretKey: 'other-secret-key',
        }),
      }),
    );

    expect(getOrderResponse.status).toBe(404);
    expect(getEventsResponse.status).toBe(404);
  });

  test('并发状态推进不会覆盖彼此不相关的字段', async () => {
    const body = {
      channelOrderNo: `itest-concurrency-${Date.now()}`,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
    };

    const createResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const createJson = await readResponseJson(createResponse);
    const orderNo = String(createJson.data.orderNo);
    const repository = new OrdersRepository();

    let releaseLock!: () => void;
    let lockReady!: () => void;

    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockAcquired = new Promise<void>((resolve) => {
      lockReady = resolve;
    });

    const heldLock = db.begin(async (tx) => {
      await tx`
        SELECT id
        FROM ordering.orders
        WHERE order_no = ${orderNo}
        FOR UPDATE
      `;
      lockReady();
      await lockPromise;
    });

    await lockAcquired;

    const supplierUpdate = repository.updateStatuses(orderNo, {
      supplierStatus: 'ACCEPTED',
      mainStatus: 'PROCESSING',
    });
    const notifyUpdate = repository.updateStatuses(orderNo, {
      notifyStatus: 'SUCCESS',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseLock();

    await Promise.all([heldLock, supplierUpdate, notifyUpdate]);

    const order = await runtime.services.orders.getOrderByNo(orderNo);

    expect(order.mainStatus).toBe('PROCESSING');
    expect(order.supplierStatus).toBe('ACCEPTED');
    expect(order.notifyStatus).toBe('SUCCESS');
  });
});
