import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { runSeed } from '@/database/seeds/0001_base.seed';
import { buildOpenApiCanonicalString, signOpenApiPayload } from '@/lib/security';
import { db } from '@/lib/sql';
import { stableStringify } from '@/lib/utils';

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
      supplier.supplier_request_logs,
      ordering.order_events,
      ordering.orders,
      ledger.account_ledgers
  `;

  await runSeed(db);
}

beforeAll(async () => {
  runtime = await buildApp({
    startWorkerScheduler: false,
  });
});

beforeEach(async () => {
  await resetTestStateV1();
});

afterAll(() => {
  runtime.stop();
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
        headers: buildSignedHeaders('/open-api/orders', body),
        body: JSON.stringify(body),
      }),
    );
    const json = await readResponseJson(response);

    expect(response.status).toBe(200);
    expect(json.code).toBe(0);
    expect(json.data.orderNo).toBeTruthy();
    expect(json.data.matchedProductId).toBeTruthy();
    expect(json.data.mainStatus).toBe('CREATED');

    const ledgerEntries = await getOrderLedgerEntries(String(json.data.orderNo));

    expect(ledgerEntries).toHaveLength(2);
    expect(ledgerEntries.map((entry) => entry.direction)).toEqual(['DEBIT', 'CREDIT']);
    expect(ledgerEntries.every((entry) => Number(entry.amount) > 0)).toBe(true);
    expect(ledgerEntries.every((entry) => entry.referenceNo)).toBe(true);
  });
});
