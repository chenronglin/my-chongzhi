import { describe, expect, test } from 'bun:test';

import { OrdersService } from '@/modules/orders/orders.service';
import type { OrderRecord } from '@/modules/orders/orders.types';

function buildOrderRecord(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 'order-id',
    orderNo: 'order-no-1',
    channelOrderNo: 'channel-order-1',
    channelId: 'channel-1',
    parentChannelId: null,
    mobile: '13800130000',
    province: 'Shanghai',
    ispName: 'CMCC',
    faceValue: 50,
    requestedProductType: 'MIXED',
    matchedProductId: 'product-1',
    salePrice: 48,
    purchasePrice: 45,
    currency: 'CNY',
    mainStatus: 'CREATED',
    paymentStatus: 'PAID',
    supplierStatus: 'WAIT_SUBMIT',
    notifyStatus: 'PENDING',
    refundStatus: 'NONE',
    monitorStatus: 'NORMAL',
    channelSnapshotJson: {
      channel: {
        id: 'channel-1',
      },
      pricePolicy: {
        salePrice: 48,
      },
    },
    productSnapshotJson: {
      product: {
        id: 'product-1',
      },
    },
    callbackSnapshotJson: {
      callbackConfig: {
        callbackUrl: 'mock://success',
        secretEncrypted: 'encrypted-secret',
      },
    },
    supplierRouteSnapshotJson: {
      supplierCandidates: [
        {
          supplierId: 'supplier-1',
          costPrice: 45,
        },
      ],
    },
    riskSnapshotJson: {
      decision: 'PASS',
      reason: 'ok',
    },
    extJson: {},
    exceptionTag: null,
    remark: null,
    version: 1,
    requestId: 'req-1',
    createdAt: '2026-03-28T00:00:00.000Z',
    updatedAt: '2026-03-28T00:00:00.000Z',
    warningDeadlineAt: '2026-03-28T02:30:00.000Z',
    expireDeadlineAt: '2026-03-28T03:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

describe('OrdersService.createOrder', () => {
  test('returns the existing order when a concurrent duplicate insert hits the unique key', async () => {
    const createdOrder = buildOrderRecord();
    let createCalls = 0;
    let addEventCalls = 0;
    let debitCalls = 0;
    let enqueueCalls = 0;
    let lookupCalls = 0;
    let pendingDuplicateLookups = 0;
    let releaseDuplicateLookups!: () => void;
    const duplicateLookupsReady = new Promise<void>((resolve) => {
      releaseDuplicateLookups = resolve;
    });

    const repository = {
      async findByChannelOrder() {
        lookupCalls += 1;
        pendingDuplicateLookups += 1;

        if (pendingDuplicateLookups <= 2) {
          if (pendingDuplicateLookups === 2) {
            releaseDuplicateLookups();
          }

          await duplicateLookupsReady;
          return null;
        }

        return createdOrder;
      },
      async createOrder() {
        createCalls += 1;

        if (createCalls === 1) {
          return createdOrder;
        }

        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
        });
      },
      async addEvent() {
        addEventCalls += 1;
      },
      async deleteOrder() {
        throw new Error('deleteOrder should not be called for duplicate idempotency');
      },
      async findByOrderNo() {
        return createdOrder;
      },
    };

    const channelContract = {
      async authenticateOpenRequest() {
        throw new Error('authenticateOpenRequest should not be called in service test');
      },
      async getOrderPolicy() {
        return {
          channel: {
            id: 'channel-1',
            channelCode: 'demo-channel',
            channelName: 'Demo Channel',
            status: 'ACTIVE',
          },
          pricePolicy: {
            salePrice: 48,
          },
          callbackConfig: {
            callbackUrl: 'mock://success',
            secretEncrypted: 'encrypted-secret',
          },
        };
      },
      async getCallbackConfig() {
        throw new Error('getCallbackConfig should not be called in service test');
      },
      async getChannelById() {
        throw new Error('getChannelById should not be called in service test');
      },
    };
    const productContract = {
      async matchRechargeProduct() {
        return {
          mobileContext: {
            mobile: createdOrder.mobile,
            province: String(createdOrder.province),
            ispName: String(createdOrder.ispName),
          },
          product: {
            id: createdOrder.matchedProductId,
            productType: createdOrder.requestedProductType,
            faceValue: createdOrder.faceValue,
          },
          supplierCandidates: [
            {
              supplierId: 'supplier-1',
              costPrice: createdOrder.purchasePrice,
            },
          ],
        };
      },
    };
    const riskContract = {
      async preCheck() {
        return {
          decision: 'PASS',
          reason: 'ok',
        };
      },
    };
    const ledgerContract = {
      async ensureBalanceSufficient() {},
      async debitOrderAmount() {
        debitCalls += 1;
        return {
          referenceNo: 'ledger-ref-1',
        };
      },
      async refundOrderAmount() {
        throw new Error('refundOrderAmount should not be called in service test');
      },
      async confirmOrderProfit() {},
    };
    const workerContract = {
      async enqueue() {
        enqueueCalls += 1;
        return {
          id: 'job-1',
          jobType: 'supplier.submit',
          businessKey: createdOrder.orderNo,
          payloadJson: {
            orderNo: createdOrder.orderNo,
          },
          status: 'READY',
          attemptCount: 0,
          maxAttempts: 5,
          nextRunAt: new Date().toISOString(),
          lastError: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
      async schedule() {
        throw new Error('schedule should not be called in service test');
      },
      async processReadyJobs() {},
      registerHandler() {},
      listRegisteredJobTypes() {
        return [];
      },
      async retry() {},
      async cancel() {},
      async listDeadLetters() {
        return [];
      },
    };

    const service = new OrdersService(
      repository as never,
      channelContract as never,
      productContract as never,
      riskContract as never,
      ledgerContract as never,
      workerContract as never,
    );

    const input = {
      channelId: createdOrder.channelId,
      channelOrderNo: createdOrder.channelOrderNo,
      mobile: createdOrder.mobile,
      faceValue: createdOrder.faceValue,
      productType: createdOrder.requestedProductType,
      extJson: {},
      requestId: 'req-1',
      clientIp: '127.0.0.1',
    } as const;

    const [firstResult, secondResult] = await Promise.all([
      service.createOrder(input),
      service.createOrder(input),
    ]);

    expect(firstResult.orderNo).toBe(createdOrder.orderNo);
    expect(secondResult.orderNo).toBe(createdOrder.orderNo);
    expect(lookupCalls).toBe(3);
    expect(createCalls).toBe(2);
    expect(addEventCalls).toBe(1);
    expect(debitCalls).toBe(1);
    expect(enqueueCalls).toBe(1);
  });
});
