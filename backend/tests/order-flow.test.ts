import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { buildOpenApiCanonicalString, signOpenApiPayload } from '@/lib/security';
import { db } from '@/lib/sql';
import { stableStringify } from '@/lib/utils';
import { resetTestState } from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>>;

function buildSignedHeaders(path: string, body: Record<string, unknown>) {
  const timestamp = String(Date.now());
  const nonce = `nonce-${Date.now()}`;
  const bodyText = stableStringify(body);
  const canonical = buildOpenApiCanonicalString({
    method: 'POST',
    path,
    timestamp,
    nonce,
    body: bodyText,
  });

  return {
    'content-type': 'application/json',
    AccessKey: 'demo-access-key',
    Sign: signOpenApiPayload('demo-secret-key', canonical),
    Timestamp: timestamp,
    Nonce: nonce,
  };
}

async function readResponseJson(response: Response) {
  return response.json() as Promise<{
    code: number;
    message: string;
    data: Record<string, any>;
    requestId: string;
  }>;
}

async function getOrderLedgerEntries(orderNo: string) {
  return db<
    {
      actionType: string;
      direction: string;
      referenceNo: string;
    }[]
  >`
    SELECT
      action_type AS "actionType",
      direction,
      reference_no AS "referenceNo"
    FROM ledger.account_ledgers
    WHERE order_no = ${orderNo}
    ORDER BY created_at ASC, id ASC
  `;
}

async function getOrderEventSources(orderNo: string, eventType: string) {
  return db<
    {
      sourceService: string;
      sourceNo: string | null;
    }[]
  >`
    SELECT
      source_service AS "sourceService",
      source_no AS "sourceNo"
    FROM ordering.order_events
    WHERE order_no = ${orderNo}
      AND event_type = ${eventType}
    ORDER BY occurred_at ASC, id ASC
  `;
}

beforeAll(async () => {
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

describe('主交易链路', () => {
  test('余额支付订单会先落账，再完成履约并成功通知', async () => {
    const skuRows = await db.unsafe<{ id: string }[]>(
      'SELECT id FROM product.product_skus ORDER BY created_at ASC LIMIT 1',
    );
    const skuId = skuRows[0]?.id;

    expect(skuId).toBeTruthy();

    const body = {
      channelOrderNo: `itest-${Date.now()}`,
      skuId,
      paymentMode: 'BALANCE',
    };
    const response = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders('/open-api/orders', body),
        body: JSON.stringify(body),
      }),
    );
    const json = await readResponseJson(response);

    expect(json.code).toBe(0);
    expect(json.data.orderNo).toBeTruthy();

    const orderNo = String(json.data.orderNo);
    const ledgerEntries = await getOrderLedgerEntries(orderNo);
    const paymentEvents = await getOrderEventSources(orderNo, 'PaymentSucceeded');

    expect(ledgerEntries).toHaveLength(2);
    expect(ledgerEntries.map((entry) => entry.actionType)).toEqual([
      'BALANCE_PAYMENT',
      'BALANCE_PAYMENT',
    ]);
    expect(ledgerEntries.map((entry) => entry.direction)).toEqual(['DEBIT', 'CREDIT']);
    expect(paymentEvents).toHaveLength(1);
    expect(paymentEvents[0]).toMatchObject({
      sourceService: 'ledger',
    });
    expect(paymentEvents[0]?.sourceNo).toBeTruthy();

    // 第一次执行会提交供应商并进入受理状态。
    await runtime.services.worker.processReadyJobs();
    await Bun.sleep(1100);
    // 第二次执行会执行供应商查询并推进订单成功。
    await runtime.services.worker.processReadyJobs();
    // 第三次执行处理通知任务。
    await runtime.services.worker.processReadyJobs();

    const finalOrder = await runtime.services.orders.getOrderByNo(orderNo);

    expect(finalOrder.mainStatus).toBe('SUCCESS');
    expect(finalOrder.paymentStatus).toBe('PAID');
    expect(finalOrder.supplierStatus).toBe('SUCCESS');
    expect(finalOrder.notifyStatus).toBe('SUCCESS');
  });

  test('余额支付订单在供应商失败后会执行退款落账并进入已退款状态', async () => {
    const skuRows = await db.unsafe<{ id: string }[]>(
      'SELECT id FROM product.product_skus ORDER BY created_at ASC LIMIT 1',
    );
    const skuId = skuRows[0]?.id;

    expect(skuId).toBeTruthy();

    const body = {
      channelOrderNo: `refund-${Date.now()}`,
      skuId,
      paymentMode: 'BALANCE',
      ext: {
        scenario: 'SUPPLIER_FAIL',
      },
    };
    const response = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders('/open-api/orders', body),
        body: JSON.stringify(body),
      }),
    );
    const json = await readResponseJson(response);

    expect(json.code).toBe(0);
    expect(json.data.orderNo).toBeTruthy();

    const orderNo = String(json.data.orderNo);
    await runtime.services.worker.processReadyJobs();
    await Bun.sleep(1100);
    await runtime.services.worker.processReadyJobs();
    await runtime.services.worker.processReadyJobs();

    const finalOrder = await runtime.services.orders.getOrderByNo(orderNo);
    const ledgerEntries = await getOrderLedgerEntries(orderNo);
    const refundEvents = await getOrderEventSources(orderNo, 'RefundSucceeded');

    expect(finalOrder.mainStatus).toBe('REFUNDED');
    expect(finalOrder.notifyStatus).toBe('SUCCESS');
    expect(ledgerEntries.map((entry) => entry.actionType)).toContain('ORDER_REFUND');
    expect(refundEvents).toHaveLength(1);
    expect(refundEvents[0]).toMatchObject({
      sourceService: 'ledger',
    });
  });

  test('重复支付通知不会重复记账或重复写入支付成功事件', async () => {
    const skuRows = await db.unsafe<{ id: string }[]>(
      'SELECT id FROM product.product_skus ORDER BY created_at ASC LIMIT 1',
    );
    const skuId = skuRows[0]?.id;

    expect(skuId).toBeTruthy();

    const createBody = {
      channelOrderNo: `online-${Date.now()}`,
      skuId,
      paymentMode: 'ONLINE',
    };
    const createResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders('/open-api/orders', createBody),
        body: JSON.stringify(createBody),
      }),
    );
    const createJson = await readResponseJson(createResponse);
    const orderNo = String(createJson.data.orderNo);
    const token = await runtime.issueInternalToken();
    const paymentNo = `gateway-${Date.now()}`;

    await Promise.all(
      [1, 2].map(() =>
        runtime.app.handle(
          new Request(`http://localhost/internal/orders/${orderNo}/payment-events`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              status: 'SUCCESS',
              paymentNo,
              paymentMode: 'ONLINE',
              paidAmount: 100,
            }),
          }),
        ),
      ),
    );

    const ledgerEntries = await getOrderLedgerEntries(orderNo);
    const paymentEvents = await getOrderEventSources(orderNo, 'PaymentSucceeded');

    expect(ledgerEntries.filter((entry) => entry.actionType === 'ONLINE_PAYMENT')).toHaveLength(1);
    expect(paymentEvents).toHaveLength(1);
  });
});
