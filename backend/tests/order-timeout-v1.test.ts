import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildApp } from '@/app';
import { runSeed } from '@/database/seeds/0001_base.seed';
import { buildOpenApiCanonicalString, signOpenApiPayload } from '@/lib/security';
import { db, executeFile } from '@/lib/sql';
import { stableStringify } from '@/lib/utils';

let runtime: Awaited<ReturnType<typeof buildApp>>;
const migrationFile = join(import.meta.dir, '../src/database/migrations/0001_init_schemas.sql');

function buildSignedHeaders(input: {
  path: string;
  method?: string;
  body?: Record<string, unknown>;
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
    AccessKey: 'demo-access-key',
    Sign: signOpenApiPayload('demo-secret-key', canonical),
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

async function resetTestState() {
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

async function createFastOrder() {
  const body = {
    channelOrderNo: `itest-timeout-${Date.now()}`,
    mobile: '13800130000',
    faceValue: 100,
    product_type: 'FAST',
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

  return String(json.data.orderNo);
}

async function setOrderDeadlines(input: {
  orderNo: string;
  warningDeadlineAt: Date;
  expireDeadlineAt: Date;
}) {
  await db`
    UPDATE ordering.orders
    SET
      warning_deadline_at = ${input.warningDeadlineAt},
      expire_deadline_at = ${input.expireDeadlineAt},
      updated_at = NOW()
    WHERE order_no = ${input.orderNo}
  `;
}

async function removeSupplierSubmitJob(orderNo: string) {
  await db`
    DELETE FROM worker.worker_jobs
    WHERE job_type = 'supplier.submit'
      AND business_key = ${orderNo}
  `;
}

async function enqueueTimeoutScan(scanAt: Date) {
  await runtime.services.worker.enqueue({
    jobType: 'order.timeout.scan',
    businessKey: `scan:${scanAt.toISOString()}`,
    payload: {
      now: scanAt.toISOString(),
    },
  });

  await processWorkerRound();
}

async function listNotificationTasks(orderNo: string) {
  const rows = await db<
    {
      taskNo: string;
      notifyType: string;
      status: string;
      payloadText: string;
    }[]
  >`
    SELECT
      task_no AS "taskNo",
      notify_type AS "notifyType",
      status,
      payload_json::text AS "payloadText"
    FROM notification.notification_tasks
    WHERE order_no = ${orderNo}
    ORDER BY created_at ASC, id ASC
  `;

  return rows.map((row) => {
    const firstPass = JSON.parse(row.payloadText) as string | Record<string, unknown>;
    const payload =
      typeof firstPass === 'string'
        ? (JSON.parse(firstPass) as Record<string, unknown>)
        : firstPass;

    return {
      taskNo: row.taskNo,
      notifyType: row.notifyType,
      status: row.status,
      triggerReason: typeof payload.triggerReason === 'string' ? payload.triggerReason : null,
      mainStatus: typeof payload.mainStatus === 'string' ? payload.mainStatus : null,
      refundStatus: typeof payload.refundStatus === 'string' ? payload.refundStatus : null,
    };
  });
}

async function getOrderLedgerActions(orderNo: string) {
  return db<{ actionType: string }[]>`
    SELECT
      action_type AS "actionType"
    FROM ledger.account_ledgers
    WHERE order_no = ${orderNo}
    ORDER BY created_at ASC, id ASC
  `;
}

beforeAll(async () => {
  await rebuildManagedSchemas();
  await runSeed(db);
  runtime = await buildApp({
    startWorkerScheduler: false,
  });
});

beforeEach(async () => {
  await resetTestState();
});

afterAll(() => {
  runtime.stop();
});

describe.serial('V1 订单超时扫描', () => {
  test('FAST 订单超时后会先进入预警，再退款并仅创建终态 WEBHOOK 通知', async () => {
    const orderNo = await createFastOrder();

    await removeSupplierSubmitJob(orderNo);

    const warningScanAt = new Date('2026-03-28T09:10:00.000Z');

    await setOrderDeadlines({
      orderNo,
      warningDeadlineAt: new Date('2026-03-28T09:09:00.000Z'),
      expireDeadlineAt: new Date('2026-03-28T09:59:00.000Z'),
    });

    await enqueueTimeoutScan(warningScanAt);

    const warnedOrder = await runtime.services.orders.getOrderByNo(orderNo);
    const warningTasks = await listNotificationTasks(orderNo);

    expect(warnedOrder.mainStatus).toBe('CREATED');
    expect(warnedOrder.refundStatus).toBe('NONE');
    expect(warnedOrder.monitorStatus).toBe('TIMEOUT_WARNING');
    expect(warningTasks).toHaveLength(0);

    const expiryScanAt = new Date('2026-03-28T10:00:00.000Z');

    await setOrderDeadlines({
      orderNo,
      warningDeadlineAt: new Date('2026-03-28T09:09:00.000Z'),
      expireDeadlineAt: new Date('2026-03-28T09:59:00.000Z'),
    });

    await enqueueTimeoutScan(expiryScanAt);

    const refundedOrder = await runtime.services.orders.getOrderByNo(orderNo);
    const ledgerActions = await getOrderLedgerActions(orderNo);
    const pendingTasks = await listNotificationTasks(orderNo);

    expect(refundedOrder.mainStatus).toBe('REFUNDED');
    expect(refundedOrder.supplierStatus).toBe('FAIL');
    expect(refundedOrder.refundStatus).toBe('SUCCESS');
    expect(refundedOrder.monitorStatus).toBe('TIMEOUT_WARNING');
    expect(refundedOrder.notifyStatus).toBe('PENDING');
    expect(ledgerActions.map((entry) => entry.actionType)).toContain('ORDER_REFUND');
    expect(pendingTasks).toHaveLength(1);
    expect(pendingTasks[0]).toMatchObject({
      notifyType: 'WEBHOOK',
      status: 'PENDING',
      triggerReason: 'REFUND_SUCCEEDED',
      mainStatus: 'REFUNDED',
      refundStatus: 'SUCCESS',
    });

    await processWorkerRound();

    const notifiedOrder = await runtime.services.orders.getOrderByNo(orderNo);
    const deliveredTasks = await listNotificationTasks(orderNo);

    expect(notifiedOrder.notifyStatus).toBe('SUCCESS');
    expect(deliveredTasks).toHaveLength(1);
    expect(deliveredTasks[0]?.notifyType).toBe('WEBHOOK');
    expect(deliveredTasks[0]?.status).toBe('SUCCESS');
  });
});
