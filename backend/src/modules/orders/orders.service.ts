import { forbidden, notFound } from '@/lib/errors';
import { eventBus } from '@/lib/event-bus';
import { generateBusinessNo } from '@/lib/id';
import type { ChannelContract } from '@/modules/channels/contracts';
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
    private readonly workerContract: WorkerContract,
  ) {}

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
    paymentMode: 'ONLINE' | 'BALANCE' | 'FREE';
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

    if (input.paymentMode === 'ONLINE') {
      await this.repository.updateStatuses(order.orderNo, {
        mainStatus: 'PENDING_PAYMENT',
        paymentStatus: 'UNPAID',
      });

      return this.getOrderByNo(order.orderNo);
    }

    await this.handlePaymentSucceeded({
      orderNo: order.orderNo,
      paymentNo: generateBusinessNo('pay'),
      paymentMode: input.paymentMode,
      paidAmount: salePrice,
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

  async handlePaymentSucceeded(payload: {
    orderNo: string;
    paymentNo: string;
    paymentMode: string;
    paidAmount: number;
  }) {
    const order = await this.getOrderByNo(payload.orderNo);

    if (['SUCCESS', 'REFUNDED', 'CLOSED'].includes(order.mainStatus)) {
      return;
    }

    await this.repository.updateStatuses(order.orderNo, {
      paymentNo: payload.paymentNo,
      paymentStatus: 'PAID',
      mainStatus: 'WAIT_SUPPLIER_SUBMIT',
      paidAt: true,
    });

    await this.repository.addEvent({
      orderNo: order.orderNo,
      eventType: 'PaymentSucceeded',
      sourceService: 'payments',
      sourceNo: payload.paymentNo,
      beforeStatusJson: {
        mainStatus: order.mainStatus,
        paymentStatus: order.paymentStatus,
      },
      afterStatusJson: {
        mainStatus: 'WAIT_SUPPLIER_SUBMIT',
        paymentStatus: 'PAID',
      },
      payloadJson: payload,
      idempotencyKey: payload.paymentNo,
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

  async handlePaymentFailed(payload: { orderNo: string; paymentNo: string; reason: string }) {
    const order = await this.getOrderByNo(payload.orderNo);

    if (['SUCCESS', 'REFUNDED'].includes(order.mainStatus)) {
      return;
    }

    await this.repository.updateStatuses(order.orderNo, {
      mainStatus: 'CLOSED',
      paymentStatus: 'PAY_FAIL',
    });
    await this.repository.addEvent({
      orderNo: order.orderNo,
      eventType: 'PaymentFailed',
      sourceService: 'payments',
      sourceNo: payload.paymentNo,
      beforeStatusJson: {
        mainStatus: order.mainStatus,
        paymentStatus: order.paymentStatus,
      },
      afterStatusJson: {
        mainStatus: 'CLOSED',
        paymentStatus: 'PAY_FAIL',
      },
      payloadJson: payload,
      idempotencyKey: `${payload.paymentNo}:FAIL`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });
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
      const refundNo = generateBusinessNo('refund');

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

      await eventBus.publish('RefundRequested', {
        orderNo: order.orderNo,
        refundNo,
        reason: payload.reason,
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
    refundNo: string;
    source: 'payment' | 'supplier';
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
      sourceService: payload.source,
      sourceNo: payload.refundNo,
      beforeStatusJson: {
        mainStatus: order.mainStatus,
      },
      afterStatusJson: {
        mainStatus: 'REFUNDED',
      },
      payloadJson: payload,
      idempotencyKey: payload.refundNo,
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
