import { forbidden, notFound } from '@/lib/errors';
import { eventBus } from '@/lib/event-bus';
import type { ChannelContract } from '@/modules/channels/contracts';
import type { LedgerContract } from '@/modules/ledger/contracts';
import type { OrderContract } from '@/modules/orders/contracts';
import type { OrdersRepository } from '@/modules/orders/orders.repository';
import type { OrderRecord } from '@/modules/orders/orders.types';
import type { ProductContract } from '@/modules/products/contracts';
import type { RiskContract } from '@/modules/risk/contracts';
import type { WorkerContract } from '@/modules/worker/contracts';

export class OrdersService implements OrderContract {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly channelContract: ChannelContract,
    private readonly productContract: ProductContract,
    private readonly riskContract: RiskContract,
    private readonly ledgerContract: LedgerContract,
    private readonly workerContract: WorkerContract,
  ) {}

  private async markOrderPaid(input: {
    orderNo: string;
    paymentNo?: string | null;
    paymentMode: string;
    paidAmount: number;
    sourceService: string;
    sourceNo?: string | null;
    idempotencyKey: string;
  }) {
    const order = await this.getOrderByNo(input.orderNo);

    if (
      ['SUCCESS', 'REFUNDED', 'CLOSED'].includes(order.mainStatus) ||
      (order.paymentStatus === 'PAID' && order.mainStatus !== 'PENDING_PAYMENT')
    ) {
      return;
    }

    await this.repository.updateStatuses(order.orderNo, {
      ...(input.paymentNo ? { paymentNo: input.paymentNo } : {}),
      paymentStatus: 'PAID',
      mainStatus: 'WAIT_SUPPLIER_SUBMIT',
      paidAt: true,
    });

    await this.repository.addEvent({
      orderNo: order.orderNo,
      eventType: 'PaymentSucceeded',
      sourceService: input.sourceService,
      sourceNo: input.sourceNo ?? null,
      beforeStatusJson: {
        mainStatus: order.mainStatus,
        paymentStatus: order.paymentStatus,
      },
      afterStatusJson: {
        mainStatus: 'WAIT_SUPPLIER_SUBMIT',
        paymentStatus: 'PAID',
      },
      payloadJson: {
        paymentMode: input.paymentMode,
        paidAmount: input.paidAmount,
        sourceService: input.sourceService,
        sourceNo: input.sourceNo ?? null,
      },
      idempotencyKey: input.idempotencyKey,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });

    await this.workerContract.enqueue({
      jobType: 'supplier.submit',
      businessKey: order.orderNo,
      payload: {
        orderNo: order.orderNo,
      },
    });
  }

  async listOrders() {
    return this.repository.listOrders();
  }

  async getOrderByNo(orderNo: string): Promise<OrderRecord> {
    const order = await this.repository.findByOrderNo(orderNo);

    if (!order) {
      throw notFound('订单不存在');
    }

    return order;
  }

  async getSupplierExecutionContext(orderNo: string) {
    return this.getOrderByNo(orderNo);
  }

  async getNotificationContext(orderNo: string) {
    return this.getOrderByNo(orderNo);
  }

  async getLedgerContext(orderNo: string) {
    return this.getOrderByNo(orderNo);
  }

  async listEvents(orderNo: string) {
    return this.repository.listEvents(orderNo);
  }

  async createOrder(input: {
    channelId: string;
    channelOrderNo: string;
    skuId: string;
    paymentMode: 'BALANCE' | 'FREE';
    extJson?: Record<string, unknown>;
    requestId: string;
    clientIp: string;
  }) {
    const existing = await this.repository.findByChannelOrder(
      input.channelId,
      input.channelOrderNo,
    );

    if (existing) {
      return existing;
    }

    const snapshot = await this.productContract.getSkuOrderSnapshot(input.skuId);
    const orderAmount = Number(snapshot.sku.baseSalePrice);
    const policy = await this.channelContract.getOrderPolicy({
      channelId: input.channelId,
      productId: snapshot.product.id,
      skuId: snapshot.sku.id,
      orderAmount,
    });
    const salePrice = Number(policy.pricePolicy?.salePrice ?? snapshot.sku.baseSalePrice);
    const riskDecision = await this.riskContract.preCheck({
      channelId: input.channelId,
      amount: salePrice,
      ip: input.clientIp,
    });

    if (riskDecision.decision === 'REJECT') {
      throw forbidden(riskDecision.reason);
    }

    const order = await this.repository.createOrder({
      channelOrderNo: input.channelOrderNo,
      channelId: input.channelId,
      parentChannelId: policy.channel.parentChannelId,
      productId: snapshot.product.id,
      skuId: snapshot.sku.id,
      salePrice,
      costPrice: Number(snapshot.supplierCandidates[0]?.costPrice ?? snapshot.sku.baseCostPrice),
      paymentMode: input.paymentMode,
      mainStatus: riskDecision.decision === 'REVIEW' ? 'CREATED' : 'PENDING_PAYMENT',
      paymentStatus: input.paymentMode === 'FREE' ? 'PAID' : 'UNPAID',
      supplierStatus: 'UNSUBMITTED',
      notifyStatus: 'PENDING',
      riskStatus: riskDecision.decision,
      channelSnapshotJson: {
        channel: policy.channel,
        pricePolicy: policy.pricePolicy,
      },
      productSnapshotJson: {
        product: snapshot.product,
        sku: snapshot.sku,
      },
      callbackSnapshotJson: {
        callbackConfig: policy.callbackConfig,
      },
      supplierRouteSnapshotJson: {
        supplierCandidates: snapshot.supplierCandidates,
      },
      riskSnapshotJson: {
        ...riskDecision,
      },
      extJson: input.extJson ?? {},
      requestId: input.requestId,
    });

    await this.repository.addEvent({
      orderNo: order.orderNo,
      eventType: 'OrderCreated',
      sourceService: 'orders',
      sourceNo: null,
      beforeStatusJson: {},
      afterStatusJson: {
        mainStatus: order.mainStatus,
        paymentStatus: order.paymentStatus,
      },
      payloadJson: {
        paymentMode: input.paymentMode,
        riskDecision,
      },
      idempotencyKey: `${input.channelId}:${input.channelOrderNo}`,
      operator: 'SYSTEM',
      requestId: input.requestId,
    });

    if (riskDecision.decision === 'REVIEW') {
      return order;
    }

    if (input.paymentMode === 'BALANCE') {
      const funding = await this.ledgerContract.payByBalance({
        channelId: order.channelId,
        orderNo: order.orderNo,
        amount: salePrice,
      });

      await this.markOrderPaid({
        orderNo: order.orderNo,
        paymentNo: funding.referenceNo,
        paymentMode: input.paymentMode,
        paidAmount: salePrice,
        sourceService: 'ledger',
        sourceNo: funding.referenceNo,
        idempotencyKey: funding.referenceNo,
      });

      return this.getOrderByNo(order.orderNo);
    }

    await this.markOrderPaid({
      orderNo: order.orderNo,
      paymentMode: input.paymentMode,
      paidAmount: 0,
      sourceService: 'orders',
      sourceNo: order.orderNo,
      idempotencyKey: `free:${order.orderNo}`,
    });

    return this.getOrderByNo(order.orderNo);
  }

  async closeOrder(orderNo: string, requestId: string) {
    const order = await this.getOrderByNo(orderNo);

    await this.repository.updateStatuses(orderNo, {
      mainStatus: 'CLOSED',
    });
    await this.repository.addEvent({
      orderNo,
      eventType: 'OrderClosed',
      sourceService: 'orders',
      beforeStatusJson: {
        mainStatus: order.mainStatus,
      },
      afterStatusJson: {
        mainStatus: 'CLOSED',
      },
      payloadJson: {},
      idempotencyKey: `close:${orderNo}`,
      operator: 'ADMIN',
      requestId,
    });
  }

  async markException(orderNo: string, exceptionTag: string, requestId: string) {
    const order = await this.getOrderByNo(orderNo);
    await this.repository.updateStatuses(orderNo, {
      exceptionTag,
    });
    await this.repository.addEvent({
      orderNo,
      eventType: 'OrderMarkedException',
      sourceService: 'orders',
      beforeStatusJson: {
        exceptionTag: order.exceptionTag,
      },
      afterStatusJson: {
        exceptionTag,
      },
      payloadJson: {
        exceptionTag,
      },
      idempotencyKey: `exception:${orderNo}:${exceptionTag}`,
      operator: 'ADMIN',
      requestId,
    });
  }

  async addRemark(orderNo: string, remark: string, operatorUserId: string | null) {
    await this.repository.addRemark(orderNo, remark, operatorUserId);
  }

  async handleSupplierAccepted(payload: {
    orderNo: string;
    supplierId: string;
    supplierOrderNo: string;
    status: 'ACCEPTED' | 'PROCESSING';
  }) {
    const order = await this.getOrderByNo(payload.orderNo);

    if (['SUCCESS', 'REFUNDED', 'CLOSED'].includes(order.mainStatus)) {
      return;
    }

    await this.repository.updateStatuses(order.orderNo, {
      mainStatus: 'SUPPLIER_PROCESSING',
      supplierStatus: payload.status,
    });
    await this.repository.addEvent({
      orderNo: order.orderNo,
      eventType: 'SupplierAccepted',
      sourceService: 'suppliers',
      sourceNo: payload.supplierOrderNo,
      beforeStatusJson: {
        mainStatus: order.mainStatus,
        supplierStatus: order.supplierStatus,
      },
      afterStatusJson: {
        mainStatus: 'SUPPLIER_PROCESSING',
        supplierStatus: payload.status,
      },
      payloadJson: payload,
      idempotencyKey: `${payload.supplierOrderNo}:${payload.status}`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });
  }

  async handleSupplierSucceeded(payload: {
    orderNo: string;
    supplierId: string;
    supplierOrderNo: string;
    costPrice: number;
  }) {
    const order = await this.getOrderByNo(payload.orderNo);

    if (['SUCCESS', 'REFUNDED'].includes(order.mainStatus)) {
      return;
    }

    await this.repository.updateStatuses(order.orderNo, {
      mainStatus: 'SUCCESS',
      supplierStatus: 'SUCCESS',
      finishedAt: true,
    });

    await this.repository.addEvent({
      orderNo: order.orderNo,
      eventType: 'SupplierSucceeded',
      sourceService: 'suppliers',
      sourceNo: payload.supplierOrderNo,
      beforeStatusJson: {
        mainStatus: order.mainStatus,
        supplierStatus: order.supplierStatus,
      },
      afterStatusJson: {
        mainStatus: 'SUCCESS',
        supplierStatus: 'SUCCESS',
      },
      payloadJson: payload,
      idempotencyKey: `${payload.supplierOrderNo}:SUCCESS`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });

    await eventBus.publish('SettlementTriggered', {
      orderNo: order.orderNo,
      actionType: 'ORDER_SUCCESS',
    });
    await eventBus.publish('NotificationRequested', {
      orderNo: order.orderNo,
      channelId: order.channelId,
      notifyType: 'WEBHOOK',
      triggerReason: 'ORDER_SUCCESS',
    });
  }

  async handleSupplierFailed(payload: {
    orderNo: string;
    supplierId: string;
    supplierOrderNo: string;
    reason: string;
  }) {
    const order = await this.getOrderByNo(payload.orderNo);

    if (['SUCCESS', 'REFUNDED'].includes(order.mainStatus)) {
      return;
    }

    if (order.paymentStatus === 'PAID') {
      await this.repository.updateStatuses(order.orderNo, {
        mainStatus: 'REFUNDING',
        supplierStatus: 'FAIL',
      });
      await this.repository.addEvent({
        orderNo: order.orderNo,
        eventType: 'SupplierFailed',
        sourceService: 'suppliers',
        sourceNo: payload.supplierOrderNo,
        beforeStatusJson: {
          mainStatus: order.mainStatus,
          supplierStatus: order.supplierStatus,
        },
        afterStatusJson: {
          mainStatus: 'REFUNDING',
          supplierStatus: 'FAIL',
        },
        payloadJson: payload,
        idempotencyKey: `${payload.supplierOrderNo}:FAIL`,
        operator: 'SYSTEM',
        requestId: order.requestId,
      });

      const refund = await this.ledgerContract.refundOrderPayment(order.orderNo);

      await this.handleRefundSucceeded({
        orderNo: order.orderNo,
        sourceService: 'ledger',
        sourceNo: refund.referenceNo,
      });

      return;
    }

    await this.repository.updateStatuses(order.orderNo, {
      mainStatus: 'FAIL',
      supplierStatus: 'FAIL',
      finishedAt: true,
    });
  }

  async handleRefundSucceeded(payload: {
    orderNo: string;
    sourceService: string;
    sourceNo?: string | null;
  }) {
    const order = await this.getOrderByNo(payload.orderNo);

    if (order.mainStatus === 'REFUNDED') {
      return;
    }

    await this.repository.updateStatuses(order.orderNo, {
      mainStatus: 'REFUNDED',
      finishedAt: true,
    });

    await this.repository.addEvent({
      orderNo: order.orderNo,
      eventType: 'RefundSucceeded',
      sourceService: payload.sourceService,
      sourceNo: payload.sourceNo ?? null,
      beforeStatusJson: {
        mainStatus: order.mainStatus,
      },
      afterStatusJson: {
        mainStatus: 'REFUNDED',
      },
      payloadJson: payload,
      idempotencyKey: payload.sourceNo ?? `refund:${order.orderNo}`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });

    await eventBus.publish('NotificationRequested', {
      orderNo: order.orderNo,
      channelId: order.channelId,
      notifyType: 'WEBHOOK',
      triggerReason: 'REFUND_SUCCEEDED',
    });
  }

  async handleNotificationSucceeded(payload: { orderNo: string; taskNo: string }) {
    const order = await this.getOrderByNo(payload.orderNo);
    await this.repository.updateStatuses(order.orderNo, {
      notifyStatus: 'SUCCESS',
    });
    await this.repository.addEvent({
      orderNo: order.orderNo,
      eventType: 'NotificationSucceeded',
      sourceService: 'notifications',
      sourceNo: payload.taskNo,
      beforeStatusJson: {
        notifyStatus: order.notifyStatus,
      },
      afterStatusJson: {
        notifyStatus: 'SUCCESS',
      },
      payloadJson: payload,
      idempotencyKey: `${payload.taskNo}:SUCCESS`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });
  }

  async handleNotificationFailed(payload: { orderNo: string; taskNo: string; reason: string }) {
    const order = await this.getOrderByNo(payload.orderNo);
    await this.repository.updateStatuses(order.orderNo, {
      notifyStatus: 'FAIL',
    });
    await this.repository.addEvent({
      orderNo: order.orderNo,
      eventType: 'NotificationFailed',
      sourceService: 'notifications',
      sourceNo: payload.taskNo,
      beforeStatusJson: {
        notifyStatus: order.notifyStatus,
      },
      afterStatusJson: {
        notifyStatus: 'FAIL',
      },
      payloadJson: payload,
      idempotencyKey: `${payload.taskNo}:FAIL`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });
  }
}
