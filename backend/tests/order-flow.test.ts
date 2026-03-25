import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';
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

beforeAll(async () => {
  runtime = await buildApp({
    startWorkerScheduler: false,
  });
});

afterAll(() => {
  runtime.stop();
});

describe('主交易链路', () => {
  test('余额支付订单可以完成履约并成功通知', async () => {
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
});
